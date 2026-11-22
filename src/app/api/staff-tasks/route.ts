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
  const type = searchParams.get("type") || undefined;

  const tasks = await db.staffTask.findMany({
    where: {
      status: status ? (status as never) : undefined,
      type: type ? (type as never) : undefined,
    },
    include: { customer: true, call: true, assignedTo: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ tasks });
}
