import { describe, expect, it } from "vitest";
import { extractDate } from "@/lib/nlu/date";
import { dateInAppTz, formatDateHuman } from "@/lib/time";

// Fixed "now" = Tuesday, 1 Sept 2026, 10:00 IST — matches the environment's current date.
const NOW = dateInAppTz(2026, 8, 1, 10, 0, 0);

function human(d: Date | null) {
  return formatDateHuman(d);
}

describe("extractDate", () => {
  it("kal -> tomorrow", () => {
    const r = extractDate("kal kar denge", NOW);
    expect(human(r.date)).toBe("02 Sep 2026");
    expect(r.ambiguous).toBe(false);
  });

  it("parso -> day after tomorrow", () => {
    const r = extractDate("parso de denge", NOW);
    expect(human(r.date)).toBe("03 Sep 2026");
  });

  it("3 din baad", () => {
    const r = extractDate("3 din baad de denge", NOW);
    expect(human(r.date)).toBe("04 Sep 2026");
  });

  it("10 din baad", () => {
    const r = extractDate("10 din baad pachaas hazaar de denge", NOW);
    expect(human(r.date)).toBe("11 Sep 2026");
  });

  it("agle Monday -> next Monday, forced", () => {
    const r = extractDate("agle Monday ko de denge", NOW);
    expect(human(r.date)).toBe("07 Sep 2026");
    expect(r.ambiguous).toBe(false);
  });

  it("Begusarai style: agila somar ke", () => {
    const r = extractDate("अगिला सोमर के पचास हजार देब", NOW);
    expect(human(r.date)).toBe("07 Sep 2026");
  });

  it("15 tareekh -> 15th of current month", () => {
    const r = extractDate("15 tareekh ko de denge", NOW);
    expect(human(r.date)).toBe("15 Sep 2026");
  });

  it("agla hafta -> ~7 days, flagged ambiguous", () => {
    const r = extractDate("agla hafta de denge", NOW);
    expect(human(r.date)).toBe("08 Sep 2026");
    expect(r.ambiguous).toBe(true);
  });

  it("mahina khatam hone se pehle -> end of month, flagged ambiguous", () => {
    const r = extractDate("mahina khatam hone se pehle kar denge", NOW);
    expect(human(r.date)).toBe("30 Sep 2026");
    expect(r.ambiguous).toBe(true);
  });

  it("Diwali ke baad -> festival lookup, flagged ambiguous", () => {
    const r = extractDate("Diwali ke baad de denge", NOW);
    expect(r.date).not.toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("salary aane ke baad -> cannot resolve, flagged ambiguous", () => {
    const r = extractDate("salary aane ke baad de denge", NOW);
    expect(r.date).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("no date phrase -> null, ambiguous, zero confidence", () => {
    const r = extractDate("theek hai ji", NOW);
    expect(r.date).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.confidence).toBe(0);
  });
});
