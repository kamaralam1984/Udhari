import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { getAppSettings } from "@/lib/antiSpam";
import { getWhatsAppProvider } from "@/lib/providers/registry";
import { buildBillMessage } from "@/lib/notifications/customerMessages";

type Ctx = { params: Promise<{ id: string }> };

/** Sends the order's bill to the customer over WhatsApp (mock provider until a real vendor is wired) — req 2. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    await requireSession(["OWNER", "ADMIN", "STAFF"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const order = await db.order.findUnique({ where: { id }, include: { items: true, customer: true } });
  if (!order) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const toNumber = order.customer.whatsappNumber || order.customer.phoneNumber;
  const settings = await getAppSettings();
  const body = buildBillMessage(settings.businessName, {
    orderNumber: order.orderNumber,
    totalAmount: Number(order.totalAmount),
    paidAmount: Number(order.paidAmount),
    promisedPaymentDate: order.promisedPaymentDate,
    items: order.items.map((it) => ({
      itemName: it.itemName,
      quantity: Number(it.quantity),
      unit: it.unit,
      rate: Number(it.rate),
      amount: Number(it.amount),
    })),
  });

  const send = await getWhatsAppProvider().sendMessage({ toPhoneNumber: toNumber, body });

  const log = await db.reminderLog.create({
    data: {
      customerId: order.customerId,
      orderId: order.id,
      channel: "WHATSAPP",
      kind: "BILL_RECEIPT",
      status: send.status === "failed" ? "FAILED" : "SENT",
      body,
      providerMessageId: send.providerMessageId,
      sentAt: send.status === "failed" ? null : new Date(),
    },
  });

  return NextResponse.json({ reminderLog: log });
}
