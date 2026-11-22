/**
 * Pure helpers for the Analytics page (/analytics) — bucketing, rates, the
 * call-flow graph, campaign cards and the load forecast. No DB access here so
 * everything is unit-testable (tests/unit/analytics.test.ts).
 */
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, partsInAppTz, startOfDayInAppTz } from "./time";

export type RangeKey = "24h" | "7d" | "30d";

export function parseRange(v: string | null | undefined): RangeKey {
  return v === "7d" || v === "30d" ? v : "24h";
}

/** "Connected" = reached a live conversation (same definition as the dashboard). */
export const NOT_CONNECTED_STATUSES = ["QUEUED", "RINGING", "NO_ANSWER", "BUSY", "FAILED"] as const;
export function isConnectedStatus(status: string): boolean {
  return !(NOT_CONNECTED_STATUSES as readonly string[]).includes(status);
}

/** Intents that count as "resolved on the first call" (customer committed or already paid). */
export const FCR_INTENTS = ["WILL_PAY", "PARTIAL_PAY", "ALREADY_PAID"] as const;
export const PROMISE_INTENTS = ["WILL_PAY", "PARTIAL_PAY"] as const;

export function pct(part: number, whole: number, digits = 1): number {
  if (!whole || whole <= 0) return 0;
  const f = 10 ** digits;
  return Math.round((part / whole) * 100 * f) / f;
}

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------

export interface Buckets {
  /** Absolute ms timestamp of each bucket start, oldest first. */
  starts: number[];
  stepMs: number;
  labels: string[];
  from: Date;
}

function floorToHour(now: Date): number {
  const { minute } = partsInAppTz(now);
  return now.getTime() - (minute * 60 + now.getSeconds()) * 1000 - now.getMilliseconds();
}

export function buildBuckets(now: Date, range: RangeKey): Buckets {
  const hourly = range === "24h";
  const stepMs = hourly ? 3_600_000 : 86_400_000;
  const n = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const last = hourly ? floorToHour(now) : startOfDayInAppTz(now).getTime();
  const starts = Array.from({ length: n }, (_, i) => last - (n - 1 - i) * stepMs);
  const labels = starts.map((s) => formatInTimeZone(new Date(s), APP_TIMEZONE, hourly ? "ha" : "dd MMM"));
  return { starts, stepMs, labels, from: new Date(starts[0]) };
}

export function bucketIndex(t: Date | number, b: Buckets): number {
  const ms = typeof t === "number" ? t : t.getTime();
  const idx = Math.floor((ms - b.starts[0]) / b.stepMs);
  return idx >= 0 && idx < b.starts.length ? idx : -1;
}

// ---------------------------------------------------------------------------
// Volume / wait time / first-call-resolution per bucket
// ---------------------------------------------------------------------------

export interface CallRow {
  createdAt: Date;
  startedAt: Date | null;
  status: string;
  paymentIntent: string | null;
}

export interface VolumeSeries {
  connected: number[];
  missed: number[];
  /** Average ring-to-pickup wait in seconds, per bucket (0 when no connected calls). */
  waitAvgSec: number[];
  /** % of connected calls resolved on the first call, per bucket. */
  fcr: number[];
}

export function summariseCalls(calls: CallRow[], b: Buckets): VolumeSeries {
  const n = b.starts.length;
  const connected = new Array<number>(n).fill(0);
  const missed = new Array<number>(n).fill(0);
  const waitSum = new Array<number>(n).fill(0);
  const waitCnt = new Array<number>(n).fill(0);
  const fcrHit = new Array<number>(n).fill(0);

  for (const c of calls) {
    const i = bucketIndex(c.createdAt, b);
    if (i < 0) continue;
    if (isConnectedStatus(c.status)) {
      connected[i]++;
      if (c.startedAt) {
        const wait = (c.startedAt.getTime() - c.createdAt.getTime()) / 1000;
        if (wait >= 0 && wait < 600) {
          waitSum[i] += wait;
          waitCnt[i]++;
        }
      }
      if (c.paymentIntent && (FCR_INTENTS as readonly string[]).includes(c.paymentIntent)) fcrHit[i]++;
    } else {
      missed[i]++;
    }
  }

  return {
    connected,
    missed,
    waitAvgSec: waitSum.map((s, i) => (waitCnt[i] ? Math.round((s / waitCnt[i]) * 10) / 10 : 0)),
    fcr: fcrHit.map((h, i) => pct(h, connected[i])),
  };
}

/** rows come from SQL EXTRACT(DOW) (0 = Sunday); output is Mon..Sun x 24 hours. */
export function buildHeatmap(rows: { dow: number; hour: number; count: number }[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    const row = (r.dow + 6) % 7; // Sunday(0) -> 6, Monday(1) -> 0
    if (row >= 0 && row < 7 && r.hour >= 0 && r.hour < 24) grid[row][r.hour] += r.count;
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Call flow (sankey) graph
// ---------------------------------------------------------------------------

export interface FlowInput {
  total: number;
  connected: number;
  noAnswer: number; // NO_ANSWER + BUSY
  failed: number;
  inQueue: number; // QUEUED + RINGING
  promises: number;
  review: number; // AI_UNCERTAIN + CALLBACK_REQUESTED + WRONG_NUMBER
  fulfilled: number;
  broken: number;
}

export interface FlowNode {
  id: string;
  label: string;
  col: number;
  value: number;
  tone: "violet" | "cyan" | "green" | "red" | "amber" | "pink" | "slate";
}
export interface FlowLink {
  from: string;
  to: string;
  value: number;
}

export function buildFlow(i: FlowInput): { nodes: FlowNode[]; links: FlowLink[] } {
  if (i.total <= 0) return { nodes: [], links: [] };

  const promisesOut = Math.min(i.promises, i.connected);
  const reviewOut = Math.min(i.review, Math.max(0, i.connected - promisesOut));
  const otherOut = Math.max(0, i.connected - promisesOut - reviewOut);
  const fulfilled = Math.min(i.fulfilled, promisesOut);
  const broken = Math.min(i.broken, promisesOut - fulfilled);
  const pending = promisesOut - fulfilled - broken;

  const allNodes: FlowNode[] = [
    { id: "total", label: "Calls placed", col: 0, value: i.total, tone: "violet" },
    { id: "connected", label: "Connected", col: 1, value: i.connected, tone: "cyan" },
    { id: "noAnswer", label: "No answer / busy", col: 1, value: i.noAnswer, tone: "amber" },
    { id: "failed", label: "Failed", col: 1, value: i.failed, tone: "red" },
    { id: "queue", label: "Queued / ringing", col: 1, value: i.inQueue, tone: "slate" },
    { id: "promise", label: "Promise captured", col: 2, value: promisesOut, tone: "green" },
    { id: "review", label: "Needs review", col: 2, value: reviewOut, tone: "pink" },
    { id: "other", label: "No commitment", col: 2, value: otherOut, tone: "slate" },
    { id: "fulfilled", label: "Paid / kept", col: 3, value: fulfilled, tone: "green" },
    { id: "broken", label: "Broken", col: 3, value: broken, tone: "red" },
    { id: "pending", label: "Pending", col: 3, value: pending, tone: "amber" },
  ];
  const nodes = allNodes.filter((n) => n.value > 0);

  const ids = new Set(nodes.map((n) => n.id));
  const links: FlowLink[] = (
    [
      ["total", "connected", i.connected],
      ["total", "noAnswer", i.noAnswer],
      ["total", "failed", i.failed],
      ["total", "queue", i.inQueue],
      ["connected", "promise", promisesOut],
      ["connected", "review", reviewOut],
      ["connected", "other", otherOut],
      ["promise", "fulfilled", fulfilled],
      ["promise", "broken", broken],
      ["promise", "pending", pending],
    ] as [string, string, number][]
  )
    .filter(([a, b, v]) => v > 0 && ids.has(a) && ids.has(b))
    .map(([from, to, value]) => ({ from, to, value }));

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Campaign / programme cards
// ---------------------------------------------------------------------------

export interface CampaignCard {
  key: string;
  name: string;
  /** 0-100 */
  progress: number;
  /** 0-100 */
  successRate: number;
  done: number;
  total: number;
  active: boolean;
  href: string;
  /** "campaign" = a real Campaign row, "program" = derived from promises/follow-ups/tasks */
  kind?: "campaign" | "program";
}

export interface CampaignInput {
  promisesFulfilled: number;
  promisesBroken: number;
  promisesActive: number;
  followUpsCompleted: number;
  followUpsPending: number;
  followUpCalls: number;
  followUpCallsConnected: number;
  collected: number;
  outstanding: number;
  customersTotal: number;
  customersCleared: number;
  tasksResolved: number;
  tasksOpen: number;
}

export function buildCampaigns(i: CampaignInput): CampaignCard[] {
  const promisesTotal = i.promisesFulfilled + i.promisesBroken + i.promisesActive;
  const followTotal = i.followUpsCompleted + i.followUpsPending;
  const tasksTotal = i.tasksResolved + i.tasksOpen;
  return [
    {
      key: "promises",
      name: "Promise-to-Pay Follow-through",
      progress: pct(i.promisesFulfilled + i.promisesBroken, promisesTotal),
      successRate: pct(i.promisesFulfilled, i.promisesFulfilled + i.promisesBroken),
      done: i.promisesFulfilled + i.promisesBroken,
      total: promisesTotal,
      active: i.promisesActive > 0,
      href: "/promises",
    },
    {
      key: "followups",
      name: "Scheduled Follow-up Calls",
      progress: pct(i.followUpsCompleted, followTotal),
      successRate: pct(i.followUpCallsConnected, i.followUpCalls),
      done: i.followUpsCompleted,
      total: followTotal,
      active: i.followUpsPending > 0,
      href: "/calls",
    },
    {
      key: "recovery",
      name: "Outstanding Recovery Drive",
      progress: pct(i.collected, i.collected + i.outstanding),
      successRate: pct(i.customersCleared, i.customersTotal),
      done: Math.round(i.collected),
      total: Math.round(i.collected + i.outstanding),
      active: i.outstanding > 0,
      href: "/cash-collections",
    },
    {
      key: "tasks",
      name: "Staff Review Queue",
      progress: pct(i.tasksResolved, tasksTotal),
      successRate: pct(i.tasksResolved, tasksTotal),
      done: i.tasksResolved,
      total: tasksTotal,
      active: i.tasksOpen > 0,
      href: "/dashboard",
    },
  ];
}

// ---------------------------------------------------------------------------
// Load forecast: last 7 days actual calls + next 7 days of scheduled follow-ups
// ---------------------------------------------------------------------------

export function dayCounts(dates: Date[], firstDayStartMs: number, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const d of dates) {
    const i = Math.floor((d.getTime() - firstDayStartMs) / 86_400_000);
    if (i >= 0 && i < days) out[i]++;
  }
  return out;
}

export function dayLabels(firstDayStartMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    formatInTimeZone(new Date(firstDayStartMs + i * 86_400_000), APP_TIMEZONE, "dd MMM")
  );
}

export function weekdayLabel(index: number): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "";
}

// ---------------------------------------------------------------------------
// Custom date ranges + previous-period comparison
// ---------------------------------------------------------------------------

export type RangeKeyOrCustom = RangeKey | "custom";

export interface RangeSpec {
  key: RangeKeyOrCustom;
  buckets: Buckets;
  /** inclusive start / exclusive end of the selected window */
  from: Date;
  to: Date;
  /** same-length window immediately before `from` (for "vs previous period") */
  prevFrom: Date;
  prevTo: Date;
  /** human label for the window, e.g. "01 Nov – 07 Nov" */
  label: string;
}

const MAX_CUSTOM_DAYS = 92;

/** Bucket a custom [from, to] window: hourly when ≤ 48h, otherwise daily (capped at ~3 months). */
export function buildCustomBuckets(from: Date, toInclusive: Date): Buckets {
  const spanMs = Math.max(1, toInclusive.getTime() - from.getTime());
  const hourly = spanMs <= 48 * 3_600_000;
  const stepMs = hourly ? 3_600_000 : 86_400_000;
  const first = hourly ? floorToHour(from) : startOfDayInAppTz(from).getTime();
  const end = hourly ? floorToHour(toInclusive) : startOfDayInAppTz(toInclusive).getTime();
  const n = Math.min(hourly ? 49 : MAX_CUSTOM_DAYS, Math.max(1, Math.floor((end - first) / stepMs) + 1));
  const starts = Array.from({ length: n }, (_, i) => first + i * stepMs);
  const labels = starts.map((s) => formatInTimeZone(new Date(s), APP_TIMEZONE, hourly ? "d MMM ha" : "dd MMM"));
  return { starts, stepMs, labels, from: new Date(first) };
}

/** "YYYY-MM-DD" (business timezone midnight) -> Date, or null when malformed. */
export function parseDay(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return startOfDayInAppTz(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function resolveRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  now: Date
): RangeSpec {
  const f = parseDay(params.from);
  const t = parseDay(params.to);
  if (params.range === "custom" && f && t && t.getTime() >= f.getTime()) {
    const to = new Date(startOfDayInAppTz(t).getTime() + 86_400_000);
    // `t` is a calendar day, so the window's inclusive end is the last millisecond of that day.
    const buckets = buildCustomBuckets(f, new Date(to.getTime() - 1));
    const len = to.getTime() - buckets.from.getTime();
    return {
      key: "custom",
      buckets,
      from: buckets.from,
      to,
      prevFrom: new Date(buckets.from.getTime() - len),
      prevTo: buckets.from,
      label: `${formatInTimeZone(f, APP_TIMEZONE, "dd MMM")} – ${formatInTimeZone(t, APP_TIMEZONE, "dd MMM yyyy")}`,
    };
  }
  const key = parseRange(params.range);
  const buckets = buildBuckets(now, key);
  const to = new Date(buckets.starts[buckets.starts.length - 1] + buckets.stepMs);
  const len = to.getTime() - buckets.from.getTime();
  return {
    key,
    buckets,
    from: buckets.from,
    to,
    prevFrom: new Date(buckets.from.getTime() - len),
    prevTo: buckets.from,
    label: key === "24h" ? "Last 24 hours" : key === "7d" ? "Last 7 days" : "Last 30 days",
  };
}

/** % change vs previous period; null when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Best time to call (pick-up rate by weekday x hour)
// ---------------------------------------------------------------------------

export interface BestSlot {
  dow: number; // 0 = Monday .. 6 = Sunday (same as heatmap rows)
  hour: number;
  rate: number; // % connected
  calls: number;
}

export function bestCallSlots(total: number[][], connected: number[][], minCalls = 3, top = 3): BestSlot[] {
  const slots: BestSlot[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const calls = total[d]?.[h] ?? 0;
      if (calls >= minCalls) slots.push({ dow: d, hour: h, rate: pct(connected[d]?.[h] ?? 0, calls), calls });
    }
  }
  return slots.sort((a, b) => b.rate - a.rate || b.calls - a.calls).slice(0, top);
}

export function formatHourRange(h: number): string {
  const f = (x: number) => (x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`);
  return `${f(h)}–${f((h + 1) % 24)}`;
}

// ---------------------------------------------------------------------------
// Customer payment-risk score
// ---------------------------------------------------------------------------

export interface RiskInput {
  outstanding: number;
  calls: number;
  noAnswer: number; // NO_ANSWER + BUSY + FAILED
  promisesBroken: number;
  promisesFulfilled: number;
  daysSincePayment: number | null; // null = never paid / unknown
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Transparent 0-100 heuristic (higher = riskier). Not a prediction model — it
 * weighs the same signals staff already eyeball: broken promises, unreachable
 * phone, how long since the last payment and how big the balance is.
 */
export function riskScore(i: RiskInput): { score: number; level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const promisesTotal = i.promisesBroken + i.promisesFulfilled;
  if (promisesTotal > 0) {
    const brokenShare = i.promisesBroken / promisesTotal;
    const pts = Math.round(brokenShare * 35);
    score += pts;
    if (i.promisesBroken > 0) reasons.push(`${i.promisesBroken} promise toote`);
  } else if (i.calls >= 3) {
    score += 10; // called several times, never a promise
    reasons.push("kai calls, koi promise nahi");
  }

  if (i.calls > 0) {
    const unreachable = i.noAnswer / i.calls;
    score += Math.round(unreachable * 25);
    if (unreachable >= 0.5 && i.calls >= 2) reasons.push("phone aksar nahi uthta");
  }

  if (i.daysSincePayment === null) {
    score += 15;
    reasons.push("kabhi payment nahi / record nahi");
  } else {
    score += Math.min(15, Math.round((i.daysSincePayment / 90) * 15));
    if (i.daysSincePayment > 60) reasons.push(`${i.daysSincePayment} din se payment nahi`);
  }

  if (i.outstanding >= 100_000) score += 15;
  else if (i.outstanding >= 50_000) score += 10;
  else if (i.outstanding >= 10_000) score += 5;
  if (i.outstanding >= 50_000) reasons.push("bada outstanding");

  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW", reasons };
}

// ---------------------------------------------------------------------------
// Cost vs collection
// ---------------------------------------------------------------------------

export function roi(collected: number, cost: number): { ratio: number | null; net: number } {
  return { ratio: cost > 0 ? Math.round((collected / cost) * 10) / 10 : null, net: Math.round(collected - cost) };
}
