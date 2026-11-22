import { NextRequest, NextResponse } from "next/server";
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

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      customer: true,
      cashCollections: { orderBy: { collectedAt: "desc" }, include: { collectedBy: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ order });
}
