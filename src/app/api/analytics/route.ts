import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { APP_TIMEZONE, startOfDayInAppTz } from "@/lib/time";
import { getActiveAlerts } from "@/lib/alerts";
import { getAppSettings } from "@/lib/antiSpam";
import { campaignStatsMap } from "@/lib/campaigns";
import {
  bestCallSlots,
  buildCampaigns,
  buildFlow,
  buildHeatmap,
  dayCounts,
  dayLabels,
  isConnectedStatus,
  NOT_CONNECTED_STATUSES,
  pct,
  pctChange,
  PROMISE_INTENTS,
  resolveRange,
  riskScore,
  roi as roiOf,
  summariseCalls,
  type CampaignCard,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

interface TrendRow {
  key: string;
  total: number;
  connected: number;
  promises: number;
}
interface CollectionTrendRow {
  key: string;
  amount: number;
}

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  // STAFF see operational numbers but not money/customer-balance data, and only their own row in the leaderboard.
  const isStaff = session.role === "STAFF";

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const spec = resolveRange({ range: sp.get("range"), from: sp.get("from"), to: sp.get("to") }, now);
  const range = spec.key;
  const b = spec.buckets;
  const from = spec.from;
  const to = spec.to;
  const wantCompare = sp.get("compare") === "1";
  const inRange = { gte: from, lt: to };
  const tz = APP_TIMEZONE;
  const todayStart = startOfDayInAppTz(now);
  const last7Start = todayStart.getTime() - 6 * DAY;
  const liveCutoff = new Date(now.getTime() - 30 * 60 * 1000);

  const notConnected = Prisma.join([...NOT_CONNECTED_STATUSES]);

  const [
    rangeCalls,
    last7Calls,
    concurrent,
    callsToday,
    collectedToday,
    heatRows,
    monthlyRows,
    weeklyRows,
    weeklyCollectionRows,
    promiseRangeGroups,
    promiseAllGroups,
    followUpGroups,
    upcomingFollowUps,
    overdueFollowUps,
    taskGroups,
    tasksResolvedByUser,
    users,
    callsByUser,
    collectionsByUser,
    collectedRange,
    usageGroups,
    timelineCalls,
    customersTotal,
    customersDnc,
    customersOutstandingCount,
    outstandingAgg,
    languageGroups,
    topOutstanding,
    realCampaigns,
    alerts,
    prevCalls,
    prevCollected,
    prevCost,
    riskCalls,
    riskPromises,
  ] = await Promise.all([
    db.call.findMany({
      where: { createdAt: inRange },
      select: {
        createdAt: true,
        startedAt: true,
        status: true,
        paymentIntent: true,
        confidence: true,
        language: true,
        mode: true,
        followUpId: true,
      },
      take: 50_000,
    }),
    db.call.findMany({ where: { createdAt: { gte: new Date(last7Start) } }, select: { createdAt: true }, take: 50_000 }),
    db.call.count({ where: { status: { in: ["RINGING", "CONNECTED"] }, updatedAt: { gte: liveCutoff } } }),
    db.call.count({ where: { createdAt: { gte: todayStart } } }),
    db.cashCollection.aggregate({ _sum: { amount: true }, where: { collectedAt: { gte: todayStart } } }),
    db.$queryRaw<{ dow: number; hour: number; count: number; connected: number }[]>`
      SELECT EXTRACT(DOW FROM l)::int AS dow, EXTRACT(HOUR FROM l)::int AS hour, COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE ok)::int AS connected
      FROM (
        SELECT ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS l,
               (status::text NOT IN (${notConnected})) AS ok
        FROM "Call"
        WHERE "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'
      ) t
      GROUP BY 1, 2`,
    db.$queryRaw<TrendRow[]>`
      SELECT to_char(g.b, 'YYYY-MM-DD') AS key,
             COALESCE(c.total, 0)::int AS total,
             COALESCE(c.connected, 0)::int AS connected,
             COALESCE(c.promises, 0)::int AS promises
      FROM generate_series(
        date_trunc('month', now() AT TIME ZONE ${tz}) - interval '5 months',
        date_trunc('month', now() AT TIME ZONE ${tz}),
        interval '1 month') AS g(b)
      LEFT JOIN (
        SELECT date_trunc('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS b,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status::text NOT IN (${notConnected})) AS connected,
               COUNT(*) FILTER (WHERE "paymentIntent"::text IN ('WILL_PAY','PARTIAL_PAY')) AS promises
        FROM "Call"
        WHERE "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '200 days'
        GROUP BY 1
      ) c ON c.b = g.b
      ORDER BY g.b`,
    db.$queryRaw<TrendRow[]>`
      SELECT to_char(g.b, 'YYYY-MM-DD') AS key,
             COALESCE(c.total, 0)::int AS total,
             COALESCE(c.connected, 0)::int AS connected,
             COALESCE(c.promises, 0)::int AS promises
      FROM generate_series(
        date_trunc('week', now() AT TIME ZONE ${tz}) - interval '7 weeks',
        date_trunc('week', now() AT TIME ZONE ${tz}),
        interval '1 week') AS g(b)
      LEFT JOIN (
        SELECT date_trunc('week', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS b,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status::text NOT IN (${notConnected})) AS connected,
               COUNT(*) FILTER (WHERE "paymentIntent"::text IN ('WILL_PAY','PARTIAL_PAY')) AS promises
        FROM "Call"
        WHERE "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '60 days'
        GROUP BY 1
      ) c ON c.b = g.b
      ORDER BY g.b`,
    db.$queryRaw<CollectionTrendRow[]>`
      SELECT to_char(g.b, 'YYYY-MM-DD') AS key, COALESCE(c.amount, 0)::float8 AS amount
      FROM generate_series(
        date_trunc('week', now() AT TIME ZONE ${tz}) - interval '7 weeks',
        date_trunc('week', now() AT TIME ZONE ${tz}),
        interval '1 week') AS g(b)
      LEFT JOIN (
        SELECT date_trunc('week', ("collectedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS b, SUM(amount) AS amount
        FROM "CashCollection"
        WHERE "collectedAt" >= (now() AT TIME ZONE 'UTC') - interval '60 days'
        GROUP BY 1
      ) c ON c.b = g.b
      ORDER BY g.b`,
    db.promiseToPay.groupBy({ by: ["status"], _count: true, where: { call: { createdAt: inRange } } }),
    db.promiseToPay.groupBy({ by: ["status"], _count: true }),
    db.followUp.groupBy({ by: ["status"], _count: true }),
    db.followUp.findMany({
      where: { status: "PENDING", scheduledDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 7 * DAY) } },
      select: { scheduledDate: true },
    }),
    db.followUp.count({ where: { status: "PENDING", scheduledDate: { lt: todayStart } } }),
    db.staffTask.groupBy({ by: ["status"], _count: true }),
    db.staffTask.groupBy({
      by: ["resolvedById"],
      _count: true,
      where: { status: "RESOLVED", resolvedAt: inRange, resolvedById: { not: null } },
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    db.call.groupBy({
      by: ["initiatedByUserId"],
      _count: true,
      where: { createdAt: inRange, initiatedByUserId: { not: null } },
    }),
    db.cashCollection.groupBy({
      by: ["collectedById"],
      _sum: { amount: true },
      _count: true,
      where: { collectedAt: inRange },
    }),
    db.cashCollection.aggregate({ _sum: { amount: true }, _count: true, where: { collectedAt: inRange } }),
    db.callUsageLog.groupBy({
      by: ["provider", "providerName"],
      _sum: { estimatedCost: true },
      _count: true,
      where: { createdAt: inRange },
    }),
    db.call.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        status: true,
        summary: true,
        customerResponse: true,
        paymentIntent: true,
        duration: true,
        language: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
    }),
    db.customer.count(),
    db.customer.count({ where: { doNotCall: true } }),
    db.customer.count({ where: { outstandingAmount: { gt: 0 } } }),
    db.customer.aggregate({ _sum: { outstandingAmount: true } }),
    db.customer.groupBy({ by: ["preferredLanguage"], _count: true }),
    db.customer.findMany({
      where: { outstandingAmount: { gt: 0 } },
      orderBy: { outstandingAmount: "desc" },
      take: 25,
      select: { id: true, name: true, phoneNumber: true, outstandingAmount: true, lastPaymentDate: true, doNotCall: true },
    }),
    db.campaign.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, status: true } }),
    getActiveAlerts(now),
    wantCompare
      ? db.call.findMany({
          where: { createdAt: { gte: spec.prevFrom, lt: spec.prevTo } },
          select: { status: true, paymentIntent: true },
          take: 50_000,
        })
      : Promise.resolve([] as { status: string; paymentIntent: string | null }[]),
    wantCompare
      ? db.cashCollection.aggregate({ _sum: { amount: true }, where: { collectedAt: { gte: spec.prevFrom, lt: spec.prevTo } } })
      : Promise.resolve(null),
    wantCompare
      ? db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: spec.prevFrom, lt: spec.prevTo } } })
      : Promise.resolve(null),
    isStaff ? Promise.resolve([]) : db.call.groupBy({ by: ["customerId", "status"], _count: true }),
    isStaff ? Promise.resolve([]) : db.promiseToPay.groupBy({ by: ["customerId", "status"], _count: true }),
  ]);

  // ---- calls in range ------------------------------------------------------
  const series = summariseCalls(rangeCalls, b);
  const total = rangeCalls.length;
  const connected = rangeCalls.filter((c) => isConnectedStatus(c.status)).length;
  const failed = rangeCalls.filter((c) => c.status === "FAILED").length;
  const missed = rangeCalls.filter((c) => c.status === "NO_ANSWER" || c.status === "BUSY").length;
  const inQueue = rangeCalls.filter((c) => c.status === "QUEUED" || c.status === "RINGING").length;
  const review = rangeCalls.filter(
    (c) => c.status === "AI_UNCERTAIN" || c.status === "CALLBACK_REQUESTED" || c.status === "WRONG_NUMBER"
  ).length;
  const promiseCalls = rangeCalls.filter(
    (c) => c.paymentIntent && (PROMISE_INTENTS as readonly string[]).includes(c.paymentIntent)
  ).length;
  const confidences = rangeCalls.filter((c) => c.confidence != null && isConnectedStatus(c.status)).map((c) => c.confidence as number);
  const avgConfidence = confidences.length ? pct(confidences.reduce((a, x) => a + x, 0), confidences.length) : 0;
  const waitVals = series.waitAvgSec.filter((v) => v > 0);
  const avgWait = waitVals.length ? Math.round((waitVals.reduce((a, x) => a + x, 0) / waitVals.length) * 10) / 10 : 0;
  const fcrOverall = pct(
    rangeCalls.filter((c) => isConnectedStatus(c.status) && c.paymentIntent && ["WILL_PAY", "PARTIAL_PAY", "ALREADY_PAID"].includes(c.paymentIntent)).length,
    connected
  );

  const pgCount = (groups: { status: string; _count: number }[], s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  const pRange = {
    fulfilled: pgCount(promiseRangeGroups, "FULFILLED"),
    broken: pgCount(promiseRangeGroups, "BROKEN"),
    total: promiseRangeGroups.filter((g) => g.status !== "SUPERSEDED" && g.status !== "CANCELLED").reduce((a, g) => a + g._count, 0),
  };
  const pAll = {
    fulfilled: pgCount(promiseAllGroups, "FULFILLED"),
    broken: pgCount(promiseAllGroups, "BROKEN"),
    active: pgCount(promiseAllGroups, "ACTIVE"),
  };

  const flow = buildFlow({
    total,
    connected,
    noAnswer: missed,
    failed,
    inQueue,
    promises: Math.max(pRange.total, promiseCalls),
    review,
    fulfilled: pRange.fulfilled,
    broken: pRange.broken,
  });

  // ---- gauges --------------------------------------------------------------
  const tasksResolvedTotal = taskGroups.find((g) => g.status === "RESOLVED")?._count ?? 0;
  const tasksOpenTotal = taskGroups.filter((g) => g.status !== "RESOLVED").reduce((a, g) => a + g._count, 0);
  const callSuccessRate = total > 0 ? Math.round(((total - failed) / total) * 10000) / 100 : 100;

  // ---- campaigns (real ones first, then the derived programmes) -----------
  const followUpCalls = rangeCalls.filter((c) => c.followUpId);
  const collectedRangeAmount = isStaff ? 0 : Number(collectedRange._sum.amount ?? 0);
  const outstandingTotal = isStaff ? 0 : Number(outstandingAgg._sum.outstandingAmount ?? 0);
  const programmes = buildCampaigns({
    promisesFulfilled: pAll.fulfilled,
    promisesBroken: pAll.broken,
    promisesActive: pAll.active,
    followUpsCompleted: followUpGroups.find((g) => g.status === "COMPLETED")?._count ?? 0,
    followUpsPending: followUpGroups.find((g) => g.status === "PENDING")?._count ?? 0,
    followUpCalls: followUpCalls.length,
    followUpCallsConnected: followUpCalls.filter((c) => isConnectedStatus(c.status)).length,
    collected: collectedRangeAmount,
    outstanding: outstandingTotal,
    customersTotal,
    customersCleared: customersTotal - customersOutstandingCount,
    tasksResolved: tasksResolvedTotal,
    tasksOpen: tasksOpenTotal,
  }).filter((c) => !(isStaff && c.key === "recovery"));
  const realStats = await campaignStatsMap(realCampaigns.map((c) => c.id));
  const realCards: CampaignCard[] = realCampaigns.map((c) => {
    const st = realStats.get(c.id)!;
    return {
      key: `c-${c.id}`,
      name: c.name,
      progress: st.progress,
      successRate: st.successRate,
      done: st.called,
      total: st.members,
      active: c.status === "ACTIVE",
      href: `/campaigns/${c.id}`,
      kind: "campaign",
    };
  });
  const campaigns = [...realCards, ...programmes];

  // ---- agents --------------------------------------------------------------
  const resolvedMap = new Map(tasksResolvedByUser.map((r) => [r.resolvedById as string, r._count]));
  const initiatedMap = new Map(callsByUser.map((r) => [r.initiatedByUserId as string, r._count]));
  const collectionMap = new Map(collectionsByUser.map((r) => [r.collectedById, r]));
  const agents = users
    .filter((u) => !isStaff || u.id === session.sub)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      callsInitiated: initiatedMap.get(u.id) ?? 0,
      tasksResolved: resolvedMap.get(u.id) ?? 0,
      collections: collectionMap.get(u.id)?._count ?? 0,
      collected: Number(collectionMap.get(u.id)?._sum.amount ?? 0),
    }))
    .sort((a, c) => c.collected - a.collected || c.tasksResolved - a.tasksResolved || c.callsInitiated - a.callsInitiated);

  // ---- connectivity map ----------------------------------------------------
  const providers = usageGroups.map((g) => ({
    kind: g.provider,
    name: g.providerName,
    cost: Number(g._sum.estimatedCost ?? 0),
    count: g._count,
  }));
  const costRange = providers.reduce((a, p) => a + p.cost, 0);
  const languageMap = new Map<string, number>();
  for (const c of rangeCalls) languageMap.set(c.language || "unknown", (languageMap.get(c.language || "unknown") ?? 0) + 1);
  const testCalls = rangeCalls.filter((c) => c.mode === "TEST").length;

  // ---- heatmap + best time to call ----------------------------------------
  const heatTotal = buildHeatmap(heatRows.map((r) => ({ dow: r.dow, hour: r.hour, count: r.count })));
  const heatConnected = buildHeatmap(heatRows.map((r) => ({ dow: r.dow, hour: r.hour, count: r.connected })));
  const bestSlots = bestCallSlots(heatTotal, heatConnected);
  const schedulerCfg = await getAppSettings();

  // ---- trends --------------------------------------------------------------
  const monthLabel = (key: string) => formatInTimeZone(new Date(`${key}T00:00:00Z`), "UTC", "MMM");
  const weekLabel = (key: string) => formatInTimeZone(new Date(`${key}T00:00:00Z`), "UTC", "dd MMM");
  const weeklyCollections = new Map(weeklyCollectionRows.map((r) => [r.key, r.amount]));

  const actual7 = dayCounts(last7Calls.map((c) => c.createdAt), last7Start, 7);
  const planned7 = dayCounts(upcomingFollowUps.map((f) => f.scheduledDate), todayStart.getTime(), 7);
  const plannedWithBacklog = planned7.map((v, i) => (i === 0 ? v + overdueFollowUps : v));

  // ---- previous-period comparison -----------------------------------------
  const compare = wantCompare
    ? (() => {
        const prevTotal = prevCalls.length;
        const prevConnected = prevCalls.filter((c) => isConnectedStatus(c.status)).length;
        const prevPromises = prevCalls.filter((c) => c.paymentIntent && (PROMISE_INTENTS as readonly string[]).includes(c.paymentIntent)).length;
        const prevCollectedAmt = isStaff ? 0 : Number(prevCollected?._sum.amount ?? 0);
        const prevCostAmt = Number(prevCost?._sum.estimatedCost ?? 0);
        return {
          label: `${spec.prevFrom.toISOString().slice(0, 10)} → ${spec.prevTo.toISOString().slice(0, 10)}`,
          prev: { total: prevTotal, connected: prevConnected, promises: prevPromises, collected: prevCollectedAmt, cost: prevCostAmt },
          delta: {
            total: pctChange(total, prevTotal),
            connected: pctChange(connected, prevConnected),
            promises: pctChange(promiseCalls, prevPromises),
            collected: isStaff ? null : pctChange(collectedRangeAmount, prevCollectedAmt),
            cost: pctChange(costRange, prevCostAmt),
          },
        };
      })()
    : null;

  // ---- customer risk (OWNER / ADMIN only) ----------------------------------
  const nowMs = now.getTime();
  const customersBlock = isStaff
    ? null
    : {
        total: customersTotal,
        doNotCall: customersDnc,
        withOutstanding: customersOutstandingCount,
        outstandingTotal,
        languages: languageGroups.map((g) => ({ language: g.preferredLanguage, count: g._count })).sort((a, c) => c.count - a.count),
        topOutstanding: topOutstanding.map((c) => {
          const myCalls = riskCalls.filter((r) => r.customerId === c.id);
          const myPromises = riskPromises.filter((r) => r.customerId === c.id);
          const sum = (rows: { _count: number; status: string }[], pred: (st: string) => boolean) =>
            rows.filter((r) => pred(r.status)).reduce((a, r) => a + r._count, 0);
          const risk = riskScore({
            outstanding: Number(c.outstandingAmount),
            calls: sum(myCalls, () => true),
            noAnswer: sum(myCalls, (st) => st === "NO_ANSWER" || st === "BUSY" || st === "FAILED"),
            promisesBroken: sum(myPromises, (st) => st === "BROKEN"),
            promisesFulfilled: sum(myPromises, (st) => st === "FULFILLED"),
            daysSincePayment: c.lastPaymentDate ? Math.floor((nowMs - c.lastPaymentDate.getTime()) / DAY) : null,
          });
          return {
            id: c.id,
            name: c.name,
            phone: c.phoneNumber,
            outstanding: Number(c.outstandingAmount),
            lastPaymentDate: c.lastPaymentDate?.toISOString() ?? null,
            doNotCall: c.doNotCall,
            risk,
          };
        }),
      };

  return NextResponse.json({
    range,
    rangeLabel: spec.label,
    from: spec.from.toISOString(),
    to: spec.to.toISOString(),
    generatedAt: now.toISOString(),
    viewer: { role: session.role, scope: isStaff ? "self" : "all" },
    alerts,
    compare,
    live: {
      concurrent,
      callsToday,
      collectedToday: isStaff ? 0 : Number(collectedToday._sum.amount ?? 0),
      mode: rangeCalls.length > 0 && testCalls === rangeCalls.length ? "TEST" : testCalls > 0 ? "MIXED" : "PRODUCTION",
    },
    totals: { total, connected, missed, failed, inQueue, avgWaitSec: avgWait, fcr: fcrOverall, avgConfidence, promises: promiseCalls },
    gauges: {
      callSuccessRate,
      staffResolutionRate: pct(tasksResolvedTotal, tasksResolvedTotal + tasksOpenTotal),
      openTasks: tasksOpenTotal,
    },
    roi: isStaff ? null : { collected: collectedRangeAmount, cost: Math.round(costRange * 100) / 100, ...roiOf(collectedRangeAmount, costRange) },
    volume: { labels: b.labels, connected: series.connected, missed: series.missed, starts: b.starts, stepMs: b.stepMs },
    wait: { labels: b.labels, values: series.waitAvgSec },
    fcr: { labels: b.labels, values: series.fcr },
    heatmap: heatTotal,
    heatmapConnected: heatConnected,
    bestSlots,
    scheduler: { useBestCallTime: schedulerCfg.useBestCallTime, maxDeferHours: schedulerCfg.bestCallMaxDeferHours },
    flow,
    campaigns,
    agents,
    ai: { callsHandled: connected, avgConfidence },
    timeline: timelineCalls.map((c) => ({
      id: c.id,
      customer: c.customer.name,
      status: c.status,
      intent: c.paymentIntent,
      summary: c.summary || c.customerResponse || null,
      duration: c.duration,
      language: c.language,
      createdAt: c.createdAt.toISOString(),
    })),
    network: {
      providers,
      languages: [...languageMap.entries()].map(([language, count]) => ({ language, count })).sort((a, c) => c.count - a.count),
      totalCalls: total,
    },
    trends: {
      monthly: {
        labels: monthlyRows.map((r) => monthLabel(r.key)),
        total: monthlyRows.map((r) => r.total),
        connected: monthlyRows.map((r) => r.connected),
      },
      efficiency: {
        labels: weeklyRows.map((r) => weekLabel(r.key)),
        promiseRate: weeklyRows.map((r) => pct(r.promises, r.connected)),
        connectRate: weeklyRows.map((r) => pct(r.connected, r.total)),
        collected: weeklyRows.map((r) => (isStaff ? 0 : Math.round(weeklyCollections.get(r.key) ?? 0))),
      },
      forecast: {
        labels: [...dayLabels(last7Start, 7), ...dayLabels(todayStart.getTime() + DAY, 6)],
        actual: actual7,
        planned: plannedWithBacklog,
        overdueBacklog: overdueFollowUps,
      },
    },
    customers: customersBlock,
    collected: { amount: collectedRangeAmount, count: isStaff ? 0 : collectedRange._count },
  });
}
