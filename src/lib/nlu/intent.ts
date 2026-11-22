import {
  ALREADY_PAID_PHRASES,
  CALLBACK_PHRASES,
  CANNOT_PAY_PHRASES,
  PARTIAL_MARKERS,
  REFUSED_PHRASES,
  WRONG_NUMBER_PHRASES,
} from "./lexicon";
import { findMatchingPhrase } from "./phraseMatch";

export type PaymentIntentValue =
  | "WILL_PAY"
  | "PARTIAL_PAY"
  | "CANNOT_PAY"
  | "ALREADY_PAID"
  | "REFUSED"
  | "CALLBACK_REQUESTED"
  | "WRONG_NUMBER"
  | "UNCLEAR";

export interface IntentExtractionResult {
  intent: PaymentIntentValue;
  confidence: number;
  matchedPhrase: string | null;
}

const findPhrase = findMatchingPhrase;

export interface IntentContext {
  hasAmount: boolean;
  hasDate: boolean;
  isPartialAmount?: boolean; // amount extracted is less than outstanding, or a fraction
}

export function extractIntent(rawText: string, ctx: IntentContext): IntentExtractionResult {
  const text = rawText || "";

  const alreadyPaid = findPhrase(text, ALREADY_PAID_PHRASES);
  if (alreadyPaid) {
    return { intent: "ALREADY_PAID", confidence: 0.85, matchedPhrase: alreadyPaid };
  }

  const wrongNumber = findPhrase(text, WRONG_NUMBER_PHRASES);
  if (wrongNumber) {
    return { intent: "WRONG_NUMBER", confidence: 0.9, matchedPhrase: wrongNumber };
  }

  const refused = findPhrase(text, REFUSED_PHRASES);
  if (refused) {
    return { intent: "REFUSED", confidence: 0.8, matchedPhrase: refused };
  }

  const callback = findPhrase(text, CALLBACK_PHRASES);
  if (callback) {
    return { intent: "CALLBACK_REQUESTED", confidence: 0.8, matchedPhrase: callback };
  }

  const cannotPay = findPhrase(text, CANNOT_PAY_PHRASES);
  if (cannotPay) {
    return { intent: "CANNOT_PAY", confidence: 0.8, matchedPhrase: cannotPay };
  }

  const partialMarker = findPhrase(text, PARTIAL_MARKERS);
  if (partialMarker) {
    return { intent: "PARTIAL_PAY", confidence: 0.7, matchedPhrase: partialMarker };
  }
  if (ctx.isPartialAmount && (ctx.hasAmount || ctx.hasDate)) {
    return { intent: "PARTIAL_PAY", confidence: 0.7, matchedPhrase: null };
  }

  if (ctx.hasAmount || ctx.hasDate) {
    return { intent: "WILL_PAY", confidence: 0.7, matchedPhrase: null };
  }

  return { intent: "UNCLEAR", confidence: 0, matchedPhrase: null };
}
