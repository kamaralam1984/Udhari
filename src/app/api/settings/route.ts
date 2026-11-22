import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { getAppSettings } from "@/lib/antiSpam";
import { getProviderNames, getCustomVoiceConfig } from "@/lib/providers/registry";

export async function GET() {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const settings = await getAppSettings();
  const customVoice = getCustomVoiceConfig();
  return NextResponse.json({
    settings,
    providers: getProviderNames(),
    customVoiceConsentOnFile: customVoice.consentOnFile,
  });
}

const Schema = z.object({
  mode: z.enum(["TEST", "PRODUCTION"]).optional(),
  businessName: z.string().min(1).max(120).optional(),
  businessTagline: z.string().max(160).nullable().optional(),
  businessPhone: z.string().max(20).nullable().optional(),
  minGapHoursBetweenCalls: z.number().int().min(1).optional(),
  maxAttemptsPerDay: z.number().int().min(1).optional(),
  maxAttemptsPerPromise: z.number().int().min(1).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  minGapHoursBetweenReminders: z.number().int().min(1).optional(),
  daysBeforeDueForFirstReminder: z.number().int().min(0).optional(),
  daysOverdueBeforeAiCall: z.number().int().min(0).optional(),
  reminderChannelsEnabled: z.string().max(60).optional(),
  minOutstandingForAiCall: z.number().nonnegative().optional(),
  alertMinSuccessRate: z.number().int().min(0).max(100).optional(),
  alertMaxBrokenPromises: z.number().int().min(0).optional(),
  dailyCostLimit: z.number().nonnegative().optional(),
  dailyReportEnabled: z.boolean().optional(),
  dailyReportHour: z.number().int().min(0).max(23).optional(),
  useBestCallTime: z.boolean().optional(),
  bestCallMaxDeferHours: z.number().int().min(1).max(72).optional(),
});

/**
 * Only OWNER can flip TEST <-> PRODUCTION — "production mode must require
 * explicit activation" from the spec. Any other field can be adjusted by
 * OWNER/ADMIN.
 */
export async function PATCH(req: NextRequest) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings." }, { status: 400 });

  if (parsed.data.mode === "PRODUCTION" && session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can activate PRODUCTION mode." }, { status: 403 });
  }

  await getAppSettings(); // ensure row exists
  const settings = await db.appSettings.update({ where: { id: "singleton" }, data: parsed.data });
  return NextResponse.json({ settings });
}
