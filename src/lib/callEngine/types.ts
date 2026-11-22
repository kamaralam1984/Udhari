import type { PaymentIntentValue } from "../nlu/intent";

export type EngineStage =
  | "AWAIT_IDENTITY"
  | "AWAIT_PAYMENT_INFO"
  | "CLARIFY_AMOUNT"
  | "CLARIFY_DATE"
  | "CLARIFY_REMAINDER"
  | "CLARIFY_UNCLEAR"
  | "CONFIRMING"
  | "DONE";

export type EngineFinalStatus =
  | "COMPLETED"
  | "AI_UNCERTAIN"
  | "CALLBACK_REQUESTED"
  | "WRONG_NUMBER";

export interface EngineTurn {
  speaker: "AI" | "CUSTOMER" | "SYSTEM";
  text: string;
  timestamp: string;
}

export interface EngineCustomer {
  id: string;
  name: string;
  outstandingAmount: number;
  preferredLanguage: string;
}

export interface EngineCollected {
  amount: number | null;
  date: Date | null;
  intent: PaymentIntentValue | null;
  confidence: number;
  confirmedByCustomer: boolean;
  // Populated only for a PARTIAL_PAY promise that leaves outstandingAmount
  // uncovered — see engine.ts's progressAfterExtraction / handleClarifyRemainder.
  remainderAmount: number | null;
  remainderDate: Date | null;
  remainderAsked: boolean;
}

export interface CallEngineSession {
  stage: EngineStage;
  customer: EngineCustomer;
  now: Date;
  turns: EngineTurn[];
  clarificationAttempts: { amount: number; date: number; unclear: number; confirm: number; remainder: number };
  collected: EngineCollected;
  finalStatus: EngineFinalStatus | null;
  verificationRequired: boolean;
  callbackRequested: boolean;
  wrongNumber: boolean;
  angryHandled: boolean;
  paymentVerificationStatement: string | null;
}

export interface EngineStepResult {
  session: CallEngineSession;
  aiLine: string;
  done: boolean;
}
