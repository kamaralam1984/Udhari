import type { SynthesizeSpeechRequest, SynthesizeSpeechResult, TextToSpeechProvider } from "../types";

export class MockTtsProvider implements TextToSpeechProvider {
  readonly name = "mock";

  async synthesize(req: SynthesizeSpeechRequest): Promise<SynthesizeSpeechResult> {
    const wordsPerSecond = 2.3;
    const wordCount = req.text.trim().split(/\s+/).filter(Boolean).length;
    return {
      audioUrl: "data:audio/mock;base64,", // placeholder — no real audio in mock mode
      durationSeconds: Math.max(1, Math.round(wordCount / wordsPerSecond)),
      charactersUsed: req.text.length,
    };
  }
}
