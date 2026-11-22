import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const doNotCall = searchParams.get("doNotCall");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

  const rows = await db.customer.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phoneNumber: { contains: q } },
              ],
            }
          : {},
        doNotCall !== null ? { doNotCall: doNotCall === "true" } : {},
      ],
    },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const customers = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({ customers, hasMore });
}

const CreateCustomerSchema = z.object({
  name: z.string().min(1),
  phoneNumber: z.string().min(6),
  whatsappNumber: z.string().optional(),
  address: z.string().optional(),
  outstandingAmount: z.number().nonnegative(),
  preferredLanguage: z.string().default("hinglish"),
  lastPaymentDate: z.string().datetime().nullable().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid customer data.", details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;
  const customer = await db.customer.create({
    data: {
      name: data.name,
      phoneNumber: data.phoneNumber,
      whatsappNumber: data.whatsappNumber,
      address: data.address,
      outstandingAmount: data.outstandingAmount,
      preferredLanguage: data.preferredLanguage,
      lastPaymentDate: data.lastPaymentDate ? new Date(data.lastPaymentDate) : null,
      notes: data.notes,
    },
  });

  return NextResponse.json({ customer }, { status: 201 });
}
