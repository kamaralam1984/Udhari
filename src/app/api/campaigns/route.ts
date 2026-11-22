import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { campaignStatsMap, emptyStats } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const campaigns = await db.campaign.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { createdBy: { select: { name: true } } },
    take: 200,
  });
  const stats = await campaignStatsMap(campaigns.map((c) => c.id));
  return NextResponse.json({
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      createdAt: c.createdAt,
      createdBy: c.createdBy.name,
      stats: stats.get(c.id) ?? emptyStats(),
    })),
  });
}

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  customerIds: z.array(z.string().min(1)).max(2000).optional(),
  /** Convenience: add every customer with an outstanding balance who is not on Do-Not-Call. */
  includeAllOutstanding: z.boolean().optional(),
  minOutstanding: z.number().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign.", details: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  if (d.startDate && d.endDate && new Date(d.endDate) < new Date(d.startDate)) {
    return NextResponse.json({ error: "End date start date se pehle nahi ho sakti." }, { status: 400 });
  }

  let customerIds = d.customerIds ?? [];
  if (d.includeAllOutstanding) {
    const rows = await db.customer.findMany({
      where: { outstandingAmount: { gt: d.minOutstanding ?? 0 }, doNotCall: false },
      select: { id: true },
    });
    customerIds = [...customerIds, ...rows.map((r) => r.id)];
  }
  customerIds = [...new Set(customerIds)];

  const valid = customerIds.length
    ? await db.customer.findMany({ where: { id: { in: customerIds }, doNotCall: false }, select: { id: true } })
    : [];

  const campaign = await db.campaign.create({
    data: {
      name: d.name,
      description: d.description,
      startDate: d.startDate ? new Date(d.startDate) : undefined,
      endDate: d.endDate ? new Date(d.endDate) : undefined,
      createdById: session.sub,
      members: { create: valid.map((c) => ({ customerId: c.id })) },
    },
  });
  return NextResponse.json({ campaign, membersAdded: valid.length, skippedDoNotCall: customerIds.length - valid.length }, { status: 201 });
}
