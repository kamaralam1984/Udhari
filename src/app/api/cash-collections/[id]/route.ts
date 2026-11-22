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

  const collection = await db.cashCollection.findUnique({
    where: { id },
    include: { customer: true, order: { include: { items: true } }, collectedBy: true },
  });
  if (!collection) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ collection });
}
