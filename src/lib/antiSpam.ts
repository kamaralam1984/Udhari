import { db } from "./db";
import { isWithinQuietHours, startOfDayInAppTz } from "./time";

export type CallBlockReason =
  | "DO_NOT_CALL"
  | "QUIET_HOURS"
  | "MIN_GAP_NOT_ELAPSED"
  | "MAX_ATTEMPTS_PER_DAY"
  | "MAX_ATTEMPTS_PER_PROMISE";

export interface CallGateResult {
  allowed: boolean;
  reason?: CallBlockReason;
  message?: string;
}

export type ReminderBlockReason = "DO_NOT_CALL" | "QUIET_HOURS" | "MIN_GAP_NOT_ELAPSED";

export interface ReminderGateResult {
  allowed: boolean;
  reason?: ReminderBlockReason;
  message?: string;
}

export async function getAppSettings() {
  const existing = await db.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return db.appSettings.create({
    data: {
      id: "singleton",
      mode: (process.env.APP_MODE as "TEST" | "PRODUCTION") || "TEST",
      businessName: process.env.BUSINESS_NAME || "Your Business",
      businessTagline: process.env.BUSINESS_TAGLINE || undefined,
      minGapHoursBetweenCalls: parseInt(process.env.ANTI_SPAM_MIN_GAP_HOURS || "24", 10),
      maxAttemptsPerDay: parseInt(process.env.ANTI_SPAM_MAX_ATTEMPTS_PER_DAY || "1", 10),
      maxAttemptsPerPromise: parseInt(process.env.ANTI_SPAM_MAX_ATTEMPTS_PER_PROMISE || "3", 10),
      quietHoursStart: parseInt(process.env.ANTI_SPAM_QUIET_HOURS_START || "21", 10),
      quietHoursEnd: parseInt(process.env.ANTI_SPAM_QUIET_HOURS_END || "9", 10),
      timezone: process.env.TIMEZONE || "Asia/Kolkata",
    },
  });
}

/**
 * The single gate every call-creation path must pass through. Enforces
 * DO_NOT_CALL, quiet hours, minimum gap between calls, max attempts/day, and
 * max attempts against an open follow-up/promise.
 */
export async function canPlaceCall(customerId: string, now: Date = new Date()): Promise<CallGateResult> {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { allowed: false, message: "Customer not found." };

  if (customer.doNotCall) {
    return { allowed: false, reason: "DO_NOT_CALL", message: "Customer has opted out of calls (DO_NOT_CALL)." };
  }

  const settings = await getAppSettings();

  if (isWithinQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd)) {
    return {
      allowed: false,
      reason: "QUIET_HOURS",
      message: `Calls are not allowed between ${settings.quietHoursStart}:00 and ${settings.quietHoursEnd}:00.`,
    };
  }

  const lastCall = await db.call.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  if (lastCall) {
    const hoursSince = (now.getTime() - lastCall.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < settings.minGapHoursBetweenCalls) {
      return {
        allowed: false,
        reason: "MIN_GAP_NOT_ELAPSED",
        message: `Minimum gap of ${settings.minGapHoursBetweenCalls}h between calls not yet elapsed.`,
      };
    }
  }

  const todayStart = startOfDayInAppTz(now);
  const callsToday = await db.call.count({
    where: { customerId, createdAt: { gte: todayStart } },
  });
  if (callsToday >= settings.maxAttemptsPerDay) {
    return {
      allowed: false,
      reason: "MAX_ATTEMPTS_PER_DAY",
      message: `Maximum of ${settings.maxAttemptsPerDay} attempt(s) per day already reached.`,
    };
  }

  const openFollowUp = await db.followUp.findFirst({
    where: { customerId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (openFollowUp && openFollowUp.attemptCount >= openFollowUp.maxAttempts) {
    return {
      allowed: false,
      reason: "MAX_ATTEMPTS_PER_PROMISE",
      message: `Maximum of ${openFollowUp.maxAttempts} attempt(s) for this follow-up already reached.`,
    };
  }

  return { allowed: true };
}

/**
 * The equivalent gate for customer-facing WhatsApp/SMS reminders (not AI
 * calls — canPlaceCall stays the gate for those, unchanged). Checked by
 * runFollowUpSweep() before every reminder send. Uses ReminderLog (not
 * Notification, which is owner-only) to find the last time this channel
 * contacted this customer.
 */
export async function canSendReminder(
  customerId: string,
  channel: "WHATSAPP" | "SMS",
  now: Date = new Date()
): Promise<ReminderGateResult> {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { allowed: false, message: "Customer not found." };

  if (customer.doNotCall) {
    return { allowed: false, reason: "DO_NOT_CALL", message: "Customer has opted out of contact (DO_NOT_CALL)." };
  }

  const settings = await getAppSettings();

  if (isWithinQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd)) {
    return {
      allowed: false,
      reason: "QUIET_HOURS",
      message: `Reminders are not allowed between ${settings.quietHoursStart}:00 and ${settings.quietHoursEnd}:00.`,
    };
  }

  const lastReminder = await db.reminderLog.findFirst({
    where: { customerId, channel },
    orderBy: { createdAt: "desc" },
  });
  if (lastReminder) {
    const hoursSince = (now.getTime() - lastReminder.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < settings.minGapHoursBetweenReminders) {
      return {
        allowed: false,
        reason: "MIN_GAP_NOT_ELAPSED",
        message: `Minimum gap of ${settings.minGapHoursBetweenReminders}h between ${channel} reminders not yet elapsed.`,
      };
    }
  }

  return { allowed: true };
}
