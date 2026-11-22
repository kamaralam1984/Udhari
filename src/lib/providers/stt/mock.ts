import type { SpeechToTextProvider, TranscriptionResult } from "../types";

// Magic-byte signatures for common audio containers — used only to detect
// "this is real recorded audio" so the mock can fail honestly instead of
// silently decoding binary bytes as UTF-8 text (which produces garbage).
const AUDIO_SIGNATURES: { bytes: number[]; label: string }[] = [
  { bytes: [0x52, 0x49, 0x46, 0x46], label: "WAV" }, // "RIFF"
  { bytes: [0x49, 0x44, 0x33], label: "MP3 (ID3 tag)" }, // "ID3"
  { bytes: [0xff, 0xfb], label: "MP3" },
  { bytes: [0x4f, 0x67, 0x67, 0x53], label: "OGG" }, // "OggS"
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], label: "WEBM/MKV" },
];

function detectAudioFormat(buf: Buffer): string | null {
  for (const { bytes, label } of AUDIO_SIGNATURES) {
    if (buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)) return label;
  }
  return null;
}

/**
 * In mock mode there is no real speech recognition — the "Voice Testing"
 * screen normally lets a tester TYPE what the customer said, standing in for
 * a transcript that a real STT vendor (Bhashini/Whisper/Deepgram/...) would
 * otherwise produce (that path passes a string here, returned as-is).
 *
 * If real recorded audio bytes are passed instead (e.g. an uploaded WAV/MP3
 * from the Language Lab's audio-upload flow — see
 * src/app/api/language-tests/audio/route.ts), this mock CANNOT actually
 * transcribe it. Decoding audio bytes as UTF-8 text produces meaningless
 * garbage, which would silently look like a "result" without being one — so
 * this detects that case and returns an honest zero-confidence failure
 * instead, telling the caller to configure a real STT_PROVIDER.
 */
export class MockSttProvider implements SpeechToTextProvider {
  readonly name = "mock";

  async transcribe(audioChunk: Buffer | string): Promise<TranscriptionResult> {
    if (typeof audioChunk === "string") {
      return { text: audioChunk, confidence: 0.99 };
    }
    const format = detectAudioFormat(audioChunk);
    if (format) {
      return {
        text: `[Mock STT cannot transcribe real audio — this ${format} file was not processed. Set STT_PROVIDER to a real vendor (e.g. "bhashini") in .env to actually transcribe it.]`,
        confidence: 0,
      };
    }
    return { text: audioChunk.toString("utf-8"), confidence: 0.99 };
  }
}
