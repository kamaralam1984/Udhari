import type { SpeechToTextProvider, TranscriptionResult } from "../types";
import { getBhashiniPipeline } from "../bhashiniPipeline";

function toBase64(audioChunk: Buffer | string): string {
  return typeof audioChunk === "string" ? audioChunk : audioChunk.toString("base64");
}

/**
 * Real speech-to-text via Bhashini's ULCA inference API. Defaults to Hindi
 * ("hi") — see BHASHINI_LANGUAGE_CODE in bhashiniPipeline.ts. Bhojpuri /
 * Maithili are not confirmed to have a dedicated Bhashini model; the app's
 * own src/lib/nlu/lexicon.ts already compensates for Hindi-transliterated
 * transcripts of Bhojpuri speech at the text layer, so this default is a
 * safe, working choice rather than a compromise.
 */
export class BhashiniSttProvider implements SpeechToTextProvider {
  readonly name = "bhashini";

  async transcribe(audioChunk: Buffer | string, opts?: { language?: string }): Promise<TranscriptionResult> {
    const pipeline = await getBhashiniPipeline("asr", opts?.language);
    const sourceLanguage = pipeline.sourceLanguage;

    const res = await fetch(pipeline.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: pipeline.inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          { taskType: "asr", config: { language: { sourceLanguage }, serviceId: pipeline.serviceId } },
        ],
        inputData: { audio: [{ audioContent: toBase64(audioChunk) }] },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bhashini ASR inference failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as {
      pipelineResponse?: { output?: { source?: string; confidence?: number }[] }[];
    };
    const output = data.pipelineResponse?.[0]?.output?.[0];

    return {
      text: output?.source ?? "",
      language: sourceLanguage,
      // ULCA ASR responses don't reliably include a confidence field.
      confidence: output?.confidence ?? 0.8,
    };
  }
}
