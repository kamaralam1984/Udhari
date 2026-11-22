import { db } from "./db";
import { isConnectedStatus, pct } from "./analytics";

export interface CampaignStats {
  members: number;
  /** distinct members that have had at least one call */
  called: number;
  /** distinct members that actually picked up (connected conversation) */
  reached: number;
  /** distinct members that gave a promise */
  promised: number;
  promisedAmount: number;
  fulfilled: number;
  broken: number;
  collected: number;
  /** % of members called */
  progress: number;
  /** % of reached members that promised to pay */
  successRate: number;
}

export function emptyStats(members = 0): CampaignStats {
  return { members, called: 0, reached: 0, promised: 0, promisedAmount: 0, fulfilled: 0, broken: 0, collected: 0, progress: 0, successRate: 0 };
}

export interface CampaignCallRow {
  customerId: string;
  status: string;
}
export interface CampaignPromiseRow {
  customerId: string;
  status: string;
  promisedAmount: number;
}

/** Pure roll-up so it can be unit tested without a DB. */
export function summariseCampaign(
  members: number,
  calls: CampaignCallRow[],
  promises: CampaignPromiseRow[],
  collected: number
): CampaignStats {
  const called = new Set(calls.map((c) => c.customerId));
  const reached = new Set(calls.filter((c) => isConnectedStatus(c.status)).map((c) => c.customerId));
  const active = promises.filter((p) => p.status !== "SUPERSEDED" && p.status !== "CANCELLED");
  const promised = new Set(active.map((p) => p.customerId));
  return {
    members,
    called: called.size,
    reached: reached.size,
    promised: promised.size,
    promisedAmount: active.reduce((a, p) => a + p.promisedAmount, 0),
    fulfilled: active.filter((p) => p.status === "FULFILLED").length,
    broken: active.filter((p) => p.status === "BROKEN").length,
    collected,
    progress: pct(called.size, members),
    successRate: pct(promised.size, reached.size),
  };
}

export async function campaignStatsMap(ids: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (ids.length === 0) return out;

  const [memberGroups, calls, promises, collections] = await Promise.all([
    db.campaignMember.groupBy({ by: ["campaignId"], _count: true, where: { campaignId: { in: ids } } }),
    db.call.findMany({ where: { campaignId: { in: ids } }, select: { campaignId: true, customerId: true, status: true } }),
    db.promiseToPay.findMany({
      where: { call: { campaignId: { in: ids } } },
      select: { customerId: true, status: true, promisedAmount: true, call: { select: { campaignId: true } } },
    }),
    db.cashCollection.findMany({
      where: { promise: { call: { campaignId: { in: ids } } } },
      select: { amount: true, promise: { select: { call: { select: { campaignId: true } } } } },
    }),
  ]);

  for (const id of ids) {
    const members = memberGroups.find((g) => g.campaignId === id)?._count ?? 0;
    out.set(
      id,
      summariseCampaign(
        members,
        calls.filter((c) => c.campaignId === id).map((c) => ({ customerId: c.customerId, status: c.status })),
        promises
          .filter((p) => p.call.campaignId === id)
          .map((p) => ({ customerId: p.customerId, status: p.status, promisedAmount: Number(p.promisedAmount) })),
        collections.filter((c) => c.promise?.call.campaignId === id).reduce((a, c) => a + Number(c.amount), 0)
      )
    );
  }
  return out;
}
