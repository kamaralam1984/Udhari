import { getDialogue } from "./dialogue";
import { formatInr } from "../nlu/extract";
import { formatDateHuman } from "../time";
import { getTtsProvider } from "../providers/registry";
import type { UtteranceExtraction } from "../nlu/extract";
import type { LanguageStyle } from "../nlu/language";

/**
 * Maps the NLU's detected LanguageStyle to a Customer.preferredLanguage-style
 * key that getDialogue() understands, so a Language Lab sample (which has no
 * real Customer record) can still preview the AI's reply in the language it
 * was actually detected in.
 */
export function styleToDialogueKey(style: LanguageStyle): string {
  switch (style) {
    case "hindi_devanagari":
      return "hindi";
    case "magahi":
      return "magahi";
    case "bhojpuri":
      return "bhojpuri"; // getDialogue() aliases this to the same Magahi/Begusarai set
    case "english":
      return "english";
    case "hinglish":
    case "mixed_unknown":
    default:
      return "hinglish";
  }
}

/**
 * A single-turn preview of what the AI would say back, given one utterance's
 * extraction — NOT the full call engine (no multi-turn state, no
 * clarification-attempt counting, no persistence). Used by the Language
 * Lab's text/audio/PDF test flows to demonstrate "the AI understood this and
 * would reply like X" without actually running/persisting a Call. The real
 * conversation (with all safety invariants) only ever happens through
 * src/lib/callEngine/engine.ts via an actual Call.
 */
export function buildPreviewReply(extraction: UtteranceExtraction, languageKey: string): string {
  const dialogue = getDialogue(languageKey);
  const { intent, amount, date, needsAmountClarification, needsDateClarification } = extraction;

  switch (intent.intent) {
    case "ALREADY_PAID":
      return dialogue.alreadyPaid();
    case "WRONG_NUMBER":
      return dialogue.wrongNumberIdentity();
    case "REFUSED":
      return dialogue.refused();
    case "CALLBACK_REQUESTED":
      return dialogue.callbackRequested();
    case "CANNOT_PAY":
      return dialogue.cannotPay();
    case "WILL_PAY":
    case "PARTIAL_PAY":
      if (needsAmountClarification) return dialogue.clarifyAmount();
      if (needsDateClarification) return dialogue.clarifyDate();
      if (amount.amount !== null && date.date !== null) {
        return dialogue.confirmation(formatInr(amount.amount), formatDateHuman(date.date));
      }
      return dialogue.askUnclear();
    default:
      return dialogue.askUnclear();
  }
}

export interface PreviewReplyWithAudio {
  text: string;
  /** null when TTS_PROVIDER is still "mock" (no real audio) or synthesis failed — the text is always populated regardless. */
  audioUrl: string | null;
}

/**
 * Generates the reply text (always) and attempts real audio (only if a
 * non-mock TTS_PROVIDER is configured). Synthesis failures never block the
 * text result — Language Lab callers show the text either way.
 */
export async function buildPreviewReplyWithAudio(
  extraction: UtteranceExtraction,
  languageKey: string
): Promise<PreviewReplyWithAudio> {
  const text = buildPreviewReply(extraction, languageKey);
  try {
    const tts = await getTtsProvider().synthesize({ text, language: languageKey });
    const audioUrl = tts.audioUrl.startsWith("data:audio/mock") ? null : tts.audioUrl;
    return { text, audioUrl };
  } catch {
    return { text, audioUrl: null };
  }
}
