import { db } from "../db";
import { getAppSettings, canPlaceCall, canSendReminder } from "../antiSpam";
import { placeAiCall } from "../callEngine/placeCall";
import { getWhatsAppProvider, getSmsProvider } from "../providers/registry";
import { buildDueReminderMessage, buildOverdueReminderMessage } from "../notifications/customerMessages";
import { sendOwnerNotification } from "../notifications/provider";
import { formatInr } from "../nlu/extract";
import { formatDateHuman } from "../time";
import { decideCallTiming, loadSlotStats, type SlotStats } from "./bestTime";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  brokenPromises: number;
  remindersSent: number;
  remindersSkipped: number;
  aiCallsPlaced: number;
  aiCallsSkipped: number;
  /** eligible AI calls held back this tick, waiting for a better pick-up hour (useBestCallTime) */
  aiCallsDeferred: number;
}

/**
 * The two automatic-follow-up passes (req 4/6), run every scheduler tick
 * (see src/server/followUpScheduler.ts). Idempotent and safe to re-run —
 * every send is gated (canSendReminder / canPlaceCall) so a customer already
 * contacted recently is simply skipped this cycle, not re-contacted.
 */
export interface SweepOptions {
  /** Test hook: use these pick-up stats instead of reading them from the database. */
  slotStats?: SlotStats;
  /** Restrict the due-follow-up pass to these customers (used by tests; undefined = everyone). */
  customerIds?: string[];
}

export async function runFollowUpSweep(now: Date = new Date(), options: SweepOptions = {}): Promise<SweepResult> {
  const result: SweepResult = { brokenPromises: 0, remindersSent: 0, remindersSkipped: 0, aiCallsPlaced: 0, aiCallsSkipped: 0, aiCallsDeferred: 0 };

  result.brokenPromises = await sweepBrokenPromises(now);
  const dueResult = await sweepDueFollowUps(now, options);
  result.remindersSent = dueResult.remindersSent;
  result.remindersSkipped = dueResult.remindersSkipped;
  result.aiCallsPlaced = dueResult.aiCallsPlaced;
  result.aiCallsSkipped = dueResult.aiCallsSkipped;
  result.aiCallsDeferred = dueResult.aiCallsDeferred;

  return result;
}

/**
 * A promise whose promised date has passed while still ACTIVE is, by
 * definition, broken — cash-collections/route.ts already flips a promise to
 * FULFILLED the moment payment covers it (or outstanding clears), so
 * anything still ACTIVE past its date genuinely wasn't kept.
 */
async function sweepBrokenPromises(now: Date): Promise<number> {
  const overdue = await db.promiseToPay.findMany({
    where: { status: "ACTIVE", promisedDate: { lt: now } },
    include: { customer: true },
  });

  for (const promise of overdue) {
    await db.$transaction(async (tx) => {
      await tx.promiseToPay.update({ where: { id: promise.id }, data: { status: "BROKEN" } });
      await tx.auditLog.create({
        data: {
          entityType: "PromiseToPay",
          entityId: promise.id,
          action: "MARK_BROKEN",
          actorType: "SYSTEM",
          promiseId: promise.id,
          beforeData: { status: "ACTIVE" },
          afterData: { status: "BROKEN" },
          reason: "Promised date passed without payment (automatic sweep).",
        },
      });

      const existingFollowUp = await tx.followUp.findFirst({
        where: { customerId: promise.customerId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (existingFollowUp) {
        await tx.followUp.update({ where: { id: existingFollowUp.id }, data: { scheduledDate: now, reason: "Broken promise follow-up" } });
      } else {
        await tx.followUp.create({
          data: { customerId: promise.customerId, scheduledDate: now, reason: "Broken promise follow-up", status: "PENDING" },
        });
      }

      await tx.staffTask.create({
        data: {
          type: "BROKEN_PROMISE_REVIEW",
          customerId: promise.customerId,
          title: `Broken promise — ${promise.customer.name}`,
          description: `Promised ${formatInr(Number(promise.promisedAmount))} by ${formatDateHuman(promise.promisedDate)} — not received. Automatic follow-up has been rescheduled.`,
        },
      });
    });

    await sendOwnerNotification({
      customerId: promise.customerId,
      title: `Broken Promise — ${promise.customer.name}`,
      body: `${promise.customer.name} promised ${formatInr(Number(promise.promisedAmount))} by ${formatDateHuman(promise.promisedDate)} but it was not received. A follow-up task has been created.`,
    });
  }

  return overdue.length;
}

export async function sweepDueFollowUps(now: Date, options: SweepOptions = {}) {
  const result = { remindersSent: 0, remindersSkipped: 0, aiCallsPlaced: 0, aiCallsSkipped: 0, aiCallsDeferred: 0 };
  const settings = await getAppSettings();
  // Loaded lazily, once per sweep, and only if some call is actually eligible.
  let slotStats: SlotStats | null = options.slotStats ?? null;
  const enabledChannels = settings.reminderChannelsEnabled
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const primaryChannel: "WHATSAPP" | "SMS" | null = enabledChannels.includes("whatsapp")
    ? "WHATSAPP"
    : enabledChannels.includes("sms")
      ? "SMS"
      : null;

  const windowEnd = new Date(now.getTime() + settings.daysBeforeDueForFirstReminder * DAY_MS);
  const candidates = await db.followUp.findMany({
    where: {
      status: "PENDING",
      scheduledDate: { lte: windowEnd },
      ...(options.customerIds ? { customerId: { in: options.customerIds } } : {}),
    },
    include: { customer: true, order: true },
    orderBy: { scheduledDate: "asc" },
    take: 200,
  });

  for (const followUp of candidates) {
    if (followUp.attemptCount >= followUp.maxAttempts) continue;

    const amount = followUp.order
      ? Number(followUp.order.totalAmount) - Number(followUp.order.paidAmount)
      : Number(followUp.customer.outstandingAmount);
    if (amount <= 0) {
      // Nothing left to chase — this FollowUp is stale (e.g. paid through a
      // path that didn't already close it out). Close it instead of looping.
      await db.followUp.update({ where: { id: followUp.id }, data: { status: "COMPLETED" } });
      continue;
    }

    const daysOverdue = Math.floor((now.getTime() - followUp.scheduledDate.getTime()) / DAY_MS);

    // Cost control: below minOutstandingForAiCall, never escalate to the
    // (most expensive) AI voice call — keep sending WhatsApp/SMS reminders
    // instead, even once daysOverdueBeforeAiCall would otherwise trigger a call.
    const eligibleForAiCall = daysOverdue >= settings.daysOverdueBeforeAiCall && amount >= Number(settings.minOutstandingForAiCall);

    if (eligibleForAiCall) {
      if (settings.useBestCallTime) {
        slotStats ??= await loadSlotStats(settings.mode);
        const timing = decideCallTiming({
          now,
          eligibleAt: new Date(followUp.scheduledDate.getTime() + settings.daysOverdueBeforeAiCall * DAY_MS),
          maxDeferHours: settings.bestCallMaxDeferHours,
          quietStart: settings.quietHoursStart,
          quietEnd: settings.quietHoursEnd,
          stats: slotStats,
        });
        if (timing.action === "defer") {
          // Stays PENDING; re-evaluated next tick. attemptCount is NOT bumped — nothing was attempted.
          result.aiCallsDeferred++;
          continue;
        }
      }
      const gate = await canPlaceCall(followUp.customerId, now);
      if (!gate.allowed) {
        result.aiCallsSkipped++;
        continue;
      }
      await placeAiCall(followUp.customerId, { mode: settings.mode, initiatedByUserId: null });
      result.aiCallsPlaced++;
      continue;
    }

    if (!primaryChannel) {
      result.remindersSkipped++;
      continue;
    }
    const gate = await canSendReminder(followUp.customerId, primaryChannel, now);
    if (!gate.allowed) {
      result.remindersSkipped++;
      continue;
    }

    const kind = daysOverdue < 0 ? "DUE_REMINDER" : "OVERDUE_REMINDER";
    const body =
      daysOverdue < 0
        ? buildDueReminderMessage(settings.businessName, followUp.customer.name, amount, followUp.scheduledDate)
        : buildOverdueReminderMessage(settings.businessName, followUp.customer.name, amount, followUp.scheduledDate);
    const toNumber = followUp.customer.whatsappNumber || followUp.customer.phoneNumber;
    const provider = primaryChannel === "WHATSAPP" ? getWhatsAppProvider() : getSmsProvider();
    const send = await provider.sendMessage({ toPhoneNumber: toNumber, body });

    await db.reminderLog.create({
      data: {
        customerId: followUp.customerId,
        followUpId: followUp.id,
        orderId: followUp.orderId,
        channel: primaryChannel,
        kind,
        status: send.status === "failed" ? "FAILED" : "SENT",
        body,
        providerMessageId: send.providerMessageId,
        sentAt: send.status === "failed" ? null : now,
      },
    });
    // Shared cap across WhatsApp + SMS + AI-call — placeAiCall() increments
    // this same counter for the AI-call branch above, so it's only bumped
    // once per contact attempt regardless of channel.
    await db.followUp.update({ where: { id: followUp.id }, data: { attemptCount: { increment: 1 } } });
    result.remindersSent++;
  }

  return result;
}
