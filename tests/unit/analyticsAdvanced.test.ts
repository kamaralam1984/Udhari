import { describe, expect, it } from "vitest";
import { bestCallSlots, formatHourRange, parseDay, pctChange, resolveRange, riskScore, roi } from "@/lib/analytics";
import { evaluateAlerts } from "@/lib/alerts";
import { buildDailyReportText } from "@/lib/dailyReport";
import { summariseCampaign } from "@/lib/campaigns";

describe("custom ranges + comparison", () => {
  const now = new Date("2026-11-22T10:00:00Z");

  it("parses YYYY-MM-DD and rejects junk", () => {
    expect(parseDay("2026-11-05")).toBeInstanceOf(Date);
    expect(parseDay("05-11-2026")).toBeNull();
    expect(parseDay("2026-13-40")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it("builds a daily custom range with a same-length previous window", () => {
    const r = resolveRange({ range: "custom", from: "2026-11-01", to: "2026-11-07" }, now);
    expect(r.key).toBe("custom");
    expect(r.buckets.starts).toHaveLength(7);
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86_400_000);
    expect(r.prevTo.getTime()).toBe(r.from.getTime());
    expect(r.prevTo.getTime() - r.prevFrom.getTime()).toBe(7 * 86_400_000);
  });

  it("uses hourly buckets for a one-day custom window and caps very long ranges", () => {
    expect(resolveRange({ range: "custom", from: "2026-11-10", to: "2026-11-10" }, now).buckets.starts.length).toBe(24);
    expect(resolveRange({ range: "custom", from: "2025-01-01", to: "2026-11-01" }, now).buckets.starts.length).toBeLessThanOrEqual(92);
  });

  it("falls back to a preset when custom dates are invalid or reversed", () => {
    expect(resolveRange({ range: "custom", from: "2026-11-09", to: "2026-11-01" }, now).key).toBe("24h");
    expect(resolveRange({ range: "7d" }, now).buckets.starts).toHaveLength(7);
  });

  it("pctChange handles empty previous periods", () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe("best time to call", () => {
  it("ranks slots by pick-up rate and ignores thin data", () => {
    const total = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const connected = Array.from({ length: 7 }, () => new Array(24).fill(0));
    total[1][11] = 10; connected[1][11] = 9;
    total[2][15] = 10; connected[2][15] = 5;
    total[3][9] = 2; connected[3][9] = 2; // only 2 calls — ignored
    const best = bestCallSlots(total, connected);
    expect(best.map((b) => [b.dow, b.hour])).toEqual([[1, 11], [2, 15]]);
    expect(best[0].rate).toBe(90);
    expect(formatHourRange(11)).toBe("11am–12pm");
    expect(formatHourRange(23)).toBe("11pm–12am");
  });
});

describe("riskScore", () => {
  it("rates a reliable payer low and a chronic defaulter high", () => {
    const good = riskScore({ outstanding: 3000, calls: 4, noAnswer: 0, promisesBroken: 0, promisesFulfilled: 3, daysSincePayment: 10 });
    const bad = riskScore({ outstanding: 150000, calls: 8, noAnswer: 7, promisesBroken: 3, promisesFulfilled: 0, daysSincePayment: null });
    expect(good.level).toBe("LOW");
    expect(bad.level).toBe("HIGH");
    expect(bad.score).toBeGreaterThan(good.score);
    expect(bad.reasons.length).toBeGreaterThan(0);
  });

  it("stays within 0-100", () => {
    const r = riskScore({ outstanding: 1e9, calls: 1, noAnswer: 1, promisesBroken: 99, promisesFulfilled: 0, daysSincePayment: 9999 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(riskScore({ outstanding: 0, calls: 0, noAnswer: 0, promisesBroken: 0, promisesFulfilled: 0, daysSincePayment: 0 }).score).toBeGreaterThanOrEqual(0);
  });
});

describe("roi", () => {
  it("computes ratio and net, null ratio without cost", () => {
    expect(roi(5000, 100)).toEqual({ ratio: 50, net: 4900 });
    expect(roi(5000, 0).ratio).toBeNull();
  });
});

describe("evaluateAlerts", () => {
  const t = { alertMinSuccessRate: 90, alertMaxBrokenPromises: 5, dailyCostLimit: 500 };

  it("is quiet when everything is healthy", () => {
    expect(evaluateAlerts({ calls24h: 50, failed24h: 1, brokenOpen: 2, costToday: 100 }, t)).toEqual([]);
  });

  it("fires each rule independently and escalates severity", () => {
    const a = evaluateAlerts({ calls24h: 20, failed24h: 10, brokenOpen: 12, costToday: 900 }, t);
    expect(a.map((x) => x.key).sort()).toEqual(["broken-promises", "cost-limit", "success-rate"]);
    expect(a.every((x) => x.severity === "critical")).toBe(true);
  });

  it("does not alert on tiny samples or when a rule is switched off (0)", () => {
    expect(evaluateAlerts({ calls24h: 3, failed24h: 3, brokenOpen: 0, costToday: 0 }, t)).toEqual([]);
    expect(evaluateAlerts({ calls24h: 50, failed24h: 40, brokenOpen: 99, costToday: 9999 }, { alertMinSuccessRate: 0, alertMaxBrokenPromises: 0, dailyCostLimit: 0 })).toEqual([]);
  });
});

describe("daily report text", () => {
  it("includes the key numbers and the ROI line", () => {
    const text = buildDailyReportText({
      dateLabel: "22 Nov 2026", calls: 20, connected: 15, noAnswer: 4, promises: 6, promisedAmount: 42000, collected: 30000,
      collectionCount: 5, outstanding: 350000, brokenOpen: 2, openTasks: 3, cost: 100, topStaff: { name: "Ravi", amount: 18000 },
    });
    expect(text).toContain("DAILY REPORT — 22 Nov 2026");
    expect(text).toContain("Calls: 20");
    expect(text).toContain("Ravi");
    expect(text).toContain("₹300.0 wapas");
  });
});

describe("campaign stats", () => {
  it("rolls calls and promises up per distinct customer", () => {
    const s = summariseCampaign(
      4,
      [
        { customerId: "a", status: "COMPLETED" },
        { customerId: "a", status: "COMPLETED" },
        { customerId: "b", status: "NO_ANSWER" },
        { customerId: "c", status: "COMPLETED" },
      ],
      [
        { customerId: "a", status: "FULFILLED", promisedAmount: 1000 },
        { customerId: "c", status: "SUPERSEDED", promisedAmount: 500 },
      ],
      1000
    );
    expect(s.called).toBe(3);
    expect(s.reached).toBe(2);
    expect(s.promised).toBe(1);
    expect(s.promisedAmount).toBe(1000);
    expect(s.progress).toBe(75);
    expect(s.successRate).toBe(50);
    expect(s.collected).toBe(1000);
  });
});
