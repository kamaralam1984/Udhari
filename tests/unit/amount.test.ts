import { describe, expect, it } from "vitest";
import { extractAmount, resolveFractionAmount } from "@/lib/nlu/amount";

describe("extractAmount", () => {
  it("parses word amounts: pachaas hazaar", () => {
    expect(extractAmount("pachaas hazaar de denge").amount).toBe(50000);
  });

  it("parses digit + word: 50 hazaar", () => {
    expect(extractAmount("50 hazaar de denge").amount).toBe(50000);
  });

  it("parses ek lakh", () => {
    expect(extractAmount("ek lakh agle hafte").amount).toBe(100000);
  });

  it("parses 1 lakh", () => {
    expect(extractAmount("1 lakh de denge").amount).toBe(100000);
  });

  it("parses bees hazaar", () => {
    expect(extractAmount("bees hazaar de denge").amount).toBe(20000);
  });

  it("parses comma-grouped digits: 20,000", () => {
    expect(extractAmount("20,000 de denge").amount).toBe(20000);
  });

  it("parses Devanagari digits+word: pachaas हजार", () => {
    const r = extractAmount("10 din baad pachaas हजार दे देंगे");
    expect(r.amount).toBe(50000);
  });

  it("parses Devanagari word amount: बीस हजार", () => {
    expect(extractAmount("अभी बीस हजार दे सकत हैं").amount).toBe(20000);
  });

  it("does not confuse a day-count with an amount", () => {
    const r = extractAmount("10 din baad pachaas hazaar denge");
    expect(r.amount).toBe(50000); // not 10
  });

  it("flags a fraction word (aadha) as ambiguous with no amount yet", () => {
    const r = extractAmount("abhi aadha de denge");
    expect(r.amount).toBeNull();
    expect(r.isFraction).toBe(true);
    expect(r.fractionValue).toBe(0.5);
    expect(r.ambiguous).toBe(true);
  });

  it("resolves a fraction against outstanding amount but keeps it flagged for confirmation", () => {
    const raw = extractAmount("abhi aadha de denge");
    const resolved = resolveFractionAmount(raw, 100000);
    expect(resolved.amount).toBe(50000);
    expect(resolved.ambiguous).toBe(true);
  });

  it("returns null/ambiguous when there is no amount at all", () => {
    const r = extractAmount("jitna abhi ho payega de denge");
    expect(r.amount).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("compounds lakh + hazaar", () => {
    expect(extractAmount("ek lakh pachaas hazaar denge").amount).toBe(150000);
  });
});
