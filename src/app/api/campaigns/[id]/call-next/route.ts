import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { canPlaceCall, getAppSettings } from "@/lib/antiSpam";
import { placeAiCall } from "@/lib/callEngine/placeCall";

export const dynamic = "force-dynamic";

const Schema = z.object({ mode: z.enum(["TEST", "PRODUCTION"]).default("TEST") });

/**
 * Calls the next campaign member who has not been called yet — one call per
 * click, so a human stays in control of pacing. PRODUCTION mode applies the
 * same role / mode / anti-spam gates as POST /api/calls.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await ctx.params;
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { mode } = parsed.data;

  const campaign = await db.campaign.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "ACTIVE") {
    return NextResponse.json({ error: "Campaign Active nahi hai — pehle Start karo." }, { status: 409 });
  }

  if (mode === "PRODUCTION") {
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owner/admin can place production calls." }, { status: 403 });
    }
    if ((await getAppSettings()).mode !== "PRODUCTION") {
      return NextResponse.json({ error: "Production mode is not activated. Switch it on from Settings first." }, { status: 403 });
    }
  }

  // Skip members who are on Do-Not-Call now, or already called in this campaign.
  const next = await db.campaignMember.findFirst({
    where: {
      campaignId: id,
      customer: { doNotCall: false },
      NOT: { customer: { calls: { some: { campaignId: id } } } },
    },
    orderBy: { addedAt: "asc" },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!next) return NextResponse.json({ done: true, message: "Sabhi members ko call ho chuki hai." });

  if (mode === "PRODUCTION") {
    const gate = await canPlaceCall(next.customerId);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message, reason: gate.reason, customer: next.customer.name }, { status: 429 });
    }
  }

  const { call, aiLine } = await placeAiCall(next.customerId, { mode, initiatedByUserId: session.sub, campaignId: id });
  return NextResponse.json({ done: false, call, aiLine, customer: next.customer }, { status: 201 });
}
