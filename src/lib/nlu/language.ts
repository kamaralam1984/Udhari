import { containsPhrase } from "./phraseMatch";

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/**
 * Begusarai's actual local speech — genuinely Magahi/Maithili-influenced,
 * not textbook Bhojpuri (see callEngine/dialogue.ts's magahi set). The core
 * set below (छै/होलै/गेलै/बुझलहो/करियो/देबियो/बतइयो/रहतै/बोलतिए/मांगलिए/
 * देलिए/लेलिए/होतै) came from a real client call sample. The rest extends
 * that sample's validated morphology (-तै/-लक/-लियै/-ियो verb endings, "जनि"
 * negative imperative, "रउआ"/"तोरा"/"हमरा" pronouns) into the other phrase
 * categories in this file — it is NOT independently native-speaker verified.
 * Route real call transcripts through src/app/(app)/language-lab to confirm
 * and grow this list; do not treat this as claimed 100% dialect coverage.
 */
const MAGAHI_MARKERS = [
  "छै", "होलै", "गेलै", "बुझलहो", "बुझलो", "बुझल", "करियो", "देबियो", "बतइयो",
  "पहुँचै", "रहतै", "रुकाबा", "समझतिए", "बोलतिए", "मांगलिए", "देलिए", "लेलिए", "होतै",
  "देलियै", "कहलक", "गेलक", "आयल", "रउआ", "तोरा", "हमरा", "केना", "काहे", "अखने",
  "इहाँ", "ऊहाँ", "जनि", "छियै", "छिऐ", "करतिए", "देतिए",
];

/** Textbook Bhojpuri-proper (Deoria/Ballia/Gorakhpur-leaning) — kept distinct
 * from Magahi markers above since mixing the two causes false-positive
 * dialect detection in either direction. Rare in this system's Begusarai/
 * Bihar customer base, but kept for the odd real Bhojpuri-speaking caller. */
const BHOJPURI_PROPER_MARKERS = [
  "बा", "बाड़ी", "बानी", "करब", "देब", "रहलें", "नइखे", "कईनी", "करीं", "दिहनी",
  "dihe", "dihni", "naikhe", "karab", "deb", "raheli", "bade", "bani",
];

/**
 * Maithili (Mithila region — Begusarai is on the Magahi/Maithili transition
 * belt, so both dialects are genuinely spoken there; this is not a
 * replacement for MAGAHI_MARKERS above, which came from a validated real
 * client call sample — it's a second, distinct dialect option). Markers here
 * are chosen to be Maithili-distinctive (copula "अछि"/"छथि", pronoun "अहाँ")
 * and deliberately avoid "करब"/"देब", which Bhojpuri-proper also uses, to
 * limit cross-dialect false positives. Same caveat as Magahi: this is a
 * good-faith starting set, not a claim of full native-speaker coverage — grow
 * it via src/app/(app)/language-lab with real Maithili call samples.
 */
const MAITHILI_MARKERS = [
  "अछि", "छथि", "अहाँ", "बुझलहुँ", "करैत", "किएक", "कोना", "जेकाँ", "तखन",
  "हमरा लग", "रहथि", "छी", "दऽ", "सँ", "एतय",
];

const HINDI_HINGLISH_MARKERS = [
  "hai", "hain", "denge", "kal", "paisa", "paise", "rupaye", "abhi", "nahi",
  "kar", "karenge", "chahiye", "baat", "namaste", "ji",
];

export type LanguageStyle =
  | "hindi_devanagari"
  | "magahi"
  | "maithili"
  | "bhojpuri"
  | "hinglish"
  | "english"
  | "mixed_unknown";

export interface LanguageDetectionResult {
  style: LanguageStyle;
  label: string;
  confidence: number;
}

export function detectLanguageStyle(rawText: string): LanguageDetectionResult {
  const text = (rawText || "").toLowerCase();
  if (!text.trim()) {
    return { style: "mixed_unknown", label: "Unknown (empty input)", confidence: 0 };
  }

  const devanagariChars = (text.match(DEVANAGARI_RANGE) ? text.match(new RegExp(DEVANAGARI_RANGE, "g")) : []) ?? [];
  const devanagariRatio = devanagariChars.length / text.replace(/\s/g, "").length;

  const magahiHits = MAGAHI_MARKERS.filter((m) => containsPhrase(text, m)).length;
  const maithiliHits = MAITHILI_MARKERS.filter((m) => containsPhrase(text, m)).length;
  const bhojpuriHits = BHOJPURI_PROPER_MARKERS.filter((m) => containsPhrase(text, m)).length;
  const hindiHits = HINDI_HINGLISH_MARKERS.filter((m) => containsPhrase(text, m)).length;

  // Magahi (Begusarai) checked first — it's this system's original validated
  // dialect and its marker set overlaps least with generic Hindi/Hinglish.
  if (magahiHits > 0) {
    return {
      style: "magahi",
      label: "Magahi (Begusarai, Bihar)",
      confidence: Math.min(0.9, 0.5 + magahiHits * 0.15),
    };
  }

  // Maithili checked next — Begusarai is on the Magahi/Maithili transition
  // belt, so this is the other genuinely-spoken local dialect.
  if (maithiliHits > 0) {
    return {
      style: "maithili",
      label: "Maithili (Mithila/Begusarai region)",
      confidence: Math.min(0.9, 0.5 + maithiliHits * 0.15),
    };
  }

  if (bhojpuriHits > 0) {
    return {
      style: "bhojpuri",
      label: "Bhojpuri",
      confidence: Math.min(0.9, 0.5 + bhojpuriHits * 0.15),
    };
  }

  if (devanagariRatio > 0.3) {
    return {
      style: "hindi_devanagari",
      label: "Hindi (Devanagari script)",
      confidence: Math.min(0.95, 0.6 + devanagariRatio * 0.4),
    };
  }

  if (hindiHits > 0) {
    return {
      style: "hinglish",
      label: "Hinglish (Roman script)",
      confidence: Math.min(0.9, 0.5 + hindiHits * 0.1),
    };
  }

  if (/^[a-z0-9\s.,!?'"-]+$/.test(text)) {
    return { style: "english", label: "English", confidence: 0.6 };
  }

  return { style: "mixed_unknown", label: "Mixed / unrecognized style", confidence: 0.3 };
}
