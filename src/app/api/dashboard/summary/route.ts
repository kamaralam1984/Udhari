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

  const [
    todaysCalls,
    connected,
    noAnswer,
    promisesCaptured,
    verificationRequired,
    aiUncertain,
    todaysCost,
    totalOutstanding,
    todaysDueCount,
    overdueCount,
    todaysCashCollected,
    promisesBrokenOpen,
  ] = await Promise.all([
    db.call.count({ where: { createdAt: { gte: todayStart } } }),
    // "Connected" = the call reached a live conversation at all, not just
    // calls still mid-conversation right now (status moves on to COMPLETED/
    // AI_UNCERTAIN/etc. once the conversation ends).
    db.call.count({
      where: {
        createdAt: { gte: todayStart },
        status: { notIn: ["QUEUED", "RINGING", "NO_ANSWER", "BUSY", "FAILED"] },
      },
    }),
    db.call.count({ where: { createdAt: { gte: todayStart }, status: "NO_ANSWER" } }),
    db.promiseToPay.count({ where: { createdAt: { gte: todayStart } } }),
    db.staffTask.count({ where: { type: "PAYMENT_VERIFICATION_REQUIRED", status: { not: "RESOLVED" } } }),
    db.call.count({ where: { createdAt: { gte: todayStart }, status: "AI_UNCERTAIN" } }),
    db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: { gte: todayStart } } }),
    db.customer.aggregate({ _sum: { outstandingAmount: true } }),
    db.followUp.count({
      where: { status: "PENDING", scheduledDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 86400000) } },
    }),
    db.followUp.count({ where: { status: "PENDING", scheduledDate: { lt: todayStart } } }),
    db.cashCollection.aggregate({ _sum: { amount: true }, where: { collectedAt: { gte: todayStart } } }),
    db.promiseToPay.count({ where: { status: "BROKEN" } }),
  ]);

  return NextResponse.json({
    todaysCalls,
    connected,
    noAnswer,
    promisesCaptured,
    verificationRequired,
    aiUncertain,
    estimatedCallCostToday: Number(todaysCost._sum.estimatedCost ?? 0),
    totalOutstanding: Number(totalOutstanding._sum.outstandingAmount ?? 0),
    todaysDueCount,
    overdueCount,
    todaysCashCollected: Number(todaysCashCollected._sum.amount ?? 0),
    promisesBrokenOpen,
  });
}
