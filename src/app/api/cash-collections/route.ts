import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { getAppSettings } from "@/lib/antiSpam";
import { getWhatsAppProvider } from "@/lib/providers/registry";
import { buildPaymentReceiptMessage } from "@/lib/notifications/customerMessages";

// The only staff-writable path (alongside Order's paidNow) that reduces
// Customer.outstandingAmount — src/lib/callEngine/* and
// src/server/twilioStreamHandler.ts must never import this module. The AI
// can never mark a payment as received; only authorized staff can, and every
// write here is audited (see the auditLog.create call below).

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId") || undefined;
  const orderId = searchParams.get("orderId") || undefined;
  const collectedById = searchParams.get("collectedById") || undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const collections = await db.cashCollection.findMany({
    where: {
      customerId: customerId || undefined,
      orderId: orderId || undefined,
      collectedById: collectedById || undefined,
      collectedAt: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
    },
    include: { customer: true, order: true, collectedBy: true },
    orderBy: { collectedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ collections });
}

const CreateCashCollectionSchema = z.object({
  customerId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  amount: z.number().positive(),
  note: z.string().optional(),
  promiseId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN", "STAFF"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateCashCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data.", details: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  if (data.orderId) {
    const order = await db.order.findUnique({ where: { id: data.orderId } });
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.customerId !== data.customerId) {
      return NextResponse.json({ error: "Order does not belong to this customer." }, { status: 400 });
    }
  }

  const ccId = randomUUID();
  const receiptNumber = `RCP-${ccId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  let outstandingAfterPayment = Number(customer.outstandingAmount);

  const collection = await db.$transaction(async (tx) => {
    const created = await tx.cashCollection.create({
      data: {
        id: ccId,
        receiptNumber,
        customerId: data.customerId,
        orderId: data.orderId,
        amount: data.amount,
        collectedById: session.sub,
        note: data.note,
        promiseId: data.promiseId,
      },
    });

    const newOutstanding = Math.max(0, Number(customer.outstandingAmount) - data.amount);
    outstandingAfterPayment = newOutstanding;
    await tx.customer.update({
      where: { id: data.customerId },
      data: { outstandingAmount: newOutstanding, lastPaymentDate: new Date() },
    });

    if (data.orderId) {
      const order = await tx.order.findUnique({ where: { id: data.orderId } });
      const newPaid = Number(order!.paidAmount) + data.amount;
      const newStatus = newPaid >= Number(order!.totalAmount) ? "PAID" : "OPEN";
      await tx.order.update({ where: { id: data.orderId }, data: { paidAmount: newPaid, status: newStatus } });
      if (newStatus === "PAID") {
        await tx.followUp.updateMany({ where: { orderId: data.orderId, status: "PENDING" }, data: { status: "COMPLETED" } });
      }
    }

    // Outstanding fully cleared — stop chasing this customer and close any
    // open promise. A partial payment leaves pending follow-ups as-is, since
    // the original promised amount/date isn't necessarily fulfilled yet.
    if (newOutstanding === 0) {
      await tx.followUp.updateMany({ where: { customerId: data.customerId, status: "PENDING" }, data: { status: "COMPLETED" } });
      await tx.promiseToPay.updateMany({ where: { customerId: data.customerId, status: "ACTIVE" }, data: { status: "FULFILLED" } });
    } else if (data.promiseId) {
      await tx.promiseToPay.update({ where: { id: data.promiseId }, data: { status: "FULFILLED" } });
    }

    await tx.auditLog.create({
      data: {
        entityType: "CashCollection",
        entityId: created.id,
        action: "RECORD_PAYMENT",
        actorType: "STAFF",
        actorUserId: session.sub,
        afterData: { amount: data.amount, customerId: data.customerId, orderId: data.orderId ?? null, receiptNumber },
      },
    });

    return created;
  });

  // Best-effort — a failed/slow WhatsApp send must never roll back the
  // already-committed payment record, so this runs after the transaction,
  // not inside it.
  try {
    const settings = await getAppSettings();
    const toNumber = customer.whatsappNumber || customer.phoneNumber;
    const body = buildPaymentReceiptMessage(
      settings.businessName,
      { receiptNumber, amount: data.amount, collectedAt: collection.collectedAt },
      outstandingAfterPayment
    );
    const send = await getWhatsAppProvider().sendMessage({ toPhoneNumber: toNumber, body });
    await db.reminderLog.create({
      data: {
        customerId: data.customerId,
        orderId: data.orderId,
        channel: "WHATSAPP",
        kind: "PAYMENT_RECEIPT",
        status: send.status === "failed" ? "FAILED" : "SENT",
        body,
        providerMessageId: send.providerMessageId,
        sentAt: send.status === "failed" ? null : new Date(),
      },
    });
  } catch {
    // Receipt messaging is best-effort; the payment itself is already recorded.
  }

  return NextResponse.json({ collection }, { status: 201 });
}
