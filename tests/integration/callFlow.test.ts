import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startCall, handleCustomerUtterance, reconstructSession } from "@/lib/callEngine/engine";
import { finalizeSession } from "@/lib/callEngine/finalize";
import { persistFinalizedCall } from "@/lib/callEngine/persist";
import { canPlaceCall } from "@/lib/antiSpam";
import { createCallRow, createTestCustomer, cleanupCustomer } from "./helpers";
import type { EngineCustomer } from "@/lib/callEngine/types";
import { dateInAppTz } from "@/lib/time";

// Fixed daytime timestamp so anti-spam tests are not at the mercy of the
// real wall clock landing inside quiet hours (21:00–09:00 IST by default).
const DAYTIME_NOW = dateInAppTz(2026, 8, 1, 12, 0, 0);

let customerId: string;

beforeEach(async () => {
  const c = await createTestCustomer({ outstandingAmount: 75000 });
  customerId = c.id;
});

afterEach(async () => {
  await cleanupCustomer(customerId);
});

function toEngineCustomer(customer: { id: string; name: string; outstandingAmount: unknown; preferredLanguage: string }): EngineCustomer {
  return {
    id: customer.id,
    name: customer.name,
    outstandingAmount: Number(customer.outstandingAmount),
    preferredLanguage: customer.preferredLanguage,
  };
}

async function runFullConversation(customerUtterances: string[]) {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  const engineCustomer = toEngineCustomer(customer);
  const call = await createCallRow(customerId);

  let step = startCall(engineCustomer, call.createdAt);
  for (const utterance of customerUtterances) {
    if (step.session.stage === "DONE") break;
    step = await handleCustomerUtterance(step.session, utterance);
  }

  const finalized = finalizeSession(step.session);
  await persistFinalizedCall(call.id, finalized);
  return { call, finalized };
}

describe("Call flow — end to end (mock mode)", () => {
  it("Case 1: customer confirms amount + date -> PromiseToPay is created", async () => {
    const { call, finalized } = await runFullConversation([
      "Ji haan", // identity confirmed
      "Agla Monday ko pachaas hazaar de denge", // amount+date
      "Ji haan sahi hai", // confirmation
    ]);

    expect(finalized.extraction.callStatus).toBe("COMPLETED");
    expect(finalized.extraction.promisedAmount).toBe(50000);
    expect(finalized.extraction.verificationRequired).toBe(false);

    const promise = await db.promiseToPay.findUnique({ where: { callId: call.id } });
    expect(promise).not.toBeNull();
    expect(Number(promise!.promisedAmount)).toBe(50000);
    expect(promise!.confirmedByCustomer).toBe(true);

    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(Number(customer.lastPromiseAmount)).toBe(50000);

    const usage = await db.callUsageLog.findMany({ where: { callId: call.id } });
    expect(usage.length).toBeGreaterThan(0);
  });

  it("Case 6 / payment security: 'already paid' NEVER creates a promise, only a verification task", async () => {
    const { call, finalized } = await runFullConversation([
      "Ji haan",
      "Maine to staff ko cash de diye the pichhle hafte",
    ]);

    expect(finalized.extraction.paymentIntent).toBe("ALREADY_PAID");
    expect(finalized.extraction.verificationRequired).toBe(true);
    expect(finalized.extraction.promisedAmount).toBeNull();

    const promise = await db.promiseToPay.findUnique({ where: { callId: call.id } });
    expect(promise).toBeNull();

    const tasks = await db.staffTask.findMany({ where: { callId: call.id } });
    expect(tasks.some((t) => t.type === "PAYMENT_VERIFICATION_REQUIRED")).toBe(true);
  });

  it("AI_UNCERTAIN: unclear response, one clarification, still unclear -> staff review, no promise", async () => {
    const { call, finalized } = await runFullConversation(["Ji haan", "hmm woh kya hai na", "arre chodo yaar"]);

    expect(finalized.extraction.callStatus).toBe("AI_UNCERTAIN");
    expect(finalized.extraction.verificationRequired).toBe(true);

    const promise = await db.promiseToPay.findUnique({ where: { callId: call.id } });
    expect(promise).toBeNull();

    const tasks = await db.staffTask.findMany({ where: { callId: call.id } });
    expect(tasks.some((t) => t.type === "AI_UNCERTAIN_REVIEW")).toBe(true);
  });

  it("Case 8: wrong number never reveals the outstanding amount", async () => {
    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const engineCustomer = toEngineCustomer(customer);
    const call = await createCallRow(customerId);

    const step1 = startCall(engineCustomer, call.createdAt);
    const step2 = await handleCustomerUtterance(step1.session, "ji nahi, wrong number hai ye");

    expect(step2.done).toBe(true);
    expect(step2.session.finalStatus).toBe("WRONG_NUMBER");
    const allAiText = step2.session.turns
      .filter((t) => t.speaker === "AI")
      .map((t) => t.text)
      .join(" ");
    expect(allAiText).not.toContain("75,000");
    expect(allAiText).not.toContain("₹75000");

    const finalized = finalizeSession(step2.session);
    await persistFinalizedCall(call.id, finalized);
    const tasks = await db.staffTask.findMany({ where: { callId: call.id } });
    expect(tasks.some((t) => t.type === "WRONG_NUMBER_REVIEW")).toBe(true);
  });

  it("reconstructSession replay matches a live-handled session for the same inputs", async () => {
    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const engineCustomer = toEngineCustomer(customer);
    const now = new Date();
    const utterances = ["Ji haan", "10 din baad bees hazaar de denge", "haan sahi hai"];

    let live = startCall(engineCustomer, now);
    for (const u of utterances) {
      if (live.session.stage === "DONE") break;
      live = await handleCustomerUtterance(live.session, u);
    }

    const replayed = await reconstructSession(engineCustomer, now, utterances);
    expect(replayed.stage).toBe(live.session.stage);
    expect(replayed.collected.amount).toBe(live.session.collected.amount);
    expect(replayed.collected.date?.getTime()).toBe(live.session.collected.date?.getTime());
  });
});

describe("Anti-spam gate", () => {
  it("blocks calls to a DO_NOT_CALL customer", async () => {
    await cleanupCustomer(customerId);
    const c = await createTestCustomer({ doNotCall: true });
    customerId = c.id;
    const result = await canPlaceCall(customerId, DAYTIME_NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("DO_NOT_CALL");
  });

  it("blocks a second call before the minimum gap has elapsed", async () => {
    await createCallRow(customerId);
    const result = await canPlaceCall(customerId, DAYTIME_NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MIN_GAP_NOT_ELAPSED");
  });

  it("allows a call for a fresh customer with no history", async () => {
    const result = await canPlaceCall(customerId, DAYTIME_NOW);
    expect(result.allowed).toBe(true);
  });

  it("blocks calls during quiet hours even with no other history", async () => {
    const nightTime = dateInAppTz(2026, 8, 1, 22, 0, 0);
    const result = await canPlaceCall(customerId, nightTime);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("QUIET_HOURS");
  });
});
