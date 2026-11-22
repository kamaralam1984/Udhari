import { describe, expect, it } from "vitest";
import { bucketIndex, buildBuckets, buildCampaigns, buildFlow, buildHeatmap, dayCounts, parseRange, pct, summariseCalls } from "@/lib/analytics";

describe("analytics helpers", () => {
  it("parses range with a 24h default", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("bogus")).toBe("24h");
    expect(parseRange(null)).toBe("24h");
  });

  it("builds 24 hourly / 7 / 30 daily buckets ending at the current one", () => {
    const now = new Date("2026-11-22T10:20:30Z");
    expect(buildBuckets(now, "24h").starts).toHaveLength(24);
    expect(buildBuckets(now, "7d").starts).toHaveLength(7);
    const b = buildBuckets(now, "30d");
    expect(b.starts).toHaveLength(30);
    expect(bucketIndex(now, b)).toBe(29);
    expect(bucketIndex(new Date(b.starts[0] - 1), b)).toBe(-1);
  });

  it("pct handles zero denominators", () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33.3);
  });

  it("counts connected/missed, wait time and FCR per bucket", () => {
    const now = new Date("2026-11-22T10:20:30Z");
    const b = buildBuckets(now, "24h");
    const t = new Date(now.getTime() - 10 * 60 * 1000);
    const rows = [
      { createdAt: t, startedAt: new Date(t.getTime() + 10_000), status: "COMPLETED", paymentIntent: "WILL_PAY" },
      { createdAt: t, startedAt: new Date(t.getTime() + 20_000), status: "COMPLETED", paymentIntent: "REFUSED" },
      { createdAt: t, startedAt: null, status: "NO_ANSWER", paymentIntent: null },
    ];
    const s = summariseCalls(rows, b);
    const i = bucketIndex(t, b);
    expect(s.connected[i]).toBe(2);
    expect(s.missed[i]).toBe(1);
    expect(s.waitAvgSec[i]).toBe(15);
    expect(s.fcr[i]).toBe(50);
  });

  it("maps SQL DOW (0=Sunday) to a Monday-first heatmap", () => {
    const g = buildHeatmap([
      { dow: 1, hour: 9, count: 4 },
      { dow: 0, hour: 23, count: 2 },
    ]);
    expect(g[0][9]).toBe(4);
    expect(g[6][23]).toBe(2);
  });

  it("builds a consistent flow graph (links never exceed their source)", () => {
    const f = buildFlow({ total: 100, connected: 70, noAnswer: 20, failed: 5, inQueue: 5, promises: 30, review: 10, fulfilled: 12, broken: 8 });
    const out = (id: string) => f.links.filter((l) => l.from === id).reduce((a, l) => a + l.value, 0);
    for (const n of f.nodes) expect(out(n.id)).toBeLessThanOrEqual(n.value);
    expect(f.nodes.find((n) => n.id === "pending")?.value).toBe(10);
    expect(buildFlow({ total: 0 } as never).nodes).toEqual([]);
  });

  it("clamps flow when promises exceed connected calls", () => {
    const f = buildFlow({ total: 10, connected: 4, noAnswer: 6, failed: 0, inQueue: 0, promises: 9, review: 3, fulfilled: 9, broken: 9 });
    expect(f.nodes.find((n) => n.id === "promise")?.value).toBe(4);
    expect(f.nodes.find((n) => n.id === "review")).toBeUndefined();
  });

  it("counts per-day buckets", () => {
    const start = Date.UTC(2026, 10, 1);
    expect(dayCounts([new Date(start + 1000), new Date(start + 86_400_000 + 5), new Date(start - 5)], start, 3)).toEqual([1, 1, 0]);
  });

  it("builds four campaign cards with safe percentages on empty data", () => {
    const c = buildCampaigns({
      promisesFulfilled: 0, promisesBroken: 0, promisesActive: 0, followUpsCompleted: 0, followUpsPending: 0, followUpCalls: 0,
      followUpCallsConnected: 0, collected: 0, outstanding: 0, customersTotal: 0, customersCleared: 0, tasksResolved: 0, tasksOpen: 0,
    });
    expect(c).toHaveLength(4);
    expect(c.every((x) => x.progress === 0 && x.successRate === 0 && !x.active)).toBe(true);
  });
});
