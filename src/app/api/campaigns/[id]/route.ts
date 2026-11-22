import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { campaignStatsMap, emptyStats } from "@/lib/campaigns";
import { isConnectedStatus } from "@/lib/analytics";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await ctx.params;
  const campaign = await db.campaign.findUnique({ where: { id }, include: { createdBy: { select: { name: true } } } });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const [members, calls, promises, stats] = await Promise.all([
    db.campaignMember.findMany({
      where: { campaignId: id },
      include: { customer: { select: { id: true, name: true, phoneNumber: true, outstandingAmount: true, doNotCall: true } } },
      orderBy: { addedAt: "asc" },
    }),
    db.call.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, customerId: true, status: true, createdAt: true },
    }),
    db.promiseToPay.findMany({
      where: { call: { campaignId: id } },
      select: { customerId: true, status: true, promisedAmount: true },
    }),
    campaignStatsMap([id]),
  ]);

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      createdBy: campaign.createdBy.name,
    },
    stats: stats.get(id) ?? emptyStats(),
    members: members.map((m) => {
      const mine = calls.filter((c) => c.customerId === m.customerId);
      const promise = promises.find((p) => p.customerId === m.customerId && p.status !== "SUPERSEDED" && p.status !== "CANCELLED");
      const state = promise
        ? promise.status === "FULFILLED"
          ? "PAID"
          : promise.status === "BROKEN"
            ? "BROKEN"
            : "PROMISED"
        : mine.some((c) => isConnectedStatus(c.status))
          ? "REACHED"
          : mine.length
            ? "NO_ANSWER"
            : "PENDING";
      return {
        customerId: m.customerId,
        name: m.customer.name,
        phone: m.customer.phoneNumber,
        outstanding: Number(m.customer.outstandingAmount),
        doNotCall: m.customer.doNotCall,
        calls: mine.length,
        lastCallId: mine[0]?.id ?? null,
        lastCallAt: mine[0]?.createdAt ?? null,
        promisedAmount: promise ? Number(promise.promisedAmount) : null,
        state,
      };
    }),
  });
}

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  addCustomerIds: z.array(z.string().min(1)).max(2000).optional(),
  removeCustomerIds: z.array(z.string().min(1)).max(2000).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await ctx.params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update.", details: parsed.error.issues }, { status: 400 });
  const { addCustomerIds, removeCustomerIds, startDate, endDate, ...rest } = parsed.data;

  if (!(await db.campaign.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  await db.campaign.update({
    where: { id },
    data: {
      ...rest,
      startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null,
      endDate: endDate === undefined ? undefined : endDate ? new Date(endDate) : null,
    },
  });
  if (addCustomerIds?.length) {
    const valid = await db.customer.findMany({ where: { id: { in: addCustomerIds }, doNotCall: false }, select: { id: true } });
    await db.campaignMember.createMany({ data: valid.map((c) => ({ campaignId: id, customerId: c.id })), skipDuplicates: true });
  }
  if (removeCustomerIds?.length) {
    await db.campaignMember.deleteMany({ where: { campaignId: id, customerId: { in: removeCustomerIds } } });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const { id } = await ctx.params;
  const existing = await db.campaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (existing.status === "ACTIVE") {
    return NextResponse.json({ error: "Active campaign delete nahi ho sakta — pehle Pause ya Complete karo." }, { status: 409 });
  }
  await db.campaign.delete({ where: { id } }); // members cascade; calls keep their history (campaignId -> null)
  return NextResponse.json({ ok: true });
}
