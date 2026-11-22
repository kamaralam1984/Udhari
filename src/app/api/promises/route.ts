import { NextRequest, NextResponse } from "next/server";
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
  const status = searchParams.get("status") || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

  const rows = await db.promiseToPay.findMany({
    where: { status: status ? (status as never) : undefined },
    include: { customer: true, call: true },
    orderBy: { promisedDate: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const promises = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({ promises, hasMore });
}
