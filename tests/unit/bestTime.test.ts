import { describe, expect, it } from "vitest";
import { decideCallTiming, emptySlotStats, MIN_TOTAL_CALLS, overallPickup, slotRate, type SlotStats } from "@/lib/followUp/bestTime";
import { dateInAppTz } from "@/lib/time";

/** Every weekday: hours 10-19 have 10 calls each; hour 14 is bad (20%), hour 15 is great (90%), the rest 60%. */
function stats(): SlotStats {
  const s = emptySlotStats();
  for (let d = 0; d < 7; d++) {
    for (let h = 10; h <= 19; h++) {
      s.total[d][h] = 10;
      s.connected[d][h] = h === 14 ? 2 : h === 15 ? 9 : 6;
    }
  }
  return s;
}

const base = { quietStart: 21, quietEnd: 9, maxDeferHours: 24 };
const at = (h: number, m = 10) => dateInAppTz(2026, 10, 25, h, m);

describe("slotRate / overallPickup", () => {
  it("uses the slot when it has enough calls, else the same hour across weekdays, else null", () => {
    const s = emptySlotStats();
    s.total[0][9] = 5;
    s.connected[0][9] = 4;
    expect(slotRate(s, 0, 9)).toBe(80);
    s.total[1][9] = 1; // too thin on its own, but hour 9 across all weekdays has 6 calls
    s.connected[1][9] = 0;
    expect(slotRate(s, 1, 9)).toBeCloseTo((4 / 6) * 100);
    expect(slotRate(s, 2, 3)).toBeNull();
  });

  it("computes the overall rate", () => {
    const o = overallPickup(stats());
    expect(o.calls).toBe(7 * 10 * 10);
    expect(Math.round(o.rate)).toBe(Math.round(((6 * 8 + 2 + 9) / 100) * 100));
  });
});

describe("decideCallTiming", () => {
  const eligibleAt = (now: Date) => new Date(now.getTime() - 3_600_000); // became due 1h ago

  it("calls now when there is not enough history", () => {
    const now = at(14);
    const d = decideCallTiming({ ...base, now, eligibleAt: eligibleAt(now), stats: emptySlotStats() });
    expect(d.action).toBe("call-now");
    expect(MIN_TOTAL_CALLS).toBeGreaterThan(0);
  });

  it("defers a call from a clearly bad hour to the next good one", () => {
    const now = at(14);
    const d = decideCallTiming({ ...base, now, eligibleAt: eligibleAt(now), stats: stats() });
    expect(d.action).toBe("defer");
    if (d.action === "defer") {
      expect(d.until.getTime()).toBe(at(15, 0).getTime());
      expect(d.currentRate).toBe(20);
      expect(d.targetRate).toBe(90);
    }
  });

  it("calls immediately in an average or good hour", () => {
    expect(decideCallTiming({ ...base, now: at(12), eligibleAt: eligibleAt(at(12)), stats: stats() }).action).toBe("call-now");
    expect(decideCallTiming({ ...base, now: at(15), eligibleAt: eligibleAt(at(15)), stats: stats() }).action).toBe("call-now");
  });

  it("never waits past the max-defer deadline", () => {
    const now = at(14);
    const longAgo = new Date(now.getTime() - 25 * 3_600_000);
    const d = decideCallTiming({ ...base, now, eligibleAt: longAgo, stats: stats() });
    expect(d).toMatchObject({ action: "call-now", reason: "max wait reached" });
  });

  it("calls now if no better slot exists before the deadline", () => {
    const now = at(14);
    // deadline only 30 minutes away -> the 3pm slot is out of reach
    const d = decideCallTiming({ ...base, maxDeferHours: 1, now, eligibleAt: new Date(now.getTime() - 30 * 60_000), stats: stats() });
    expect(d.action).toBe("call-now");
  });

  it("never targets a slot inside quiet hours", () => {
    const s = stats();
    // make 9pm look wonderful and everything else bad; it must still be skipped
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        s.total[d][h] = 10;
        s.connected[d][h] = h === 21 ? 10 : 3;
      }
    }
    s.connected.forEach((row) => (row[20] = 1));
    const now = at(20);
    const d = decideCallTiming({ ...base, now, eligibleAt: eligibleAt(now), stats: s });
    // 9pm (hour 21) is quiet time, so the only "good" slot is unusable -> fall back to calling now
    expect(d.action).toBe("call-now");
  });
});
