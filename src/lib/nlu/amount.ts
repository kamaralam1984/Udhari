import { DEVANAGARI_DIGITS, FRACTION_WORDS, MULTIPLIER_WORDS, NUMBER_WORDS } from "./lexicon";

export interface AmountExtractionResult {
  /** Absolute rupee amount if one could be determined (may be derived from a fraction). */
  amount: number | null;
  /** True when the amount came from a fraction word ("aadha") rather than a stated number. */
  isFraction: boolean;
  fractionValue: number | null;
  /** True when nothing usable was found, or a fraction was found with no outstanding-amount context. */
  ambiguous: boolean;
  confidence: number; // 0..1
  matchedText: string | null;
}

const DATE_UNIT_EXCLUSIONS = [
  "din", "dinon", "tareekh", "tarikh", "hafte", "hafta", "hafton", "mahina", "mahine",
  "saal", "baje", "ghante", "ghanta", "minute", "second",
  "दिन", "तारीख", "तारिख", "हफ्ते", "हफ्ता", "महीना", "महीने", "साल", "बजे", "घंटे", "घंटा",
];

function normalizeDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
}

/** Tokenize but keep commas inside pure-digit runs (Indian grouping 1,00,000). */
function tokenizeKeepDigitCommas(text: string): string[] {
  const withNormalDigits = normalizeDigits(text).toLowerCase();
  return withNormalDigits
    .replace(/(\d)[,](?=\d)/g, "$1<COMMA>")
    .replace(/,/g, " ")
    .replace(/<COMMA>/g, ",")
    .split(/\s+/)
    .filter(Boolean);
}

function isPureNumberToken(tok: string): boolean {
  return /^\d[\d,]*(\.\d+)?$/.test(tok);
}

/** Sentence-ending punctuation — Devanagari danda plus the usual Latin ones. */
const SENTENCE_SPLIT = /[।.!?]+/;

interface ClauseAmount {
  sum: number;
  matchedParts: string[];
}

/**
 * "X me se Y" / "X में से Y" / "out of X, Y" names the OUTSTANDING total, not
 * an amount being promised — e.g. "50000 me se sirf 10000 dunga" and "out of
 * 25000 I'll pay 15000" must both extract the SECOND number, not the sum.
 * Comma alone doesn't split SENTENCE_SPLIT's clauses (a single spoken
 * sentence often has commas), so without this the two numbers land in the
 * same clause and scanClauseForAmount's compound-number summing (correct for
 * "ek lakh pachaas hazar") wrongly adds them together.
 *
 * The two phrasings put the total on OPPOSITE sides of the marker — Hindi/
 * Maithili "X me se Y" names the total BEFORE the marker (strip through the
 * marker, keep what follows), English "out of X, Y" names it AFTER the
 * marker (strip the marker + the number immediately following it) — so they
 * need different stripping logic, not one shared regex.
 */
const OUT_OF_SUFFIX_MARKER = /(mein\s*se|me\s*se|में\s*से|मे\s*से)/i;
const OUT_OF_PREFIX_MARKER = /out\s*of\s*[\d,]+(\.\d+)?\s*/i;

function stripOutOfPrefix(clauseRaw: string): string {
  let clause = clauseRaw.replace(OUT_OF_PREFIX_MARKER, "");
  let match = clause.match(OUT_OF_SUFFIX_MARKER);
  while (match && match.index !== undefined) {
    clause = clause.slice(match.index + match[0].length);
    match = clause.match(OUT_OF_SUFFIX_MARKER);
  }
  return clause;
}

/**
 * Sums number(+multiplier) tokens found WITHIN one clause — this is what
 * correctly combines a single compound figure like "ek lakh pachaas hazar"
 * (100000 + 50000 = 150000). It must never run across clause boundaries: two
 * unrelated numbers mentioned in different sentences are not one number.
 */
function scanClauseForAmount(clauseRaw: string): ClauseAmount | null {
  const clause = stripOutOfPrefix(clauseRaw);
  const tokens = tokenizeKeepDigitCommas(clause);
  const cleanTokens = tokens.map((t) => t.replace(/[.,!?;:()]+$/g, ""));

  let sum = 0;
  let matched = false;
  const matchedParts: string[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < cleanTokens.length; i++) {
    if (consumed.has(i)) continue;
    const tok = cleanTokens[i];
    const nextTok = cleanTokens[i + 1];
    const nextIsDateUnit = nextTok && DATE_UNIT_EXCLUSIONS.includes(nextTok);
    if (nextIsDateUnit) continue;

    let base: number | null = null;
    if (isPureNumberToken(tok)) {
      base = parseFloat(tok.replace(/,/g, ""));
    } else if (tok in NUMBER_WORDS) {
      base = NUMBER_WORDS[tok];
    }

    if (base === null) continue;

    // A lone small digit/word not attached to a multiplier or big enough to be
    // a rupee amount on its own is almost always a date/count, not money.
    const nextIsMultiplier = nextTok && nextTok in MULTIPLIER_WORDS;
    if (nextIsMultiplier) {
      const factor = MULTIPLIER_WORDS[nextTok];
      sum += base * factor;
      matched = true;
      matchedParts.push(`${tok} ${nextTok}`);
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
    } else if (isPureNumberToken(tok) && base >= 100) {
      // e.g. "50000", "20,000" standing alone.
      sum += base;
      matched = true;
      matchedParts.push(tok);
      consumed.add(i);
    }
    // Bare small number words with no multiplier ("teen", "3") are ignored —
    // in this domain they almost always describe a day/date count, not money.
  }

  return matched ? { sum, matchedParts } : null;
}

export function extractAmount(rawText: string): AmountExtractionResult {
  const text = rawText || "";
  const clauses = text.split(SENTENCE_SPLIT).map((c) => c.trim()).filter(Boolean);
  // Fall back to the whole text as one "clause" if there was no punctuation at all.
  const clauseList = clauses.length > 0 ? clauses : [text];

  const clauseResults = clauseList.map(scanClauseForAmount).filter((r): r is ClauseAmount => r !== null);

  if (clauseResults.length === 1) {
    return {
      amount: clauseResults[0].sum,
      isFraction: false,
      fractionValue: null,
      ambiguous: false,
      confidence: 0.9,
      matchedText: clauseResults[0].matchedParts.join(", "),
    };
  }

  if (clauseResults.length > 1) {
    // Several distinct amounts mentioned in different sentences (e.g. a long
    // narrative covering goods value, a past part-payment, another
    // customer's balance...). Summing these would invent a number nobody
    // said — surface all candidates and force a clarification instead.
    return {
      amount: null,
      isFraction: false,
      fractionValue: null,
      ambiguous: true,
      confidence: 0.2,
      matchedText: `multiple distinct amounts mentioned: ${clauseResults.map((r) => r.sum).join(", ")}`,
    };
  }

  // Fraction words: "aadha payment", "pura paisa" — needs outstanding-amount
  // context from the caller to resolve to a number; we only flag it here.
  const allTokens = tokenizeKeepDigitCommas(text).map((t) => t.replace(/[.,!?;:()]+$/g, ""));
  for (const tok of allTokens) {
    if (tok in FRACTION_WORDS) {
      return {
        amount: null,
        isFraction: true,
        fractionValue: FRACTION_WORDS[tok],
        ambiguous: true,
        confidence: 0.5,
        matchedText: tok,
      };
    }
  }

  return {
    amount: null,
    isFraction: false,
    fractionValue: null,
    ambiguous: true,
    confidence: 0,
    matchedText: null,
  };
}

/** Resolve a fraction result against a known outstanding amount. Confirmation by the customer is still required before saving. */
export function resolveFractionAmount(
  result: AmountExtractionResult,
  outstandingAmount: number | null
): AmountExtractionResult {
  if (!result.isFraction || result.fractionValue === null || outstandingAmount === null) {
    return result;
  }
  return {
    ...result,
    amount: Math.round(outstandingAmount * result.fractionValue * 100) / 100,
    ambiguous: true, // derived, not stated — must still be confirmed with the customer
    confidence: 0.55,
  };
}
