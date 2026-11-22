import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { advanceCallTurn, CallAlreadyEndedError, CallNotFoundError } from "@/lib/callEngine/advanceTurn";
import { getSttProvider, getTtsProvider } from "@/lib/providers/registry";
import { resolveBhashiniLanguageCode } from "@/lib/providers/bhashiniPipeline";

type Ctx = { params: Promise<{ id: string }> };

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Voice counterpart to POST /api/calls/[id]/turn — lets a tester speak
 * (mic recording) instead of typing, for the exact same mock-mode call
 * engine. Transcribes via the configured STT provider, feeds the transcript
 * through the identical advanceCallTurn() the text and real-audio-bridge
 * paths already share, then also synthesizes the AI's reply line via TTS so
 * the browser can play it back — the closest in-browser approximation of a
 * real call: you speak, the engine only replies once your turn is fully
 * transcribed (no overlap), and it replies in the customer's own language.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data with an audio file." }, { status: 400 });

  const file = form.get("audio");
  if (!(file instanceof File)) return NextResponse.json({ error: "audio file is required." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: `Audio file too large (max ${MAX_AUDIO_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }

  const call = await db.call.findUnique({ where: { id }, include: { customer: true } });
  if (!call) return NextResponse.json({ error: "Call not found." }, { status: 404 });

  const audioBuffer = Buffer.from(await file.arrayBuffer());
  let transcription;
  try {
    // Without an explicit language hint, Whisper auto-detects — and for
    // Hindi speech it can guess Urdu, transcribing into Urdu (Nastaliq)
    // script that the NLU lexicon (Devanagari/Latin) can't parse, tanking
    // confidence to 0. We already know the customer's language, so tell it,
    // same as the real Twilio bridge does (twilioStreamHandler.ts).
    transcription = await getSttProvider().transcribe(audioBuffer, {
      language: resolveBhashiniLanguageCode(call.customer.preferredLanguage),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed." }, { status: 502 });
  }
  if (!transcription.text.trim()) {
    return NextResponse.json({ error: "STT returned an empty transcript — nothing to send." }, { status: 422 });
  }

  try {
    const result = await advanceCallTurn(id, transcription.text);

    // Speak the AI's line back — result.aiLine is already generated in the
    // customer's own preferredLanguage by the call engine (dialogue.ts), so
    // TTS just needs that same language for voice selection.
    let replyAudioUrl: string | null = null;
    try {
      const tts = await getTtsProvider().synthesize({ text: result.aiLine, language: call.customer.preferredLanguage });
      replyAudioUrl = tts.audioUrl.startsWith("data:audio/mock") ? null : tts.audioUrl;
    } catch {
      replyAudioUrl = null;
    }

    return NextResponse.json({ ...result, transcription, replyAudioUrl });
  } catch (e) {
    if (e instanceof CallNotFoundError) return NextResponse.json({ error: "Call not found." }, { status: 404 });
    if (e instanceof CallAlreadyEndedError) {
      return NextResponse.json({ error: `Call has already ended (status: ${e.status}).` }, { status: 409 });
    }
    throw e;
  }
}
