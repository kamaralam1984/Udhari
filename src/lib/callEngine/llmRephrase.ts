import { getLlmProvider } from "../providers/registry";

const TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LLM rephrase timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export interface RephraseInput {
  /** The deterministic dialogue line the rule engine already decided to say — the guaranteed fallback. */
  cannedLine: string;
  /** What the customer said that the rule-based NLU (src/lib/nlu) couldn't parse. */
  customerUtterance: string;
  /** Human-readable language name for the LLM prompt, e.g. "Hindi", "English". */
  languageLabel: string;
}

/**
 * Best-effort natural-language rephrase of a canned "I didn't understand,
 * please clarify" line, for when Customer.preferredLanguage's real LLM
 * (LLM_PROVIDER=openai, see providers/llm/openai.ts) is configured.
 *
 * Deliberately narrow: this ONLY changes the wording spoken back to the
 * customer. It never sees or influences amount/date extraction, stage
 * transitions, or clarification-attempt counters — those stay 100%
 * deterministic in engine.ts, preserving the "AI never lets unchecked model
 * output touch financial records" invariant (see callEngine/persist.ts).
 *
 * Falls back to the exact canned line on ANY failure — no real LLM
 * configured (LLM_PROVIDER=mock, the default), missing/invalid API key,
 * network error, timeout, or an empty response — so this can never break,
 * stall, or change the *behaviour* of a call, only its wording when it works.
 */
export async function rephraseUncertainLine(input: RephraseInput): Promise<string> {
  const provider = getLlmProvider();
  if (provider.name === "mock") return input.cannedLine;

  try {
    const result = await withTimeout(
      provider.complete({
        systemPrompt:
          "You are rephrasing one line of a polite debt-collection phone call assistant so it sounds more " +
          `natural. Reply in ${input.languageLabel}, as 1-2 short spoken sentences. Do NOT invent or state any ` +
          "amount, date, or promise of your own — only ask the customer to clarify, preserving the meaning of " +
          "the given line. Reply with ONLY the rephrased line — no quotes, no explanation, no preamble.",
        conversationHistory: [
          {
            role: "user",
            content:
              `Customer said (unclear to the system): "${input.customerUtterance}"\n` +
              `Original line to rephrase: "${input.cannedLine}"`,
          },
        ],
        language: input.languageLabel,
      }),
      TIMEOUT_MS
    );
    const text = result.text?.trim();
    return text ? text : input.cannedLine;
  } catch (err) {
    console.error("LLM rephrase failed, using canned line", err);
    return input.cannedLine;
  }
}
