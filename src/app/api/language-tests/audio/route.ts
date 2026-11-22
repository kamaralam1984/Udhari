import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { getSttProvider } from "@/lib/providers/registry";
import { extractUtterance } from "@/lib/nlu/extract";
import { buildPreviewReplyWithAudio, styleToDialogueKey } from "@/lib/callEngine/previewReply";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15MB — generous for a short spoken sample

/**
 * Audio-upload counterpart to POST /api/language-tests (which takes typed
 * text). Runs the uploaded recording through the configured STT provider
 * (mock by default — see src/lib/providers/stt/mock.ts's honest-failure
 * behavior on real audio bytes; genuinely transcribes once a real vendor
 * like Bhashini is configured), then feeds the resulting transcript through
 * the exact same NLU pipeline as the text flow, and saves a LanguageTest row
 * so it goes through the same staff PASS/FAIL review loop.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data with an audio file." }, { status: 400 });

  const file = form.get("audio");
  if (!(file instanceof File)) return NextResponse.json({ error: "audio file is required." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: `Audio file too large (max ${MAX_AUDIO_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }

  const outstandingRaw = form.get("outstandingAmount");
  const outstandingAmount = typeof outstandingRaw === "string" && outstandingRaw.trim() ? parseFloat(outstandingRaw) : null;

  const audioBuffer = Buffer.from(await file.arrayBuffer());

  let transcription;
  try {
    transcription = await getSttProvider().transcribe(audioBuffer);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed." }, { status: 502 });
  }

  const result = extractUtterance(transcription.text, { outstandingAmount });
  const aiReply = await buildPreviewReplyWithAudio(result, styleToDialogueKey(result.language.style));

  const test = await db.languageTest.create({
    data: {
      inputText: transcription.text,
      simulatedTranscript: transcription.text,
      detectedLanguage: result.language.label,
      extractedAmount: result.amount.amount,
      extractedDate: result.date.date,
      extractedIntent: result.intent.intent,
      confidence: transcription.confidence < result.overallConfidence ? transcription.confidence : result.overallConfidence,
      aiInterpretation: result.aiInterpretation,
      verdict: "UNREVIEWED",
      createdById: session.sub,
    },
  });

  return NextResponse.json({ test, result, transcription, aiReply }, { status: 201 });
}
