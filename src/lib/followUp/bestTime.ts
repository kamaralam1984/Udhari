/**
 * "Best time to call" for the follow-up scheduler.
 *
 * When an overdue follow-up becomes eligible for an AI voice call, the
 * scheduler can hold it back (instead of calling at a bad hour) and place it
 * in a slot where customers actually pick up. The decision is pure and
 * conservative so it can never silently stop collections:
 *   - needs real history first (MIN_TOTAL_CALLS), otherwise it calls now;
 *   - only defers when the current slot is clearly WORSE than the overall
 *     pick-up rate (by MARGIN_POINTS);
 *   - never defers past `maxDeferHours` after the call became eligible;
 *   - never targets a slot inside quiet hours.
 */
import { db } from "../db";
import { APP_TIMEZONE, isWithinQuietHours, partsInAppTz } from "../time";
import { NOT_CONNECTED_STATUSES } from "../analytics";
import { Prisma } from "@prisma/client";

/** Monday-first weekday x hour grids of call counts (same shape as the analytics heatmap). */
export interface SlotStats {
  total: number[][];
  connected: number[][];
}

export const MIN_SLOT_CALLS = 3;
export const MIN_TOTAL_CALLS = 30;
export const MARGIN_POINTS = 5;
const HOUR_MS = 3_600_000;

export function emptySlotStats(): SlotStats {
  return {
    total: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
    connected: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
  };
}

/** Pick-up rate (0-100) of a slot, falling back to the same hour across all weekdays; null = unknown. */
export function slotRate(stats: SlotStats, dow: number, hour: number): number | null {
  const calls = stats.total[dow]?.[hour] ?? 0;
  if (calls >= MIN_SLOT_CALLS) return ((stats.connected[dow][hour] ?? 0) / calls) * 100;
  let t = 0;
  let c = 0;
  for (let d = 0; d < 7; d++) {
    t += stats.total[d]?.[hour] ?? 0;
    c += stats.connected[d]?.[hour] ?? 0;
  }
  return t >= MIN_SLOT_CALLS ? (c / t) * 100 : null;
}

export function overallPickup(stats: SlotStats): { rate: number; calls: number } {
  let t = 0;
  let c = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      t += stats.total[d][h] ?? 0;
      c += stats.connected[d][h] ?? 0;
    }
  }
  return { rate: t ? (c / t) * 100 : 0, calls: t };
}

function rateAtDate(stats: SlotStats, d: Date): number | null {
  const p = partsInAppTz(d);
  return slotRate(stats, (p.weekday + 6) % 7, p.hour);
}

function floorToHour(d: Date): number {
  const { minute } = partsInAppTz(d);
  return d.getTime() - (minute * 60 + d.getSeconds()) * 1000 - d.getMilliseconds();
}

export interface TimingInput {
  now: Date;
  /** when the call first became due (scheduledDate + daysOverdueBeforeAiCall) — the max-defer clock starts here */
  eligibleAt: Date;
  maxDeferHours: number;
  quietStart: number;
  quietEnd: number;
  stats: SlotStats;
}

export type TimingDecision =
  | { action: "call-now"; reason: string }
  | { action: "defer"; until: Date; reason: string; currentRate: number; targetRate: number };

export function decideCallTiming(i: TimingInput): TimingDecision {
  const { rate: baseline, calls } = overallPickup(i.stats);
  if (calls < MIN_TOTAL_CALLS) return { action: "call-now", reason: `not enough call history yet (${calls}/${MIN_TOTAL_CALLS})` };

  const deadline = i.eligibleAt.getTime() + i.maxDeferHours * HOUR_MS;
  if (i.now.getTime() >= deadline) return { action: "call-now", reason: "max wait reached" };

  const current = rateAtDate(i.stats, i.now);
  if (current === null || current >= baseline - MARGIN_POINTS) return { action: "call-now", reason: "current hour is fine" };

  const firstBoundary = floorToHour(i.now) + HOUR_MS;
  for (let t = firstBoundary; t <= deadline; t += HOUR_MS) {
    const at = new Date(t);
    if (isWithinQuietHours(at, i.quietStart, i.quietEnd)) continue;
    const r = rateAtDate(i.stats, at);
    if (r !== null && r >= baseline) {
      return { action: "defer", until: at, reason: "waiting for a better pick-up slot", currentRate: Math.round(current), targetRate: Math.round(r) };
    }
  }
  return { action: "call-now", reason: "no better slot before the deadline" };
}

/** Reads the last `days` of calls placed in `mode` into weekday x hour grids (business timezone). */
export async function loadSlotStats(mode: "TEST" | "PRODUCTION", days = 60): Promise<SlotStats> {
  const tz = APP_TIMEZONE;
  const notConnected = Prisma.join([...NOT_CONNECTED_STATUSES]);
  const rows = await db.$queryRaw<{ dow: number; hour: number; total: number; connected: number }[]>`
    SELECT EXTRACT(DOW FROM l)::int AS dow, EXTRACT(HOUR FROM l)::int AS hour,
           COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ok)::int AS connected
    FROM (
      SELECT ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS l, (status::text NOT IN (${notConnected})) AS ok
      FROM "Call"
      WHERE mode::text = ${mode} AND "createdAt" >= (now() AT TIME ZONE 'UTC') - (interval '1 day' * ${days}::int)
    ) t
    GROUP BY 1, 2`;
  const stats = emptySlotStats();
  for (const r of rows) {
    const row = (r.dow + 6) % 7;
    stats.total[row][r.hour] += r.total;
    stats.connected[row][r.hour] += r.connected;
  }
  return stats;
}
