import type { SpeechToTextProvider, TranscriptionResult } from "../types";

/**
 * Real speech-to-text via OpenAI's Whisper API. Registered under
 * STT_PROVIDER="openai" (see registry.ts).
 *
 * Whisper officially documents ~100 supported languages (Hindi included) —
 * Magahi is NOT one of them. Whisper's broad multilingual training may still
 * produce a usable transcript for Magahi speech (especially Devanagari-script,
 * Hindi-adjacent phonetics), but this is unconfirmed — test with real samples
 * via the Language Lab's audio-upload flow before relying on it. Reuses
 * LLM_API_KEY as a fallback since this project's existing OpenAI account
 * (wired for LLM_PROVIDER="openai") already has API access — set STT_API_KEY
 * separately only if you want a different OpenAI key/project for this.
 */
export class OpenAiSttProvider implements SpeechToTextProvider {
  readonly name = "openai";

  private get apiKey(): string {
    const key = process.env.STT_API_KEY || process.env.LLM_API_KEY;
    if (!key) throw new Error("STT_API_KEY (or LLM_API_KEY) is not set.");
    return key;
  }

  async transcribe(audioChunk: Buffer | string, opts?: { language?: string }): Promise<TranscriptionResult> {
    // Mirrors the mock provider's text-passthrough — the typed-text testing
    // path (Language Lab's text box) has no real audio, just a string.
    if (typeof audioChunk === "string") {
      return { text: audioChunk, confidence: 0.99 };
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audioChunk)]), "audio.webm");
    form.append("model", process.env.OPENAI_STT_MODEL || "whisper-1");
    if (opts?.language) form.append("language", opts.language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI transcription failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as { text?: string };
    // Whisper's API doesn't return a per-transcript confidence score.
    return { text: data.text ?? "", confidence: 0.8 };
  }
}
