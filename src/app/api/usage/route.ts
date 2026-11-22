import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { startOfDayInAppTz } from "@/lib/time";

export async function GET() {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const todayStart = startOfDayInAppTz(new Date());

  const [allLogs, todayLogs, byProvider] = await Promise.all([
    db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, _count: true }),
    db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: todayStart } } }),
    db.callUsageLog.groupBy({
      by: ["provider"],
      _sum: { estimatedCost: true, durationSeconds: true, unitsUsed: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    totalEstimatedCost: Number(allLogs._sum.estimatedCost ?? 0),
    totalLogs: allLogs._count,
    todayEstimatedCost: Number(todayLogs._sum.estimatedCost ?? 0),
    byProvider: byProvider.map((p) => ({
      provider: p.provider,
      estimatedCost: Number(p._sum.estimatedCost ?? 0),
      durationSeconds: p._sum.durationSeconds ?? 0,
      unitsUsed: p._sum.unitsUsed ?? 0,
      count: p._count,
    })),
  });
}
