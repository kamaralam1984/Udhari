import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LLMProvider } from "@/lib/providers/types";

const mockGetLlmProvider = vi.fn<() => LLMProvider>();
vi.mock("@/lib/providers/registry", () => ({
  getLlmProvider: () => mockGetLlmProvider(),
}));

const { rephraseUncertainLine } = await import("@/lib/callEngine/llmRephrase");

const INPUT = {
  cannedLine: "Maaf kijiye, samajh nahi aaya. Kripya dobara bataiye.",
  customerUtterance: "kal bhej dunga shayad",
  languageLabel: "Hinglish",
};

describe("rephraseUncertainLine", () => {
  beforeEach(() => {
    mockGetLlmProvider.mockReset();
  });

  it("returns the canned line unchanged when LLM_PROVIDER is mock", async () => {
    mockGetLlmProvider.mockReturnValue({ name: "mock", complete: vi.fn() });
    const line = await rephraseUncertainLine(INPUT);
    expect(line).toBe(INPUT.cannedLine);
  });

  it("returns the LLM's reworded line when a real provider succeeds", async () => {
    mockGetLlmProvider.mockReturnValue({
      name: "openai",
      complete: vi.fn().mockResolvedValue({ text: "Sorry, I didn't catch that — could you say it again?" }),
    });
    const line = await rephraseUncertainLine(INPUT);
    expect(line).toBe("Sorry, I didn't catch that — could you say it again?");
  });

  it("falls back to the canned line if the provider throws", async () => {
    mockGetLlmProvider.mockReturnValue({
      name: "openai",
      complete: vi.fn().mockRejectedValue(new Error("OpenAI chat completion failed (500)")),
    });
    const line = await rephraseUncertainLine(INPUT);
    expect(line).toBe(INPUT.cannedLine);
  });

  it("falls back to the canned line if the provider returns an empty string", async () => {
    mockGetLlmProvider.mockReturnValue({
      name: "openai",
      complete: vi.fn().mockResolvedValue({ text: "   " }),
    });
    const line = await rephraseUncertainLine(INPUT);
    expect(line).toBe(INPUT.cannedLine);
  });

  it("falls back to the canned line if the provider hangs past the timeout", async () => {
    mockGetLlmProvider.mockReturnValue({
      name: "openai",
      complete: vi.fn(() => new Promise<{ text: string }>(() => {})), // never resolves
    });
    const line = await rephraseUncertainLine(INPUT);
    expect(line).toBe(INPUT.cannedLine);
  }, 10000);
});
