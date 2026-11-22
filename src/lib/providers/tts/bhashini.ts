import type { SynthesizeSpeechRequest, SynthesizeSpeechResult, TextToSpeechProvider } from "../types";
import { getBhashiniPipeline } from "../bhashiniPipeline";

/**
 * Real text-to-speech via Bhashini's ULCA inference API. Defaults to Hindi
 * ("hi") — see BHASHINI_LANGUAGE_CODE in bhashiniPipeline.ts, and the same
 * Bhojpuri-coverage caveat as stt/bhashini.ts.
 *
 * ULCA returns audio inline as base64, not a hosted URL. That's mapped onto
 * the existing SynthesizeSpeechResult.audioUrl contract as a data: URI —
 * consistent with how MockTtsProvider already returns inline data.
 */
export class BhashiniTtsProvider implements TextToSpeechProvider {
  readonly name = "bhashini";

  async synthesize(req: SynthesizeSpeechRequest): Promise<SynthesizeSpeechResult> {
    const pipeline = await getBhashiniPipeline("tts", req.language);
    const sourceLanguage = pipeline.sourceLanguage;

    const res = await fetch(pipeline.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: pipeline.inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: "tts",
            config: {
              language: { sourceLanguage },
              serviceId: pipeline.serviceId,
              gender: req.voiceId || "female",
            },
          },
        ],
        inputData: { input: [{ source: req.text }] },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bhashini TTS inference failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as {
      pipelineResponse?: { audio?: { audioContent?: string }[] }[];
    };
    const base64Audio = data.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!base64Audio) throw new Error("Bhashini TTS response did not contain audio content.");

    return {
      audioUrl: `data:audio/wav;base64,${base64Audio}`,
      charactersUsed: req.text.length,
    };
  }
}
