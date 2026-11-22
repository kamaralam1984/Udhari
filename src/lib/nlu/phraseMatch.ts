/**
 * Shared substring-vs-word-boundary matching for the lexicon's phrase lists.
 *
 * Plain `text.includes(phrase)` breaks on short Latin/Roman markers like
 * "na"/"ha"/"ji" — they turn up as false positives INSIDE unrelated English
 * words ("na" inside "management", "ha" inside "that's"). This surfaces for
 * real whenever Whisper mis-transcribes actual customer speech into
 * unrelated English text (a genuine, observed STT limitation, not
 * hypothetical) — a stray "na" then wrongly fires a NEGATIVE/WRONG_NUMBER
 * classification on gibberish that was never a "no". Devanagari phrases
 * don't have this failure mode (no shared alphabet with English words), so
 * they keep simple substring matching, which is also what correctly lets a
 * short Devanagari marker match inside a longer transliterated sentence.
 */
const PURE_LATIN = /^[a-z\s']+$/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsPhrase(text: string, phrase: string): boolean {
  const lower = text.toLowerCase();
  const p = phrase.toLowerCase();
  if (PURE_LATIN.test(p)) {
    return new RegExp(`\\b${escapeRegex(p)}\\b`).test(lower);
  }
  return lower.includes(p);
}

export function findMatchingPhrase(text: string, phrases: string[]): string | null {
  for (const p of phrases) {
    if (containsPhrase(text, p)) return p;
  }
  return null;
}
