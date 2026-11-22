/**
 * Owner alerts: success-rate drop, too many broken promises, daily cost limit.
 * `evaluateAlerts` is pure (unit-tested); `getActiveAlerts` / `runAlertSweep`
 * add the DB reads and the (de-duplicated) owner notification.
 */
import { db } from "./db";
import { startOfDayInAppTz } from "./time";
import { sendOwnerNotification } from "./notifications/provider";

export interface AlertMetrics {
  calls24h: number;
  failed24h: number;
  brokenOpen: number;
  costToday: number;
}

export interface AlertThresholds {
  alertMinSuccessRate: number; // 0 = off
  alertMaxBrokenPromises: number; // 0 = off
  dailyCostLimit: number; // 0 = off
}

export interface AlertItem {
  key: "success-rate" | "broken-promises" | "cost-limit";
  severity: "warning" | "critical";
  title: string;
  body: string;
}

/** Need a few calls before a rate means anything — avoids alerting on 1 failed call out of 2. */
const MIN_CALLS_FOR_RATE = 5;

export function evaluateAlerts(m: AlertMetrics, t: AlertThresholds): AlertItem[] {
  const out: AlertItem[] = [];

  if (t.alertMinSuccessRate > 0 && m.calls24h >= MIN_CALLS_FOR_RATE) {
    const rate = ((m.calls24h - m.failed24h) / m.calls24h) * 100;
    if (rate < t.alertMinSuccessRate) {
      out.push({
        key: "success-rate",
        severity: rate < t.alertMinSuccessRate - 15 ? "critical" : "warning",
        title: "Call success rate gir gaya",
        body: `Pichhle 24 ghante me ${m.failed24h}/${m.calls24h} calls fail hui — success rate ${rate.toFixed(1)}% (limit ${t.alertMinSuccessRate}%). Telephony provider/number check karo.`,
      });
    }
  }

  if (t.alertMaxBrokenPromises > 0 && m.brokenOpen >= t.alertMaxBrokenPromises) {
    out.push({
      key: "broken-promises",
      severity: m.brokenOpen >= t.alertMaxBrokenPromises * 2 ? "critical" : "warning",
      title: "Broken promises badh gaye",
      body: `${m.brokenOpen} promises toot chuke hain (limit ${t.alertMaxBrokenPromises}). Dashboard me "Broken Promises" dekh kar follow-up karo.`,
    });
  }

  if (t.dailyCostLimit > 0 && m.costToday >= t.dailyCostLimit) {
    out.push({
      key: "cost-limit",
      severity: m.costToday >= t.dailyCostLimit * 1.5 ? "critical" : "warning",
      title: "Aaj ka call cost limit paar",
      body: `Aaj ka estimated call cost ₹${m.costToday.toFixed(0)} ho gaya (limit ₹${t.dailyCostLimit.toFixed(0)}).`,
    });
  }

  return out;
}

export async function collectAlertMetrics(now = new Date()): Promise<AlertMetrics> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const todayStart = startOfDayInAppTz(now);
  const [calls24h, failed24h, brokenOpen, cost] = await Promise.all([
    db.call.count({ where: { createdAt: { gte: since }, status: { notIn: ["QUEUED", "RINGING"] } } }),
    db.call.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
    db.promiseToPay.count({ where: { status: "BROKEN" } }),
    db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: todayStart } } }),
  ]);
  return { calls24h, failed24h, brokenOpen, costToday: Number(cost._sum.estimatedCost ?? 0) };
}

export async function getActiveAlerts(now = new Date()): Promise<AlertItem[]> {
  const settings = await db.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return [];
  return evaluateAlerts(await collectAlertMetrics(now), {
    alertMinSuccessRate: settings.alertMinSuccessRate,
    alertMaxBrokenPromises: settings.alertMaxBrokenPromises,
    dailyCostLimit: Number(settings.dailyCostLimit),
  });
}

const RESEND_AFTER_MS = 6 * 3_600_000;

/** Creates an owner notification per active alert, at most once per 6 hours per alert type. */
export async function runAlertSweep(now = new Date()): Promise<{ active: number; sent: number }> {
  const alerts = await getActiveAlerts(now);
  let sent = 0;
  for (const a of alerts) {
    const title = `⚠ ${a.title}`;
    const recent = await db.notification.findFirst({
      where: { title, createdAt: { gte: new Date(now.getTime() - RESEND_AFTER_MS) } },
      select: { id: true },
    });
    if (recent) continue;
    await sendOwnerNotification({ title, body: a.body });
    sent++;
  }
  return { active: alerts.length, sent };
}
