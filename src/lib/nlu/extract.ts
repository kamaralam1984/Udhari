import { extractAmount, resolveFractionAmount, type AmountExtractionResult } from "./amount";
import { extractDate, type DateExtractionResult } from "./date";
import { extractIntent, type IntentExtractionResult } from "./intent";
import { detectLanguageStyle, type LanguageDetectionResult } from "./language";
import { REMAINDER_LATER_PHRASES } from "./lexicon";
import { containsPhrase } from "./phraseMatch";
import { formatDateHuman } from "../time";

export interface ExtractionContext {
  outstandingAmount?: number | null;
  now?: Date;
}

export interface UtteranceExtraction {
  rawText: string;
  language: LanguageDetectionResult;
  amount: AmountExtractionResult;
  date: DateExtractionResult;
  intent: IntentExtractionResult;
  overallConfidence: number;
  needsAmountClarification: boolean;
  needsDateClarification: boolean;
  aiInterpretation: string;
}

export function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function extractUtterance(rawText: string, ctx: ExtractionContext = {}): UtteranceExtraction {
  const now = ctx.now ?? new Date();
  const language = detectLanguageStyle(rawText);
  const amountRaw = extractAmount(rawText);
  const amount = resolveFractionAmount(amountRaw, ctx.outstandingAmount ?? null);
  const date = extractDate(rawText, now);

  // An explicit fraction word ("aadha", "jitna ho payega") always signals a
  // partial payment. A promised amount smaller than the full outstanding
  // balance, by itself, does NOT (see spec's own worked example: ₹75,000
  // outstanding, ₹50,000 promised is still a plain WILL_PAY promise) — but if
  // the customer's own words also say more is coming later ("10000 abhi,
  // baaki baad mein"), that combination does count as partial, so the engine
  // goes on to ask when the remainder will be paid (see engine.ts).
  const hasRemainderCue = REMAINDER_LATER_PHRASES.some((p) => containsPhrase(rawText, p));
  const isPartialAmount = amount.isFraction === true || (amount.amount !== null && hasRemainderCue);

  const intent = extractIntent(rawText, {
    hasAmount: amount.amount !== null,
    hasDate: date.date !== null && !date.ambiguous,
    isPartialAmount,
  });

  const promiseLike = intent.intent === "WILL_PAY" || intent.intent === "PARTIAL_PAY";
  const needsAmountClarification = promiseLike && amount.amount === null;
  const needsDateClarification = promiseLike && (date.date === null || date.ambiguous);

  let overallConfidence: number;
  if (!promiseLike) {
    overallConfidence = intent.confidence;
  } else {
    const parts = [intent.confidence];
    if (!needsAmountClarification) parts.push(amount.confidence);
    if (!needsDateClarification) parts.push(date.confidence);
    overallConfidence = parts.reduce((a, b) => a + b, 0) / parts.length;
    if (needsAmountClarification || needsDateClarification) {
      overallConfidence = Math.min(overallConfidence, 0.55);
    }
  }

  const aiInterpretation = buildAiInterpretation({ intent, amount, date, needsAmountClarification, needsDateClarification });

  return {
    rawText,
    language,
    amount,
    date,
    intent,
    overallConfidence: Math.round(overallConfidence * 100) / 100,
    needsAmountClarification,
    needsDateClarification,
    aiInterpretation,
  };
}

function buildAiInterpretation(args: {
  intent: IntentExtractionResult;
  amount: AmountExtractionResult;
  date: DateExtractionResult;
  needsAmountClarification: boolean;
  needsDateClarification: boolean;
}): string {
  const { intent, amount, date, needsAmountClarification, needsDateClarification } = args;

  switch (intent.intent) {
    case "ALREADY_PAID":
      return "Customer ne kaha ki payment pehle hi kar diya hai. Ye claim staff se verify karwana zaroori hai — AI ise payment received mark nahi karega.";
    case "WRONG_NUMBER":
      return "Customer ne bataya ki ye number unka nahi hai ya galat vyakti se baat ho rahi hai.";
    case "REFUSED":
      return "Customer ne payment dene se seedha mana kar diya.";
    case "CALLBACK_REQUESTED":
      return "Customer ne abhi baat karne se mana kiya aur baad me call karne ko kaha.";
    case "CANNOT_PAY":
      return "Customer ne bataya ki abhi paisa dena mushkil hai, thoda time chahiye.";
    case "WILL_PAY":
    case "PARTIAL_PAY": {
      const amountText = amount.amount !== null ? formatInr(amount.amount) : needsAmountClarification ? "(raashi spasht nahi hai)" : "";
      const dateText = date.date ? formatDateHuman(date.date) : needsDateClarification ? "(tareekh spasht nahi hai)" : "";
      const label = intent.intent === "PARTIAL_PAY" ? "kuch hissa" : "";
      if (amountText && dateText) {
        return `Customer ${label ? label + " " : ""}${amountText} ${dateText} ko dene ki baat kar rahe hain.`;
      }
      if (amountText) return `Customer ${amountText} dene ki baat kar rahe hain, lekin tareekh spasht nahi hai.`;
      if (dateText) return `Customer ${dateText} tak payment karne ki baat kar rahe hain, lekin raashi spasht nahi hai.`;
      return "Customer payment karne ko taiyaar lag rahe hain, lekin raashi aur tareekh dono spasht nahi hain.";
    }
    default:
      return "AI customer ka jawab poori tarah samajh nahi paaya. Clarification ya staff review zaroori hai.";
  }
}
