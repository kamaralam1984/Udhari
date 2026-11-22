import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { extractUtterance } from "@/lib/nlu/extract";
import { buildPreviewReplyWithAudio, styleToDialogueKey } from "@/lib/callEngine/previewReply";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const verdict = searchParams.get("verdict") || undefined;

  const tests = await db.languageTest.findMany({
    where: { verdict: verdict ? (verdict as never) : undefined },
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ tests });
}

const Schema = z.object({
  inputText: z.string().min(1),
  outstandingAmount: z.number().nonnegative().optional(),
});

/**
 * Runs a sample sentence through the same NLU pipeline the call engine uses,
 * and stores the result for the owner/admin to mark PASS/FAIL/NEEDS_REVIEW.
 * This is how real Magahi (Begusarai) / Bhojpuri call samples grow the
 * lexicon over time instead of the system silently claiming perfect dialect
 * coverage.
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
  if (!parsed.success) return NextResponse.json({ error: "inputText is required." }, { status: 400 });

  const result = extractUtterance(parsed.data.inputText, { outstandingAmount: parsed.data.outstandingAmount ?? null });
  const aiReply = await buildPreviewReplyWithAudio(result, styleToDialogueKey(result.language.style));

  const test = await db.languageTest.create({
    data: {
      inputText: parsed.data.inputText,
      detectedLanguage: result.language.label,
      extractedAmount: result.amount.amount,
      extractedDate: result.date.date,
      extractedIntent: result.intent.intent,
      confidence: result.overallConfidence,
      aiInterpretation: result.aiInterpretation,
      verdict: "UNREVIEWED",
      createdById: session.sub,
    },
  });

  return NextResponse.json({ test, result, aiReply }, { status: 201 });
}
