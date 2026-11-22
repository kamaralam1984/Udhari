import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { advanceCallTurn, CallAlreadyEndedError, CallNotFoundError } from "@/lib/callEngine/advanceTurn";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({ text: z.string().min(1) });

/**
 * Advances a mock-mode call by one customer turn. In mock mode `text` is
 * what a tester typed standing in for an STT transcript; a real telephony
 * integration calls advanceCallTurn() directly from the audio bridge after
 * STT instead of typed input — the conversation logic does not know or care
 * which one produced the text.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "A non-empty 'text' field is required." }, { status: 400 });

  try {
    const result = await advanceCallTurn(id, parsed.data.text);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CallNotFoundError) return NextResponse.json({ error: "Call not found." }, { status: 404 });
    if (e instanceof CallAlreadyEndedError) {
      return NextResponse.json({ error: `Call has already ended (status: ${e.status}).` }, { status: 409 });
    }
    throw e;
  }
}
