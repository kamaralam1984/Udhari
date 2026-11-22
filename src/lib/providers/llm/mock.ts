import type { LLMProvider, LlmCompletionRequest, LlmCompletionResult } from "../types";

/**
 * The MVP's actual conversation decisions come from the deterministic
 * rule-based engine (src/lib/callEngine) so behaviour stays auditable and
 * testable without a live model. This mock exists so the LLMProvider seam is
 * real and swappable — a future LLM_PROVIDER=openai/anthropic/... can plug in
 * for more natural free-text phrasing without touching call-flow logic.
 */
export class MockLlmProvider implements LLMProvider {
  readonly name = "mock";

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const last = req.conversationHistory[req.conversationHistory.length - 1];
    return {
      text: last?.content ?? "",
      tokensUsed: Math.max(1, Math.ceil((last?.content?.length ?? 0) / 4)),
    };
  }
}
