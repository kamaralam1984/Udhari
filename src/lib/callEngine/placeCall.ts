import { db } from "../db";
import { getAppSettings } from "../antiSpam";
import { startCall } from "./engine";
import type { EngineCustomer } from "./types";
import { MockTelephonyProvider } from "../providers/telephony/mock";
import { getTelephonyProvider } from "../providers/registry";

export class CustomerNotFoundError extends Error {
  constructor(customerId: string) {
    super(`Customer not found: ${customerId}`);
  }
}

export interface PlaceAiCallOptions {
  mode: "TEST" | "PRODUCTION";
  /** null for a system/scheduler-triggered call — there is no HTTP session to attribute it to. */
  initiatedByUserId: string | null;
  /** Set when the call is part of a Campaign (see /campaigns). */
  campaignId?: string | null;
}

/**
 * Places a new AI call and persists its opening turn. Extracted out of
 * POST /api/calls so both the HTTP route (a human clicking "place call") and
 * the follow-up scheduler (a system-triggered call, no HTTP session) can
 * start a call through the exact same path — callers are still responsible
 * for their own auth/role checks and the antiSpam.canPlaceCall() gate before
 * calling this; it does not re-check them.
 */
export async function placeAiCall(customerId: string, options: PlaceAiCallOptions) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerNotFoundError(customerId);

  const settings = await getAppSettings();

  const preCall = await db.call.create({
    data: {
      customerId,
      phoneNumber: customer.phoneNumber,
      mode: options.mode,
      initiatedByUserId: options.initiatedByUserId ?? undefined,
      campaignId: options.campaignId ?? undefined,
    },
  });

  // TEST mode always uses the mock provider, regardless of TELEPHONY_PROVIDER,
  // so a misconfigured env var can never place a real call during testing.
  const telephony = options.mode === "TEST" ? new MockTelephonyProvider() : getTelephonyProvider();
  const handle = await telephony.placeCall({ toPhoneNumber: customer.phoneNumber, callId: preCall.id });

  const call = await db.call.update({
    where: { id: preCall.id },
    data: {
      telephonyProviderCallId: handle.providerCallId,
      status: "CONNECTED", // MVP: the mock/text engine runs synchronously once "connected"
      startedAt: new Date(),
    },
  });

  const engineCustomer: EngineCustomer = {
    id: customer.id,
    name: customer.name,
    outstandingAmount: Number(customer.outstandingAmount),
    preferredLanguage: customer.preferredLanguage,
  };
  const step = startCall(engineCustomer, call.createdAt, settings.businessName);

  await db.callTranscript.create({
    data: { callId: call.id, sequence: 1, speaker: "AI", text: step.aiLine, timestamp: call.createdAt },
  });

  const openFollowUp = await db.followUp.findFirst({ where: { customerId, status: "PENDING" } });
  if (openFollowUp) {
    await db.followUp.update({ where: { id: openFollowUp.id }, data: { attemptCount: { increment: 1 } } });
  }

  return { call, aiLine: step.aiLine };
}
