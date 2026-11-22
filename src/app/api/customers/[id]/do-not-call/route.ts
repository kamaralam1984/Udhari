import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  doNotCall: z.boolean(),
  reason: z.string().optional(),
});

/**
 * Only authorized staff can change DO_NOT_CALL — the AI itself can never
 * flip this flag on its own (it can only be a signal surfaced from a call
 * for a human to act on, via a StaffTask/notification, not a direct write).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN", "STAFF"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

  const before = await db.customer.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const customer = await db.customer.update({
    where: { id },
    data: {
      doNotCall: parsed.data.doNotCall,
      doNotCallReason: parsed.data.doNotCall ? parsed.data.reason ?? "Customer requested no further calls." : null,
      doNotCallSetAt: parsed.data.doNotCall ? new Date() : null,
    },
  });

  await db.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: id,
      action: "UPDATE",
      actorType: "STAFF",
      actorUserId: session.sub,
      beforeData: { doNotCall: before.doNotCall },
      afterData: { doNotCall: customer.doNotCall, reason: customer.doNotCallReason },
    },
  });

  return NextResponse.json({ customer });
}
