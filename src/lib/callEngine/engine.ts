import { extractUtterance, formatInr } from "../nlu/extract";
import { detectYesNo, isAngry } from "../nlu/yesno";
import { formatDateHuman } from "../time";
import { getDialogue, getLanguageLabel } from "./dialogue";
import { rephraseUncertainLine } from "./llmRephrase";
import type { CallEngineSession, EngineCustomer, EngineStepResult, EngineTurn } from "./types";

function turn(speaker: EngineTurn["speaker"], text: string, now: Date): EngineTurn {
  return { speaker, text, timestamp: now.toISOString() };
}

/** Starts a new mock/real call session and returns the opening greeting. */
export function startCall(customer: EngineCustomer, now: Date = new Date(), businessName: string = "Your Business"): EngineStepResult {
  const greeting = getDialogue(customer.preferredLanguage).greeting(customer.name, businessName);
  const session: CallEngineSession = {
    stage: "AWAIT_IDENTITY",
    customer,
    now,
    turns: [turn("AI", greeting, now)],
    clarificationAttempts: { amount: 0, date: 0, unclear: 0, confirm: 0, remainder: 0 },
    collected: {
      amount: null,
      date: null,
      intent: null,
      confidence: 0,
      confirmedByCustomer: false,
      remainderAmount: null,
      remainderDate: null,
      remainderAsked: false,
    },
    finalStatus: null,
    verificationRequired: false,
    callbackRequested: false,
    wrongNumber: false,
    angryHandled: false,
    paymentVerificationStatement: null,
  };
  return { session, aiLine: greeting, done: false };
}

function reasonAndAskLine(customer: EngineCustomer): string {
  return getDialogue(customer.preferredLanguage).reasonAndAsk(formatInr(customer.outstandingAmount));
}

function confirmationLine(
  customer: EngineCustomer,
  amount: number | null,
  date: Date | null,
  remainderAmount: number | null = null,
  remainderDate: Date | null = null
): string {
  const dialogue = getDialogue(customer.preferredLanguage);
  const amountText = amount !== null ? formatInr(amount) : "yeh raashi";
  const dateText = date ? formatDateHuman(date) : "yeh tareekh";
  if (remainderAmount !== null && remainderAmount > 0) {
    const remainderAmountText = formatInr(remainderAmount);
    // "baad" (not "baad mein") because every language's confirmationPartial
    // template already appends its own postposition ("ko"/"को"/"तक"/"धरि"/
    // "by") after this text — "baad mein ko" would read as a doubled-up
    // "later" + "in" + "ko".
    const remainderDateText = remainderDate ? formatDateHuman(remainderDate) : "baad";
    return dialogue.confirmationPartial(amountText, dateText, remainderAmountText, remainderDateText);
  }
  return dialogue.confirmation(amountText, dateText);
}

/** outstandingAmount left uncovered by the amount collected so far, floored at 0. */
function computeRemainder(session: CallEngineSession): number {
  if (session.collected.amount === null) return 0;
  return Math.max(0, session.customer.outstandingAmount - session.collected.amount);
}

const CLARIFY_ONCE_LIMIT = 1;

/**
 * Advances the session by one customer turn. Async ONLY because the
 * "customer wasn't understood" lines optionally go through an LLM rephrase
 * (see llmRephrase.ts) when a real LLM_PROVIDER is configured — every other
 * decision here (stage transitions, amount/date extraction, clarification
 * limits) stays the same deterministic rule-based fold it always was.
 */
export async function handleCustomerUtterance(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const now = session.now;
  const s: CallEngineSession = {
    ...session,
    turns: [...session.turns, turn("CUSTOMER", rawText, now)],
  };

  if (s.stage === "DONE") {
    return { session: s, aiLine: "Call already ended.", done: true };
  }

  // Angry customer can surface at any point — de-escalate, offer a staff callback, end politely.
  if (!s.angryHandled && isAngry(rawText)) {
    const line = getDialogue(s.customer.preferredLanguage).angryDeescalate();
    return finalize(s, "CALLBACK_REQUESTED", line, { angryHandled: true, callbackRequested: true });
  }

  switch (s.stage) {
    case "AWAIT_IDENTITY":
      return handleIdentity(s, rawText);
    case "AWAIT_PAYMENT_INFO":
      return handlePaymentInfo(s, rawText);
    case "CLARIFY_AMOUNT":
      return handleClarifyAmount(s, rawText);
    case "CLARIFY_DATE":
      return handleClarifyDate(s, rawText);
    case "CLARIFY_REMAINDER":
      return handleClarifyRemainder(s, rawText);
    case "CLARIFY_UNCLEAR":
      return handleClarifyUnclear(s, rawText);
    case "CONFIRMING":
      return handleConfirming(s, rawText);
    default:
      return finalize(s, "AI_UNCERTAIN", await uncertainLine(s.customer, rawText), {});
  }
}

function finalize(
  session: CallEngineSession,
  status: NonNullable<CallEngineSession["finalStatus"]>,
  aiLine: string,
  patch: Partial<CallEngineSession>
): EngineStepResult {
  const withLine: CallEngineSession = {
    ...session,
    ...patch,
    stage: "DONE",
    finalStatus: status,
    turns: [...session.turns, turn("AI", aiLine, session.now)],
  };
  return { session: withLine, aiLine, done: true };
}

function handleIdentity(session: CallEngineSession, rawText: string): EngineStepResult {
  const yn = detectYesNo(rawText);
  const dialogue = getDialogue(session.customer.preferredLanguage);

  if (yn === "NO") {
    const line = dialogue.wrongNumberIdentity();
    return finalize(session, "WRONG_NUMBER", line, { wrongNumber: true });
  }

  if (yn === "UNCLEAR") {
    // Case 7: wrong person answered / identity not confirmed — never reveal the outstanding amount.
    const line = dialogue.unclearIdentity();
    return finalize(session, "CALLBACK_REQUESTED", line, { callbackRequested: true });
  }

  const line = reasonAndAskLine(session.customer);
  const next: CallEngineSession = {
    ...session,
    stage: "AWAIT_PAYMENT_INFO",
    turns: [...session.turns, turn("AI", line, session.now)],
  };
  return { session: next, aiLine: line, done: false };
}

function processExtraction(session: CallEngineSession, rawText: string) {
  return extractUtterance(rawText, { outstandingAmount: session.customer.outstandingAmount, now: session.now });
}

async function handlePaymentInfo(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const ex = processExtraction(session, rawText);
  const dialogue = getDialogue(session.customer.preferredLanguage);

  if (ex.intent.intent === "ALREADY_PAID") {
    const line = dialogue.alreadyPaid();
    return finalize(session, "COMPLETED", line, {
      verificationRequired: true,
      paymentVerificationStatement: rawText,
      collected: { ...session.collected, intent: "ALREADY_PAID", confidence: ex.overallConfidence },
    });
  }

  if (ex.intent.intent === "WRONG_NUMBER") {
    return finalize(session, "WRONG_NUMBER", dialogue.wrongNumberPaymentInfo(), { wrongNumber: true });
  }

  if (ex.intent.intent === "CALLBACK_REQUESTED") {
    return finalize(
      session,
      "CALLBACK_REQUESTED",
      dialogue.callbackRequested(),
      { callbackRequested: true, collected: { ...session.collected, intent: ex.intent.intent } }
    );
  }

  if (ex.intent.intent === "REFUSED") {
    const line = dialogue.refused();
    return finalize(session, "COMPLETED", line, {
      collected: { ...session.collected, intent: "REFUSED", confidence: ex.overallConfidence },
    });
  }

  if (ex.intent.intent === "CANNOT_PAY") {
    const line = dialogue.cannotPay();
    const next: CallEngineSession = {
      ...session,
      stage: "AWAIT_PAYMENT_INFO",
      collected: { ...session.collected, intent: "CANNOT_PAY", confidence: ex.overallConfidence },
      turns: [...session.turns, turn("AI", line, session.now)],
    };
    return { session: next, aiLine: line, done: false };
  }

  if (ex.intent.intent === "UNCLEAR") {
    return askUnclearOnce(session, rawText);
  }

  // WILL_PAY / PARTIAL_PAY
  const collected = {
    ...session.collected,
    amount: ex.amount.amount ?? session.collected.amount,
    date: ex.date.date && !ex.date.ambiguous ? ex.date.date : session.collected.date,
    intent: ex.intent.intent,
    confidence: ex.overallConfidence,
  };

  return progressAfterExtraction({ ...session, collected }, ex.needsAmountClarification, ex.needsDateClarification, rawText);
}

async function progressAfterExtraction(
  session: CallEngineSession,
  needsAmount: boolean,
  needsDate: boolean,
  rawText: string
): Promise<EngineStepResult> {
  const dialogue = getDialogue(session.customer.preferredLanguage);

  if (needsAmount) {
    if (session.clarificationAttempts.amount >= CLARIFY_ONCE_LIMIT) {
      return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
    }
    const line = dialogue.clarifyAmount();
    const next: CallEngineSession = {
      ...session,
      stage: "CLARIFY_AMOUNT",
      clarificationAttempts: { ...session.clarificationAttempts, amount: session.clarificationAttempts.amount + 1 },
      turns: [...session.turns, turn("AI", line, session.now)],
    };
    return { session: next, aiLine: line, done: false };
  }

  if (needsDate) {
    if (session.clarificationAttempts.date >= CLARIFY_ONCE_LIMIT) {
      return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
    }
    const line = dialogue.clarifyDate();
    const next: CallEngineSession = {
      ...session,
      stage: "CLARIFY_DATE",
      clarificationAttempts: { ...session.clarificationAttempts, date: session.clarificationAttempts.date + 1 },
      turns: [...session.turns, turn("AI", line, session.now)],
    };
    return { session: next, aiLine: line, done: false };
  }

  // Partial payment leaving balance uncovered: ask when the rest will be
  // paid before moving to CONFIRMING (only once per call — remainderAsked
  // guards against re-asking if the customer later revises the amount/date).
  if (session.collected.intent === "PARTIAL_PAY" && !session.collected.remainderAsked) {
    const remainder = computeRemainder(session);
    if (remainder > 0) {
      const line = dialogue.askRemainder(formatInr(remainder));
      const next: CallEngineSession = {
        ...session,
        stage: "CLARIFY_REMAINDER",
        collected: { ...session.collected, remainderAmount: remainder, remainderAsked: true },
        turns: [...session.turns, turn("AI", line, session.now)],
      };
      return { session: next, aiLine: line, done: false };
    }
  }

  const line = confirmationLine(
    session.customer,
    session.collected.amount,
    session.collected.date,
    session.collected.remainderAmount,
    session.collected.remainderDate
  );
  const next: CallEngineSession = {
    ...session,
    stage: "CONFIRMING",
    turns: [...session.turns, turn("AI", line, session.now)],
  };
  return { session: next, aiLine: line, done: false };
}

/**
 * Customer answers "when will you pay the rest" — extracts just a date from
 * the reply. If unclear once, gives up on the remainder date only (does not
 * block the whole call — the primary promise is still recorded) and moves on
 * to CONFIRMING, since the remainder amount alone (already captured) is
 * still useful even without an exact date.
 */
async function handleClarifyRemainder(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const ex = processExtraction(session, rawText);
  const dialogue = getDialogue(session.customer.preferredLanguage);

  if (ex.date.date !== null && !ex.date.ambiguous) {
    const collected = { ...session.collected, remainderDate: ex.date.date };
    const line = confirmationLine(
      session.customer,
      collected.amount,
      collected.date,
      collected.remainderAmount,
      collected.remainderDate
    );
    const next: CallEngineSession = {
      ...session,
      collected,
      stage: "CONFIRMING",
      turns: [...session.turns, turn("AI", line, session.now)],
    };
    return { session: next, aiLine: line, done: false };
  }

  if (session.clarificationAttempts.remainder >= CLARIFY_ONCE_LIMIT) {
    // Give up on the remainder date only — still confirm the primary promise.
    const line = confirmationLine(
      session.customer,
      session.collected.amount,
      session.collected.date,
      session.collected.remainderAmount,
      null
    );
    const next: CallEngineSession = {
      ...session,
      stage: "CONFIRMING",
      turns: [...session.turns, turn("AI", line, session.now)],
    };
    return { session: next, aiLine: line, done: false };
  }

  const line = dialogue.clarifyDate();
  const next: CallEngineSession = {
    ...session,
    stage: "CLARIFY_REMAINDER",
    clarificationAttempts: { ...session.clarificationAttempts, remainder: session.clarificationAttempts.remainder + 1 },
    turns: [...session.turns, turn("AI", line, session.now)],
  };
  return { session: next, aiLine: line, done: false };
}

/**
 * The "I didn't understand, staff will follow up" handoff line — tries an
 * LLM rephrase (no-op unless a real LLM_PROVIDER is configured) with the
 * canned dialogue line as a guaranteed fallback. See llmRephrase.ts.
 */
async function uncertainLine(customer: EngineCustomer, rawText: string): Promise<string> {
  const cannedLine = getDialogue(customer.preferredLanguage).uncertain();
  return rephraseUncertainLine({
    cannedLine,
    customerUtterance: rawText,
    languageLabel: getLanguageLabel(customer.preferredLanguage),
  });
}

async function askUnclearOnce(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  if (session.clarificationAttempts.unclear >= CLARIFY_ONCE_LIMIT) {
    return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
  }
  const cannedLine = getDialogue(session.customer.preferredLanguage).askUnclear();
  const line = await rephraseUncertainLine({
    cannedLine,
    customerUtterance: rawText,
    languageLabel: getLanguageLabel(session.customer.preferredLanguage),
  });
  const next: CallEngineSession = {
    ...session,
    stage: "CLARIFY_UNCLEAR",
    clarificationAttempts: { ...session.clarificationAttempts, unclear: session.clarificationAttempts.unclear + 1 },
    turns: [...session.turns, turn("AI", line, session.now)],
  };
  return { session: next, aiLine: line, done: false };
}

function handleClarifyUnclear(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const back: CallEngineSession = { ...session, stage: "AWAIT_PAYMENT_INFO" };
  return handlePaymentInfo(back, rawText);
}

async function handleClarifyAmount(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const ex = processExtraction(session, rawText);
  if (ex.amount.amount === null) {
    return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
  }
  const collected = { ...session.collected, amount: ex.amount.amount };
  return progressAfterExtraction({ ...session, collected, stage: "AWAIT_PAYMENT_INFO" }, false, session.collected.date === null, rawText);
}

async function handleClarifyDate(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const ex = processExtraction(session, rawText);
  if (ex.date.date === null || ex.date.ambiguous) {
    return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
  }
  const collected = { ...session.collected, date: ex.date.date };
  return progressAfterExtraction({ ...session, collected, stage: "AWAIT_PAYMENT_INFO" }, session.collected.amount === null, false, rawText);
}

/**
 * Rebuilds a session purely from the customer's stored utterances. The
 * engine is a deterministic fold, so this lets serverless API routes
 * reconstruct in-progress state from the database instead of holding it in
 * memory — the same replay always produces the same STATE given the same
 * `callCreatedAt` anchor (the LLM rephrase, when configured, can vary the
 * exact WORDING of past AI turns on replay, but replayed turns are only used
 * to recompute engine state and a turn count — see advanceTurn.ts — never
 * re-persisted, so that variance is harmless).
 */
export async function reconstructSession(
  customer: EngineCustomer,
  callCreatedAt: Date,
  customerUtterances: string[],
  businessName: string = "Your Business"
): Promise<CallEngineSession> {
  let state = startCall(customer, callCreatedAt, businessName).session;
  for (const utterance of customerUtterances) {
    if (state.stage === "DONE") break;
    state = (await handleCustomerUtterance(state, utterance)).session;
  }
  return state;
}

async function handleConfirming(session: CallEngineSession, rawText: string): Promise<EngineStepResult> {
  const yn = detectYesNo(rawText);

  if (yn === "YES") {
    const line = getDialogue(session.customer.preferredLanguage).confirmed(
      session.customer.name,
      formatDateHuman(session.collected.date)
    );
    return finalize(session, "COMPLETED", line, {
      collected: { ...session.collected, confirmedByCustomer: true },
    });
  }

  // NO or UNCLEAR: try to pick up a correction from the same utterance once.
  if (session.clarificationAttempts.confirm >= CLARIFY_ONCE_LIMIT) {
    return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
  }

  const ex = processExtraction(session, rawText);
  const collected = {
    ...session.collected,
    amount: ex.amount.amount ?? session.collected.amount,
    date: ex.date.date && !ex.date.ambiguous ? ex.date.date : session.collected.date,
  };
  const nextAttempts = { ...session.clarificationAttempts, confirm: session.clarificationAttempts.confirm + 1 };

  if (ex.amount.amount === null && (ex.date.date === null || ex.date.ambiguous)) {
    return finalize(session, "AI_UNCERTAIN", await uncertainLine(session.customer, rawText), { verificationRequired: true });
  }

  const line = confirmationLine(
    session.customer,
    collected.amount,
    collected.date,
    session.collected.remainderAmount,
    session.collected.remainderDate
  );
  const next: CallEngineSession = {
    ...session,
    collected,
    clarificationAttempts: nextAttempts,
    stage: "CONFIRMING",
    turns: [...session.turns, turn("AI", line, session.now)],
  };
  return { session: next, aiLine: line, done: false };
}
