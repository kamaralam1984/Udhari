import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { getTtsProvider } from "@/lib/providers/registry";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Synthesizes (or re-synthesizes) audio for a call's opening AI greeting —
 * used by the call detail page to auto-play the greeting on load/refresh,
 * since POST /api/calls/quick only returns it once, transiently, at
 * creation time. Only makes sense before the customer has said anything.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const call = await db.call.findUnique({ where: { id }, include: { customer: true } });
  if (!call) return NextResponse.json({ error: "Call not found." }, { status: 404 });

  const firstTranscript = await db.callTranscript.findFirst({ where: { callId: id }, orderBy: { sequence: "asc" } });
  if (!firstTranscript || firstTranscript.speaker !== "AI") {
    return NextResponse.json({ error: "No greeting found for this call." }, { status: 404 });
  }

  try {
    const tts = await getTtsProvider().synthesize({ text: firstTranscript.text, language: call.customer.preferredLanguage });
    const audioUrl = tts.audioUrl.startsWith("data:audio/mock") ? null : tts.audioUrl;
    return NextResponse.json({ audioUrl, text: firstTranscript.text });
  } catch {
    return NextResponse.json({ audioUrl: null, text: firstTranscript.text });
  }
}
