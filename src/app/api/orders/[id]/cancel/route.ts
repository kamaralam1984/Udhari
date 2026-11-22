import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Cancels an order and reverses the outstanding credit it added — a higher
 * bar than creating/collecting against one, since it undoes a financial
 * record rather than adding to it (mirrors the PRODUCTION-mode-switch and
 * settings-mode-change patterns elsewhere: owner/admin only).
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const before = await db.order.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (before.status === "CANCELLED") {
    return NextResponse.json({ error: "Order is already cancelled." }, { status: 400 });
  }

  const remainingCredit = Math.max(0, Number(before.totalAmount) - Number(before.paidAmount));

  const order = await db.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });

    if (remainingCredit > 0) {
      const customer = await tx.customer.findUnique({ where: { id: before.customerId } });
      const newOutstanding = Math.max(0, Number(customer!.outstandingAmount) - remainingCredit);
      await tx.customer.update({ where: { id: before.customerId }, data: { outstandingAmount: newOutstanding } });
    }

    await tx.followUp.updateMany({ where: { orderId: id, status: "PENDING" }, data: { status: "CANCELLED" } });

    await tx.auditLog.create({
      data: {
        entityType: "Order",
        entityId: id,
        action: "CANCEL",
        actorType: "STAFF",
        actorUserId: session.sub,
        beforeData: { status: before.status },
        afterData: { status: "CANCELLED", reversedCredit: remainingCredit },
      },
    });

    return updated;
  });

  return NextResponse.json({ order });
}
