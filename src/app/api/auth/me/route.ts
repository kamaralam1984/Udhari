import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.sub } });
  return NextResponse.json({
    user: { id: session.sub, name: session.name, email: session.email, role: session.role, whatsappNumber: user?.whatsappNumber ?? null },
  });
}

const Schema = z.object({ whatsappNumber: z.string().nullable().optional() });

/** Self-service — a user may only edit their own WhatsApp contact number (used for AI-call-report delivery when they're OWNER). */
export async function PATCH(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

  const user = await db.user.update({ where: { id: session.sub }, data: { whatsappNumber: parsed.data.whatsappNumber } });
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, whatsappNumber: user.whatsappNumber } });
}
