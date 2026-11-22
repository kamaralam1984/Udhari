import { NextRequest, NextResponse } from "next/server";
import type { CallStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Twilio call-status callback. No session auth (Twilio has no session
 * cookie) — authorized via a shared-secret query param that
 * TwilioTelephonyProvider.placeCall embeds in the StatusCallback URL. Our
 * internal Call.id is also embedded directly as a `callId` query param
 * (Twilio POSTs to whatever StatusCallback URL was given, query string
 * included), so no CustomField-style round-trip is needed. This path must
 * stay in the `/api/webhooks/` prefix proxy.ts already exempts from
 * session auth.
 *
 * Field names/status vocabulary (CallSid, CallStatus: queued/ringing/
 * in-progress/completed/busy/failed/no-answer/canceled) are Twilio's
 * stable, documented StatusCallback shape.
 */

const ENGINE_TERMINAL_STATUSES = ["COMPLETED", "AI_UNCERTAIN", "CALLBACK_REQUESTED", "WRONG_NUMBER"];

const STATUS_MAP: Record<string, CallStatus> = {
  queued: "QUEUED",
  initiated: "QUEUED",
  ringing: "RINGING",
  "in-progress": "CONNECTED",
  answered: "CONNECTED",
  completed: "COMPLETED",
  failed: "FAILED",
  busy: "BUSY",
  "no-answer": "NO_ANSWER",
  canceled: "FAILED",
};

const NON_ENGINE_TERMINAL_STATUSES = new Set(["NO_ANSWER", "BUSY", "FAILED"]);

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const expected = process.env.TWILIO_WEBHOOK_SECRET || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Invalid webhook token." }, { status: 401 });
  }
  const callIdParam = searchParams.get("callId");

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid callback body." }, { status: 400 });

  const callSid = String(form.get("CallSid") || "");
  const rawStatus = String(form.get("CallStatus") || "").toLowerCase();
  const mappedStatus = STATUS_MAP[rawStatus];

  if (!mappedStatus) {
    return NextResponse.json({ error: `Unrecognized status: ${rawStatus}` }, { status: 400 });
  }

  const call = callIdParam
    ? await db.call.findUnique({ where: { id: callIdParam } })
    : await db.call.findFirst({ where: { telephonyProviderCallId: callSid } });

  if (!call) return NextResponse.json({ error: "Call not found for this callback." }, { status: 404 });

  if (ENGINE_TERMINAL_STATUSES.includes(call.status)) {
    // Happy path: the audio bridge already finalized this call via
    // advanceCallTurn/persistFinalizedCall. Just backfill endedAt if unset.
    if (mappedStatus === "COMPLETED" && !call.endedAt) {
      await db.call.update({ where: { id: call.id }, data: { endedAt: new Date() } });
    }
    return NextResponse.json({ ok: true });
  }

  if (mappedStatus === "QUEUED" || mappedStatus === "RINGING" || mappedStatus === "CONNECTED") {
    await db.call.update({
      where: { id: call.id },
      data: {
        status: mappedStatus,
        telephonyProviderCallId: call.telephonyProviderCallId || callSid || undefined,
        startedAt: mappedStatus === "CONNECTED" ? call.startedAt ?? new Date() : call.startedAt,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (NON_ENGINE_TERMINAL_STATUSES.has(mappedStatus)) {
    // The engine never ran for this call (no answer / busy / provider
    // failure) — a narrow direct update, deliberately NOT routed through
    // finalizeSession/persistFinalizedCall, since there's no engine session
    // to fold and persistFinalizedCall must stay the only path that can
    // ever create a PromiseToPay.
    await db.$transaction([
      db.call.update({
        where: { id: call.id },
        data: {
          status: mappedStatus,
          endedAt: new Date(),
          summary:
            mappedStatus === "NO_ANSWER"
              ? "Customer ne call receive nahi ki."
              : mappedStatus === "BUSY"
                ? "Customer ka number busy tha."
                : "Call connect nahi ho payi (provider error).",
        },
      }),
      db.staffTask.create({
        data: {
          type: "GENERAL",
          customerId: call.customerId,
          callId: call.id,
          title: `Call ${mappedStatus === "NO_ANSWER" ? "not answered" : mappedStatus === "BUSY" ? "busy" : "failed"} — retry needed`,
          description: "The outbound call did not connect. Please review and consider a retry or manual follow-up.",
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  // mappedStatus === "COMPLETED" but the engine never reached a terminal
  // state (e.g. the customer hung up mid-conversation).
  await db.call.update({
    where: { id: call.id },
    data: {
      status: "AI_UNCERTAIN",
      endedAt: new Date(),
      verificationRequired: true,
      summary: "Call customer dwara beech mein hi kaat di gayi. Staff review zaroori hai.",
    },
  });
  await db.staffTask.create({
    data: {
      type: "AI_UNCERTAIN_REVIEW",
      customerId: call.customerId,
      callId: call.id,
      title: "Call ended before completion — review needed",
      description: "The customer hung up (or the call dropped) before the AI reached a conclusion. Please review the transcript and follow up manually.",
    },
  });
  return NextResponse.json({ ok: true });
}
