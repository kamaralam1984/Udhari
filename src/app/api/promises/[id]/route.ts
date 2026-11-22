import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  status: z.enum(["ACTIVE", "FULFILLED", "BROKEN", "SUPERSEDED", "CANCELLED"]),
  note: z.string().optional(),
});

/**
 * Staff-only status transitions. This never touches Customer.outstandingAmount
 * or creates any kind of payment record — marking a promise FULFILLED is a
 * bookkeeping note for follow-up tracking, not a financial transaction. Real
 * payment recording stays outside this MVP's scope, done by staff elsewhere.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
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

  const before = await db.promiseToPay.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await db.promiseToPay.update({ where: { id }, data: { status: parsed.data.status } });

  const actionMap = {
    FULFILLED: "MARK_FULFILLED",
    BROKEN: "MARK_BROKEN",
  } as const;

  await db.auditLog.create({
    data: {
      entityType: "PromiseToPay",
      entityId: id,
      action: (actionMap as Record<string, "MARK_FULFILLED" | "MARK_BROKEN">)[parsed.data.status] ?? "UPDATE",
      actorType: "STAFF",
      actorUserId: session.sub,
      beforeData: { status: before.status },
      afterData: { status: updated.status },
      reason: parsed.data.note,
      promiseId: id,
    },
  });

  return NextResponse.json({ promise: updated });
}
