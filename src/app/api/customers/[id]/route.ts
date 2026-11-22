import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      calls: { orderBy: { createdAt: "desc" }, take: 20 },
      promises: { orderBy: { createdAt: "desc" }, take: 20 },
      followUps: { orderBy: { scheduledDate: "desc" }, take: 20 },
      staffTasks: { orderBy: { createdAt: "desc" }, take: 20 },
      orders: { orderBy: { orderDate: "desc" }, take: 20, include: { items: true } },
      cashCollections: { orderBy: { collectedAt: "desc" }, take: 20 },
      reminderLogs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ customer });
}

const UpdateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  whatsappNumber: z.string().nullable().optional(),
  outstandingAmount: z.number().nonnegative().optional(),
  preferredLanguage: z.string().optional(),
  lastPaymentDate: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = UpdateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data.", details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  const customer = await db.customer.update({
    where: { id },
    data: {
      ...data,
      lastPaymentDate: data.lastPaymentDate === undefined ? undefined : data.lastPaymentDate ? new Date(data.lastPaymentDate) : null,
    },
  });
  return NextResponse.json({ customer });
}
