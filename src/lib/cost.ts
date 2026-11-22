import { getProviderNames } from "./providers/registry";

/**
 * Placeholder per-unit rates (INR) used until real vendor invoices are wired
 * up. These are deliberately conservative estimates, not billing figures —
 * shown to the owner as "Estimated Call Cost".
 */
const RATES = {
  telephonyPerMinute: 0.5,
  sttPerMinute: 0.15,
  llmPer1kTokens: 0.3,
  ttsPer1kChars: 0.4,
};

export interface UsageLogInput {
  provider: "TELEPHONY" | "STT" | "LLM" | "TTS" | "CUSTOM_VOICE";
  providerName: string;
  durationSeconds?: number;
  unitsUsed?: number;
  estimatedCost: number;
  currency: string;
}

export function buildUsageLogs(params: {
  durationSeconds: number;
  ttsCharacters: number;
  llmTokens: number;
  usedCustomVoice: boolean;
}): UsageLogInput[] {
  const names = getProviderNames();
  const minutes = params.durationSeconds / 60;
  const logs: UsageLogInput[] = [
    {
      provider: "TELEPHONY",
      providerName: names.telephony,
      durationSeconds: params.durationSeconds,
      unitsUsed: minutes,
      estimatedCost: round4(minutes * RATES.telephonyPerMinute),
      currency: "INR",
    },
    {
      provider: "STT",
      providerName: names.stt,
      durationSeconds: params.durationSeconds,
      unitsUsed: minutes,
      estimatedCost: round4(minutes * RATES.sttPerMinute),
      currency: "INR",
    },
    {
      provider: "LLM",
      providerName: names.llm,
      unitsUsed: params.llmTokens,
      estimatedCost: round4((params.llmTokens / 1000) * RATES.llmPer1kTokens),
      currency: "INR",
    },
    {
      provider: "TTS",
      providerName: names.tts,
      unitsUsed: params.ttsCharacters,
      estimatedCost: round4((params.ttsCharacters / 1000) * RATES.ttsPer1kChars),
      currency: "INR",
    },
  ];

  if (params.usedCustomVoice && names.customVoice !== "none") {
    logs.push({
      provider: "CUSTOM_VOICE",
      providerName: names.customVoice,
      unitsUsed: params.ttsCharacters,
      estimatedCost: round4((params.ttsCharacters / 1000) * RATES.ttsPer1kChars * 1.5),
      currency: "INR",
    });
  }

  return logs;
}

export function totalCost(logs: UsageLogInput[]): number {
  return round4(logs.reduce((sum, l) => sum + l.estimatedCost, 0));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
