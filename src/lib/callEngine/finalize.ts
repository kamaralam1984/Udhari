import { formatInr } from "../nlu/extract";
import { formatDateHuman } from "../time";
import { validateAiExtraction, type AiExtraction } from "../nlu/schema";
import type { CallEngineSession, EngineTurn } from "./types";

function buildSummary(session: CallEngineSession): string {
  const { collected, finalStatus, verificationRequired, callbackRequested, wrongNumber } = session;

  if (wrongNumber) {
    return "Customer ne bataya ki ye number galat hai ya sahi vyakti se baat nahi ho payi. Number record update karna zaroori hai.";
  }
  if (verificationRequired && collected.intent === "ALREADY_PAID") {
    return "Customer ne kaha ki payment pehle hi kar diya hai. Payment verification ke liye staff task create kiya gaya hai.";
  }
  if (finalStatus === "AI_UNCERTAIN") {
    return "AI customer ka jawab poori tarah samajh nahi paaya. Staff review ke liye task create kiya gaya hai.";
  }
  if (callbackRequested) {
    return "Customer ne abhi baat nahi ki ya callback maanga hai. Staff dwara baad mein sampark kiya jayega.";
  }
  if (collected.intent === "REFUSED") {
    return "Customer ne payment dene se mana kar diya. Staff follow-up zaroori hai.";
  }
  if (collected.confirmedByCustomer && collected.amount !== null && collected.date) {
    const remainderNote =
      collected.remainderAmount !== null && collected.remainderAmount > 0
        ? ` Baaki ${formatInr(collected.remainderAmount)} ${
            collected.remainderDate ? formatDateHuman(collected.remainderDate) + " tak" : "baad mein"
          } denge — yeh partial payment hai.`
        : "";
    return (
      `Customer ne bataya ki ${formatInr(collected.amount)} ${formatDateHuman(collected.date)} ko denge.` +
      remainderNote +
      ` Customer ne payment date confirm ki. Next follow-up ${formatDateHuman(collected.date)} ko schedule hai.`
    );
  }
  return "Call complete hui. Customer se mile response ke details upar diye gaye hain.";
}

export interface FinalizedCallResult {
  extraction: AiExtraction;
  transcript: EngineTurn[];
  raw: CallEngineSession;
}

/**
 * Turns a finished engine session into the strict, schema-validated JSON
 * contract. Throws only on a genuine programmer error (missing finalStatus)
 * — never lets a malformed shape slip through, per the "never let AI output
 * touch financial records unchecked" rule.
 */
export function finalizeSession(session: CallEngineSession): FinalizedCallResult {
  if (!session.finalStatus) {
    throw new Error("Cannot finalize a session that has not reached DONE");
  }

  const customerTurns = session.turns.filter((t) => t.speaker === "CUSTOMER").map((t) => t.text);
  const candidate = {
    callStatus: session.finalStatus,
    customerResponse: customerTurns.join(" | "),
    paymentIntent: session.collected.intent ?? "UNCLEAR",
    promisedAmount:
      session.collected.confirmedByCustomer && session.collected.amount !== null ? session.collected.amount : null,
    promisedDate:
      session.collected.confirmedByCustomer && session.collected.date ? session.collected.date.toISOString() : null,
    remainderAmount:
      session.collected.confirmedByCustomer && session.collected.remainderAmount !== null && session.collected.remainderAmount > 0
        ? session.collected.remainderAmount
        : null,
    remainderDate:
      session.collected.confirmedByCustomer && session.collected.remainderDate
        ? session.collected.remainderDate.toISOString()
        : null,
    confidence: session.collected.confidence,
    summary: buildSummary(session),
    nextFollowUpDate:
      session.collected.confirmedByCustomer && session.collected.date ? session.collected.date.toISOString() : null,
    verificationRequired: session.verificationRequired,
    callbackRequested: session.callbackRequested,
  };

  const validated = validateAiExtraction(candidate);
  if (!validated.success) {
    // Malformed AI output must never reach financial records — fail safe into AI_UNCERTAIN.
    const safe: AiExtraction = {
      callStatus: "AI_UNCERTAIN",
      customerResponse: candidate.customerResponse,
      paymentIntent: "UNCLEAR",
      promisedAmount: null,
      promisedDate: null,
      remainderAmount: null,
      remainderDate: null,
      confidence: 0,
      summary: "AI output validation failed — staff review required.",
      nextFollowUpDate: null,
      verificationRequired: true,
      callbackRequested: false,
    };
    return {
      extraction: safe,
      transcript: session.turns,
      raw: session,
    };
  }

  return { extraction: validated.data, transcript: session.turns, raw: session };
}
