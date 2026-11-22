import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** Calls that are ringing / in conversation right now (touched in the last 30 min, so stuck rows don't linger). */
export async function GET() {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const now = Date.now();
  const rows = await db.call.findMany({
    where: { status: { in: ["RINGING", "CONNECTED"] }, updatedAt: { gte: new Date(now - 30 * 60_000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      mode: true,
      language: true,
      startedAt: true,
      createdAt: true,
      customer: { select: { name: true } },
      campaign: { select: { id: true, name: true } },
      transcripts: { orderBy: { sequence: "desc" }, take: 3, select: { speaker: true, text: true, sequence: true } },
    },
  });
  return NextResponse.json({
    now: new Date(now).toISOString(),
    calls: rows.map((c) => ({
      id: c.id,
      status: c.status,
      mode: c.mode,
      language: c.language,
      customer: c.customer.name,
      campaign: c.campaign,
      seconds: Math.max(0, Math.round((now - (c.startedAt ?? c.createdAt).getTime()) / 1000)),
      lines: [...c.transcripts].reverse().map((t) => ({ speaker: t.speaker, text: t.text.slice(0, 240) })),
    })),
  });
}
