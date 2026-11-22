import type { SynthesizeSpeechRequest, SynthesizeSpeechResult, TextToSpeechProvider } from "../types";

/**
 * Real text-to-speech via OpenAI's Audio Speech API. Registered under
 * TTS_PROVIDER="openai". Reuses LLM_API_KEY as a fallback for the same
 * reason as stt/openai.ts. Voice name defaults to the existing generic
 * TTS_VOICE_ID env var (falls back to "alloy") — OpenAI's TTS models read
 * whatever text they're given fluently, but there is no dedicated Magahi
 * *voice*; this reads Magahi Devanagari text with its general pronunciation
 * model, not a native-speaker-trained voice (same caveat as Bhashini's
 * Hindi-voice-reads-Magahi-text fallback).
 */
export class OpenAiTtsProvider implements TextToSpeechProvider {
  readonly name = "openai";

  private get apiKey(): string {
    const key = process.env.TTS_API_KEY || process.env.LLM_API_KEY;
    if (!key) throw new Error("TTS_API_KEY (or LLM_API_KEY) is not set.");
    return key;
  }

  async synthesize(req: SynthesizeSpeechRequest): Promise<SynthesizeSpeechResult> {
    const model = process.env.OPENAI_TTS_MODEL || "tts-1";
    const voice = req.voiceId || process.env.TTS_VOICE_ID || "alloy";

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: req.text, voice }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI TTS failed (${res.status}): ${detail}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    const wordsPerSecond = 2.3;
    const wordCount = req.text.trim().split(/\s+/).filter(Boolean).length;

    return {
      audioUrl: `data:audio/mpeg;base64,${base64Audio}`,
      durationSeconds: Math.max(1, Math.round(wordCount / wordsPerSecond)),
      charactersUsed: req.text.length,
    };
  }
}
