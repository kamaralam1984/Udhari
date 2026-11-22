import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";

  const notifications = await db.notification.findMany({
    where: { channel: "DASHBOARD", ...(unreadOnly ? { readAt: null } : {}) },
    include: { customer: true, call: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ notifications });
}

const Schema = z.union([z.object({ id: z.string().min(1) }), z.object({ all: z.literal(true) })]);

/** `{ id }` marks one notification read; `{ all: true }` marks every unread dashboard notification read. */
export async function PATCH(req: NextRequest) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "id or all:true is required." }, { status: 400 });

  if ("all" in parsed.data) {
    const { count } = await db.notification.updateMany({ where: { channel: "DASHBOARD", readAt: null }, data: { readAt: new Date() } });
    return NextResponse.json({ updated: count });
  }

  const existing = await db.notification.findUnique({ where: { id: parsed.data.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  const notification = await db.notification.update({ where: { id: parsed.data.id }, data: { readAt: new Date() } });
  return NextResponse.json({ notification });
}
