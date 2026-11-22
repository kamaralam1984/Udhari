/**
 * End-of-day summary for the owner. `buildDailyReportText` is pure;
 * `runDailyReport` is called from the scheduler tick and sends at most one
 * report per business day, once the configured hour has passed.
 */
import { db } from "./db";
import { formatDateHuman, partsInAppTz, startOfDayInAppTz } from "./time";
import { formatInr } from "./nlu/extract";
import { sendOwnerNotification } from "./notifications/provider";

export interface DailyStats {
  dateLabel: string;
  calls: number;
  connected: number;
  noAnswer: number;
  promises: number;
  promisedAmount: number;
  collected: number;
  collectionCount: number;
  outstanding: number;
  brokenOpen: number;
  openTasks: number;
  cost: number;
  topStaff: { name: string; amount: number } | null;
}

export function buildDailyReportText(s: DailyStats): string {
  const rate = s.calls > 0 ? Math.round((s.connected / s.calls) * 100) : 0;
  const roiLine = s.cost > 0 ? `Kharch ₹${Math.round(s.cost)} → har ₹1 par ₹${(s.collected / s.cost).toFixed(1)} wapas` : `Kharch ₹0`;
  return [
    `DAILY REPORT — ${s.dateLabel}`,
    "",
    `Calls: ${s.calls} (connected ${s.connected}, ${rate}% | no answer ${s.noAnswer})`,
    `Promises mile: ${s.promises}${s.promises ? ` (${formatInr(s.promisedAmount)})` : ""}`,
    `Cash collect hua: ${formatInr(s.collected)} (${s.collectionCount} receipt)`,
    s.topStaff ? `Top staff: ${s.topStaff.name} — ${formatInr(s.topStaff.amount)}` : "Top staff: -",
    "",
    `Total outstanding: ${formatInr(s.outstanding)}`,
    `Broken promises (open): ${s.brokenOpen}`,
    `Open staff tasks: ${s.openTasks}`,
    "",
    roiLine,
  ].join("\n");
}

export async function collectDailyStats(now = new Date()): Promise<DailyStats> {
  const start = startOfDayInAppTz(now);
  const [calls, connected, noAnswer, promises, collected, outstanding, brokenOpen, openTasks, cost, perStaff] = await Promise.all([
    db.call.count({ where: { createdAt: { gte: start } } }),
    db.call.count({ where: { createdAt: { gte: start }, status: { notIn: ["QUEUED", "RINGING", "NO_ANSWER", "BUSY", "FAILED"] } } }),
    db.call.count({ where: { createdAt: { gte: start }, status: { in: ["NO_ANSWER", "BUSY"] } } }),
    db.promiseToPay.aggregate({ _count: true, _sum: { promisedAmount: true }, where: { createdAt: { gte: start } } }),
    db.cashCollection.aggregate({ _count: true, _sum: { amount: true }, where: { collectedAt: { gte: start } } }),
    db.customer.aggregate({ _sum: { outstandingAmount: true } }),
    db.promiseToPay.count({ where: { status: "BROKEN" } }),
    db.staffTask.count({ where: { status: { not: "RESOLVED" } } }),
    db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: start } } }),
    db.cashCollection.groupBy({ by: ["collectedById"], _sum: { amount: true }, where: { collectedAt: { gte: start } }, orderBy: { _sum: { amount: "desc" } }, take: 1 }),
  ]);
  let topStaff: DailyStats["topStaff"] = null;
  if (perStaff[0]) {
    const u = await db.user.findUnique({ where: { id: perStaff[0].collectedById }, select: { name: true } });
    if (u) topStaff = { name: u.name, amount: Number(perStaff[0]._sum.amount ?? 0) };
  }
  return {
    dateLabel: formatDateHuman(now),
    calls,
    connected,
    noAnswer,
    promises: promises._count,
    promisedAmount: Number(promises._sum.promisedAmount ?? 0),
    collected: Number(collected._sum.amount ?? 0),
    collectionCount: collected._count,
    outstanding: Number(outstanding._sum.outstandingAmount ?? 0),
    brokenOpen,
    openTasks,
    cost: Number(cost._sum.estimatedCost ?? 0),
    topStaff,
  };
}

export const dailyReportTitle = (now: Date) => `Daily Report — ${formatDateHuman(now)}`;

/** Sends today's report once, after `dailyReportHour` (business timezone). Returns true if it sent. */
export async function runDailyReport(now = new Date()): Promise<boolean> {
  const settings = await db.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.dailyReportEnabled) return false;
  if (partsInAppTz(now).hour < settings.dailyReportHour) return false;

  const title = dailyReportTitle(now);
  const already = await db.notification.findFirst({ where: { title, createdAt: { gte: startOfDayInAppTz(now) } }, select: { id: true } });
  if (already) return false;

  await sendOwnerNotification({ title, body: buildDailyReportText(await collectDailyStats(now)) });
  return true;
}
