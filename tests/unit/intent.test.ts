import { describe, expect, it } from "vitest";
import { extractIntent } from "@/lib/nlu/intent";

describe("extractIntent", () => {
  it("detects ALREADY_PAID — Hindi", () => {
    const r = extractIntent("payment kar diye hain", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("ALREADY_PAID");
  });

  it("detects ALREADY_PAID — Devanagari Bhojpuri", () => {
    const r = extractIntent("पइसा पहिले ही दे दिए हैं", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("ALREADY_PAID");
  });

  it("detects ALREADY_PAID — staff cash claim", () => {
    const r = extractIntent("staff ko cash de diye the", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("ALREADY_PAID");
  });

  it("detects CANNOT_PAY — Bhojpuri 'nahi/nइखे'", () => {
    const r = extractIntent("अभी पैसा नइखे, थोड़ा टाइम दीजिए", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("CANNOT_PAY");
  });

  it("detects WRONG_NUMBER", () => {
    const r = extractIntent("aap galat number pe call kar rahe hain", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("WRONG_NUMBER");
  });

  it("detects CALLBACK_REQUESTED", () => {
    const r = extractIntent("abhi baat nahi kar sakta, baad me call karo", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("CALLBACK_REQUESTED");
  });

  it("detects REFUSED", () => {
    const r = extractIntent("main paisa nahi dunga", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("REFUSED");
  });

  it("defaults to WILL_PAY when amount+date present with no negative markers", () => {
    const r = extractIntent("agle Monday ko pachaas hazaar de denge", { hasAmount: true, hasDate: true });
    expect(r.intent).toBe("WILL_PAY");
  });

  it("marks PARTIAL_PAY when a partial marker is present", () => {
    const r = extractIntent("abhi thoda de denge", { hasAmount: false, hasDate: false, isPartialAmount: true });
    expect(r.intent).toBe("PARTIAL_PAY");
  });

  it("falls back to UNCLEAR with no signal at all", () => {
    const r = extractIntent("hmm theek hai", { hasAmount: false, hasDate: false });
    expect(r.intent).toBe("UNCLEAR");
    expect(r.confidence).toBe(0);
  });
});
