import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { canPlaceCall, getAppSettings } from "@/lib/antiSpam";
import { placeAiCall } from "@/lib/callEngine/placeCall";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const mode = searchParams.get("mode") || undefined;
  const customerId = searchParams.get("customerId") || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const PAGE_SIZE = 50;

  const rows = await db.call.findMany({
    where: {
      status: status ? (status as never) : undefined,
      mode: mode ? (mode as never) : undefined,
      customerId: customerId || undefined,
    },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const calls = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({ calls, hasMore });
}

const CreateCallSchema = z.object({
  customerId: z.string().min(1),
  mode: z.enum(["TEST", "PRODUCTION"]).default("TEST"),
  campaignId: z.string().min(1).optional(),
});

/**
 * Starts a new call session. TEST mode always uses the mock telephony
 * provider and skips the anti-spam gate (it never contacts the real
 * customer). PRODUCTION mode requires OWNER/ADMIN, requires AppSettings to
 * be explicitly switched to PRODUCTION, and must pass the anti-spam gate.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.issues }, { status: 400 });
  }
  const { customerId, mode, campaignId } = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  if (mode === "PRODUCTION") {
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owner/admin can place production calls." }, { status: 403 });
    }
    const settings = await getAppSettings();
    if (settings.mode !== "PRODUCTION") {
      return NextResponse.json(
        { error: "Production mode is not activated. Switch it on from Settings first." },
        { status: 403 }
      );
    }
    const gate = await canPlaceCall(customerId);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: 429 });
    }
  }

  const { call, aiLine } = await placeAiCall(customerId, { mode, initiatedByUserId: session.sub, campaignId });

  return NextResponse.json({ call, aiLine, done: false }, { status: 201 });
}
