import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  assignedToId: z.string().nullable().optional(),
  resolutionNote: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN", "STAFF"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

  const task = await db.staffTask.update({
    where: { id },
    data: {
      status: parsed.data.status,
      assignedToId: parsed.data.assignedToId,
      resolutionNote: parsed.data.resolutionNote,
      resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : undefined,
      resolvedById: parsed.data.status === "RESOLVED" ? session.sub : undefined,
    },
  });
  return NextResponse.json({ task });
}
