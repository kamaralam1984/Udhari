import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  verdict: z.enum(["PASS", "FAIL", "NEEDS_REVIEW", "UNREVIEWED"]),
  reviewerNote: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

  const test = await db.languageTest.update({
    where: { id },
    data: { verdict: parsed.data.verdict, reviewerNote: parsed.data.reviewerNote },
  });
  return NextResponse.json({ test });
}
