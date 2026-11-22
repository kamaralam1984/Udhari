import { AFFIRMATIVE_PHRASES, ANGRY_PHRASES, NEGATIVE_PHRASES } from "./lexicon";
import { containsPhrase } from "./phraseMatch";

export type YesNo = "YES" | "NO" | "UNCLEAR";

/** Negative phrases are checked first — "ji nahi" must not match on "ji". */
export function detectYesNo(rawText: string): YesNo {
  const text = rawText || "";
  if (NEGATIVE_PHRASES.some((p) => containsPhrase(text, p))) return "NO";
  if (AFFIRMATIVE_PHRASES.some((p) => containsPhrase(text, p))) return "YES";
  return "UNCLEAR";
}

export function isAngry(rawText: string): boolean {
  const text = rawText || "";
  return ANGRY_PHRASES.some((p) => containsPhrase(text, p));
}
