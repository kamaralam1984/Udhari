import { db } from "../db";
import { getAppSettings } from "../antiSpam";
import { handleCustomerUtterance, reconstructSession } from "./engine";
import { finalizeSession } from "./finalize";
import { persistFinalizedCall } from "./persist";
import type { EngineCustomer } from "./types";

export class CallNotFoundError extends Error {
  constructor(callId: string) {
    super(`Call not found: ${callId}`);
  }
}

export class CallAlreadyEndedError extends Error {
  constructor(public readonly status: string) {
    super(`Call has already ended (status: ${status}).`);
  }
}

const TERMINAL_STATUSES = ["COMPLETED", "AI_UNCERTAIN", "CALLBACK_REQUESTED", "WRONG_NUMBER", "FAILED", "NO_ANSWER", "BUSY"];

export interface AdvanceTurnResult {
  aiLine: string;
  done: boolean;
  call?: Awaited<ReturnType<typeof persistFinalizedCall>>;
}

/**
 * Advances a call by one customer turn: reconstructs engine state from the
 * persisted transcript, folds in the new utterance, persists the resulting
 * turns, and finalizes the call when the engine reaches DONE. This is the
 * single seam both the mock-mode HTTP route (a tester's typed text) and the
 * real-call audio bridge (an STT transcript) advance a call through — the
 * engine and persistence layer never know or care which one produced the text.
 */
export async function advanceCallTurn(callId: string, customerUtteranceText: string): Promise<AdvanceTurnResult> {
  const call = await db.call.findUnique({ where: { id: callId }, include: { customer: true } });
  if (!call) throw new CallNotFoundError(callId);
  if (TERMINAL_STATUSES.includes(call.status)) throw new CallAlreadyEndedError(call.status);

  const existingTranscripts = await db.callTranscript.findMany({
    where: { callId },
    orderBy: { sequence: "asc" },
  });
  const priorCustomerUtterances = existingTranscripts.filter((t) => t.speaker === "CUSTOMER").map((t) => t.text);

  const engineCustomer: EngineCustomer = {
    id: call.customer.id,
    name: call.customer.name,
    outstandingAmount: Number(call.customer.outstandingAmount),
    preferredLanguage: call.customer.preferredLanguage,
  };

  const settings = await getAppSettings();
  const priorSession = await reconstructSession(engineCustomer, call.createdAt, priorCustomerUtterances, settings.businessName);
  const step = await handleCustomerUtterance(priorSession, customerUtteranceText);

  const newTurns = step.session.turns.slice(priorSession.turns.length);
  await db.callTranscript.createMany({
    data: newTurns.map((t, idx) => ({
      callId,
      sequence: existingTranscripts.length + idx + 1,
      speaker: t.speaker,
      text: t.text,
      timestamp: new Date(t.timestamp),
    })),
  });

  if (step.done) {
    const finalized = finalizeSession(step.session);
    const finalCall = await persistFinalizedCall(callId, finalized);
    return { aiLine: step.aiLine, done: true, call: finalCall };
  }

  return { aiLine: step.aiLine, done: false };
}
