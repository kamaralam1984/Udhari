import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { startOfDayInAppTz } from "@/lib/time";

/** Owner/admin-only oversight view over staff — how much cash each staff member collected. */
export async function GET(req: NextRequest) {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : startOfDayInAppTz(new Date());
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

  const grouped = await db.cashCollection.groupBy({
    by: ["collectedById"],
    where: { collectedAt: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
  });

  const users = await db.user.findMany({ where: { id: { in: grouped.map((g) => g.collectedById) } } });
  const staffCollections = grouped
    .map((g) => ({
      userId: g.collectedById,
      userName: users.find((u) => u.id === g.collectedById)?.name ?? "Unknown",
      totalAmount: Number(g._sum.amount ?? 0),
      count: g._count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return NextResponse.json({ staffCollections });
}
