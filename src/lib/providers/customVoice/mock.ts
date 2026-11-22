import type { CustomVoiceConfig, CustomVoiceProvider, SynthesizeSpeechRequest, SynthesizeSpeechResult } from "../types";

/**
 * A client's own voice can only be used when (a) the selected TTS vendor
 * technically supports voice cloning and (b) explicit consent is on file —
 * see CUSTOM_VOICE_CONSENT_ON_FILE. This mock always refuses without
 * consent, exactly like a real provider integration must.
 */
export class MockCustomVoiceProvider implements CustomVoiceProvider {
  readonly name = "mock";
  readonly supportsCustomVoice = true;

  async synthesizeWithCustomVoice(
    req: SynthesizeSpeechRequest,
    config: CustomVoiceConfig
  ): Promise<SynthesizeSpeechResult> {
    if (!config.consentOnFile) {
      throw new Error("Custom voice consent is not on file — refusing to synthesize with a cloned voice.");
    }
    return {
      audioUrl: "data:audio/mock;base64,",
      durationSeconds: Math.max(1, Math.round(req.text.length / 14)),
      charactersUsed: req.text.length,
    };
  }
}
