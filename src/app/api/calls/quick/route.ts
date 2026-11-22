import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { canPlaceCall, getAppSettings } from "@/lib/antiSpam";
import { placeAiCall } from "@/lib/callEngine/placeCall";
import { getTtsProvider } from "@/lib/providers/registry";

const Schema = z.object({
  phoneNumber: z.string().min(6),
  name: z.string().optional(),
  preferredLanguage: z.string().default("hinglish"),
  mode: z.enum(["TEST", "PRODUCTION"]).default("TEST"),
});

/**
 * "Make a Call" quick-start: type a phone number and go, without first
 * creating a full Customer record. Finds an existing customer by that
 * number, or creates a minimal one (outstandingAmount 0 — a real amount can
 * be set later from Customers), then places the call exactly like
 * POST /api/calls does (same placeAiCall/anti-spam path).
 *
 * TEST mode never dials a real number (mock telephony) — this is a
 * simulated/practice call using real STT/TTS/NLU where configured, not an
 * actual ringing phone. Real outbound calling needs a configured (non-mock)
 * TELEPHONY_PROVIDER and PRODUCTION mode, same as everywhere else in the app.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.issues }, { status: 400 });
  }
  const { phoneNumber, name, preferredLanguage, mode } = parsed.data;

  if (mode === "PRODUCTION" && session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Only owner/admin can place production calls." }, { status: 403 });
  }

  let customer = await db.customer.findUnique({ where: { phoneNumber } });
  if (!customer) {
    customer = await db.customer.create({
      data: { name: name?.trim() || phoneNumber, phoneNumber, outstandingAmount: 0, preferredLanguage },
    });
  }

  if (mode === "PRODUCTION") {
    const settings = await getAppSettings();
    if (settings.mode !== "PRODUCTION") {
      return NextResponse.json(
        { error: "Production mode is not activated. Switch it on from Settings first." },
        { status: 403 }
      );
    }
    const gate = await canPlaceCall(customer.id);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: 429 });
    }
  }

  const { call, aiLine } = await placeAiCall(customer.id, { mode, initiatedByUserId: session.sub });

  let greetingAudioUrl: string | null = null;
  try {
    const tts = await getTtsProvider().synthesize({ text: aiLine, language: customer.preferredLanguage });
    greetingAudioUrl = tts.audioUrl.startsWith("data:audio/mock") ? null : tts.audioUrl;
  } catch {
    greetingAudioUrl = null;
  }

  return NextResponse.json({ call, aiLine, greetingAudioUrl, customer, done: false }, { status: 201 });
}
