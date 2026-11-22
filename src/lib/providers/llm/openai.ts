import type { LLMProvider, LlmCompletionRequest, LlmCompletionResult } from "../types";

/**
 * Real chat completion via OpenAI's Chat Completions API. Registered under
 * LLM_PROVIDER="openai" (see registry.ts) — same seam MockLlmProvider fills
 * today. Used by callEngine/llmRephrase.ts to reword two canned clarification
 * lines in the customer's language; conversation decisions (amount/date
 * extraction, stage transitions) stay 100% in the deterministic rule engine
 * (src/lib/callEngine, src/lib/nlu) regardless of which LLM_PROVIDER is set.
 */
export class OpenAiLlmProvider implements LLMProvider {
  readonly name = "openai";

  private get apiKey(): string {
    const key = process.env.LLM_API_KEY;
    if (!key) throw new Error("LLM_API_KEY is not set.");
    return key;
  }

  private get model(): string {
    const model = process.env.LLM_MODEL;
    if (!model) throw new Error("LLM_MODEL is not set (e.g. \"gpt-4o-mini\").");
    return model;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const messages = [{ role: "system" as const, content: req.systemPrompt }, ...req.conversationHistory];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI chat completion failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content;
    if (text === undefined) {
      throw new Error("OpenAI chat completion response did not contain a message.");
    }

    return { text, tokensUsed: data.usage?.total_tokens };
  }
}
