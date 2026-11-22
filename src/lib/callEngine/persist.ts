import { db } from "../db";
import { buildUsageLogs } from "../cost";
import { buildOwnerReportText } from "../notifications/ownerReport";
import { sendOwnerNotification } from "../notifications/provider";
import type { FinalizedCallResult } from "./finalize";

/**
 * Writes a finished call to the database. This is the ONLY place allowed to
 * turn AI output into financial records, and it enforces the hard rule from
 * the spec: an ALREADY_PAID / verificationRequired result NEVER creates a
 * PromiseToPay or touches Customer.outstandingAmount — it only creates a
 * PAYMENT_VERIFICATION_REQUIRED staff task. There is no Payment model at all,
 * so the AI has no table it could misuse to record money received.
 */
export async function persistFinalizedCall(callId: string, result: FinalizedCallResult) {
  const { extraction, transcript, raw } = result;

  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { customer: true } });

  const startedAt = call.startedAt ?? new Date(transcript[0]?.timestamp ?? Date.now());
  const endedAt = new Date(transcript[transcript.length - 1]?.timestamp ?? Date.now());
  const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  const ttsCharacters = transcript.filter((t) => t.speaker === "AI").reduce((sum, t) => sum + t.text.length, 0);
  const llmTokens = Math.ceil(ttsCharacters / 4);

  await db.$transaction(async (tx) => {
    // Idempotent: API routes persist each turn as it happens, so by the time
    // a call finalizes most/all rows already exist. Direct engine callers
    // (tests, scripts) that never wrote incrementally get the full transcript
    // written here in one shot. Either way no row is ever duplicated.
    await tx.callTranscript.createMany({
      data: transcript.map((t, idx) => ({
        callId,
        sequence: idx + 1,
        speaker: t.speaker,
        text: t.text,
        timestamp: new Date(t.timestamp),
      })),
      skipDuplicates: true,
    });

    await tx.call.update({
      where: { id: callId },
      data: {
        status: extraction.callStatus,
        startedAt,
        endedAt,
        duration: durationSeconds,
        transcriptText: transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n"),
        summary: extraction.summary,
        customerResponse: extraction.customerResponse,
        promisedAmount: extraction.promisedAmount,
        promisedDate: extraction.promisedDate ? new Date(extraction.promisedDate) : null,
        paymentIntent: extraction.paymentIntent,
        confidence: extraction.confidence,
        nextFollowUpDate: extraction.nextFollowUpDate ? new Date(extraction.nextFollowUpDate) : null,
        verificationRequired: extraction.verificationRequired,
      },
    });

    const ownerReportText = buildOwnerReportText(
      {
        customerName: call.customer.name,
        outstandingAmount: Number(call.customer.outstandingAmount),
        callStatusLabel: extraction.callStatus,
        customerResponseQuote: extraction.customerResponse || null,
      },
      extraction
    );

    await tx.callSummary.create({
      data: { callId, summaryText: extraction.summary, ownerNotificationText: ownerReportText },
    });

    // Hard safety gate: a promise can only be created when the customer
    // explicitly confirmed both amount and date, and intent is a genuine
    // payment commitment — never for ALREADY_PAID / REFUSED / etc.
    const isConfirmedPromise =
      raw.collected.confirmedByCustomer &&
      extraction.promisedAmount !== null &&
      extraction.promisedDate !== null &&
      (extraction.paymentIntent === "WILL_PAY" || extraction.paymentIntent === "PARTIAL_PAY");

    if (isConfirmedPromise) {
      const promise = await tx.promiseToPay.create({
        data: {
          callId,
          customerId: call.customerId,
          promisedAmount: extraction.promisedAmount!,
          promisedDate: new Date(extraction.promisedDate!),
          remainingAmount: extraction.remainderAmount,
          remainingDueDate: extraction.remainderDate ? new Date(extraction.remainderDate) : null,
          paymentIntent: extraction.paymentIntent,
          confidence: extraction.confidence,
          confirmedByCustomer: true,
          status: "ACTIVE",
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PromiseToPay",
          entityId: promise.id,
          action: "CREATE",
          actorType: "AI",
          afterData: JSON.parse(JSON.stringify(promise, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
          promiseId: promise.id,
        },
      });

      await tx.customer.update({
        where: { id: call.customerId },
        data: { lastPromiseDate: promise.promisedDate, lastPromiseAmount: promise.promisedAmount },
      });

      // Finally populates FollowUp (see src/lib/antiSpam.ts's canPlaceCall,
      // which already reads it) so the confirmed promise date drives future
      // automated follow-up — renew an existing open one for this customer
      // rather than stacking duplicates.
      const existingFollowUp = await tx.followUp.findFirst({
        where: { customerId: call.customerId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (existingFollowUp) {
        await tx.followUp.update({
          where: { id: existingFollowUp.id },
          data: { scheduledDate: promise.promisedDate, reason: "AI call promise" },
        });
      } else {
        await tx.followUp.create({
          data: { customerId: call.customerId, scheduledDate: promise.promisedDate, reason: "AI call promise", status: "PENDING" },
        });
      }

      // Partial payment: the customer said money is still coming after this
      // promise ("baaki kab doge") — schedule a SEPARATE follow-up for the
      // remainder date, so it isn't lost once the first installment's
      // follow-up above gets completed/renewed.
      if (promise.remainingAmount !== null && promise.remainingDueDate) {
        const existingRemainderFollowUp = await tx.followUp.findFirst({
          where: { customerId: call.customerId, status: "PENDING", reason: "AI call promise — remaining balance" },
          orderBy: { createdAt: "desc" },
        });
        if (existingRemainderFollowUp) {
          await tx.followUp.update({
            where: { id: existingRemainderFollowUp.id },
            data: { scheduledDate: promise.remainingDueDate },
          });
        } else {
          await tx.followUp.create({
            data: {
              customerId: call.customerId,
              scheduledDate: promise.remainingDueDate,
              reason: "AI call promise — remaining balance",
              status: "PENDING",
            },
          });
        }
      }
    }

    if (extraction.verificationRequired) {
      const isAlreadyPaidClaim = extraction.paymentIntent === "ALREADY_PAID";
      await tx.staffTask.create({
        data: {
          type: isAlreadyPaidClaim ? "PAYMENT_VERIFICATION_REQUIRED" : "AI_UNCERTAIN_REVIEW",
          customerId: call.customerId,
          callId,
          title: isAlreadyPaidClaim
            ? `Verify payment claim — ${call.customer.name}`
            : `AI uncertain — review call with ${call.customer.name}`,
          description: isAlreadyPaidClaim
            ? `Customer statement: "${raw.paymentVerificationStatement ?? extraction.customerResponse}". ` +
              `AI never marks payments as received — please verify with the customer/records and record the ` +
              `payment manually if confirmed.`
            : `AI could not confidently extract a promise from this call after one clarification attempt. ` +
              `Please review the transcript and follow up manually.`,
        },
      });
    }

    if (extraction.callbackRequested) {
      await tx.staffTask.create({
        data: {
          type: "CALLBACK_REQUEST",
          customerId: call.customerId,
          callId,
          title: `Callback requested — ${call.customer.name}`,
          description: "Customer asked to be contacted again later (or a de-escalated angry call). Please follow up personally.",
        },
      });
    }

    if (extraction.callStatus === "WRONG_NUMBER") {
      await tx.staffTask.create({
        data: {
          type: "WRONG_NUMBER_REVIEW",
          customerId: call.customerId,
          callId,
          title: `Phone number may be wrong — ${call.customer.name}`,
          description: "The person who answered indicated this is not the right number/person. Please verify and correct the customer record.",
        },
      });
    }

    const usageLogs = buildUsageLogs({
      durationSeconds,
      ttsCharacters,
      llmTokens,
      usedCustomVoice: process.env.CUSTOM_VOICE_PROVIDER !== "none" && !!process.env.CUSTOM_VOICE_PROVIDER,
    });
    await tx.callUsageLog.createMany({
      data: usageLogs.map((l) => ({ ...l, callId })),
    });
  });

  const finalCall = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { customer: true } });
  const summary = await db.callSummary.findUnique({ where: { callId } });
  if (summary) {
    await sendOwnerNotification({
      customerId: finalCall.customerId,
      callId,
      title: `AI Call Report — ${finalCall.customer.name}`,
      body: summary.ownerNotificationText,
    });
  }

  return finalCall;
}
