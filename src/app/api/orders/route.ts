import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

// Orders/billing is a staff-entered financial record, like CashCollection —
// src/lib/callEngine/* and src/server/twilioStreamHandler.ts must never
// import this module. The AI can never create or modify an Order.

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId") || undefined;
  const status = searchParams.get("status") || undefined;

  const orders = await db.order.findMany({
    where: {
      customerId: customerId || undefined,
      status: status ? (status as never) : undefined,
    },
    include: { items: true, customer: true },
    orderBy: { orderDate: "desc" },
    take: 200,
  });
  return NextResponse.json({ orders });
}

const OrderItemSchema = z.object({
  itemName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  rate: z.number().nonnegative(),
});

const CreateOrderSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(OrderItemSchema).min(1),
  paidNow: z.number().nonnegative().optional(),
  promisedPaymentDate: z.string().datetime().nullable().optional(),
  notes: z.string().optional(),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN", "STAFF"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order data.", details: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const customer = await db.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  const itemsWithAmount = data.items.map((it) => ({
    itemName: it.itemName,
    quantity: it.quantity,
    unit: it.unit,
    rate: it.rate,
    amount: round2(it.quantity * it.rate),
  }));
  const totalAmount = round2(itemsWithAmount.reduce((sum, it) => sum + it.amount, 0));
  const paidNow = round2(Math.min(data.paidNow ?? 0, totalAmount));
  const creditAmount = round2(totalAmount - paidNow);

  const orderId = randomUUID();
  const orderNumber = `ORD-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        id: orderId,
        orderNumber,
        customerId: data.customerId,
        totalAmount,
        paidAmount: paidNow,
        promisedPaymentDate: data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null,
        status: creditAmount <= 0 ? "PAID" : "OPEN",
        createdById: session.sub,
        notes: data.notes,
        items: { create: itemsWithAmount },
      },
      include: { items: true },
    });

    if (paidNow > 0) {
      const ccId = randomUUID();
      await tx.cashCollection.create({
        data: {
          id: ccId,
          receiptNumber: `RCP-${ccId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
          customerId: data.customerId,
          orderId: created.id,
          amount: paidNow,
          collectedById: session.sub,
          note: "Paid at order time",
        },
      });
    }

    if (creditAmount > 0) {
      await tx.customer.update({
        where: { id: data.customerId },
        data: { outstandingAmount: { increment: creditAmount } },
      });
    }
    if (paidNow > 0) {
      await tx.customer.update({ where: { id: data.customerId }, data: { lastPaymentDate: new Date() } });
    }

    if (creditAmount > 0 && data.promisedPaymentDate) {
      await tx.followUp.create({
        data: {
          customerId: data.customerId,
          orderId: created.id,
          scheduledDate: new Date(data.promisedPaymentDate),
          reason: `Order ${created.orderNumber} payment due`,
          status: "PENDING",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        entityType: "Order",
        entityId: created.id,
        action: "CREATE",
        actorType: "STAFF",
        actorUserId: session.sub,
        afterData: { orderNumber: created.orderNumber, totalAmount, paidNow, creditAmount },
      },
    });

    return created;
  });

  return NextResponse.json({ order }, { status: 201 });
}
