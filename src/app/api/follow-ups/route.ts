import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const customerId = searchParams.get("customerId") || undefined;

  const followUps = await db.followUp.findMany({
    where: {
      status: status ? (status as never) : undefined,
      customerId: customerId || undefined,
    },
    include: { customer: true, order: true },
    orderBy: { scheduledDate: "asc" },
    take: 200,
  });
  return NextResponse.json({ followUps });
}
