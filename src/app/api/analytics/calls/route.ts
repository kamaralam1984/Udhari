import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { APP_TIMEZONE } from "@/lib/time";
import { NOT_CONNECTED_STATUSES } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * Drill-down behind a chart click.
 *  - bucket click:   ?from=<ISO>&to=<ISO>&group=connected|missed|all
 *  - heatmap click:  ?dow=0..6 (Mon=0)&hour=0..23  (last 30 days, business timezone)
 */
export async function GET(req: Request) {
  try {
    await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const sp = new URL(req.url).searchParams;
  const group = sp.get("group") === "connected" || sp.get("group") === "missed" ? sp.get("group") : "all";
  const select = {
    id: true,
    status: true,
    paymentIntent: true,
    duration: true,
    summary: true,
    createdAt: true,
    customer: { select: { name: true, phoneNumber: true } },
  } satisfies Prisma.CallSelect;

  const dowParam = sp.get("dow");
  const hourParam = sp.get("hour");
  if (dowParam !== null && hourParam !== null) {
    const dow = Number(dowParam);
    const hour = Number(hourParam);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json({ error: "Invalid slot." }, { status: 400 });
    }
    const pgDow = (dow + 1) % 7; // Monday-first -> Postgres DOW (0 = Sunday)
    const tz = APP_TIMEZONE;
    const ids = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM (
        SELECT id, "createdAt", ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS l
        FROM "Call"
        WHERE "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'
      ) t
      WHERE EXTRACT(DOW FROM l)::int = ${pgDow} AND EXTRACT(HOUR FROM l)::int = ${hour}
      ORDER BY "createdAt" DESC LIMIT 100`;
    const calls = await db.call.findMany({ where: { id: { in: ids.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, select });
    return NextResponse.json({ calls });
  }

  const from = new Date(sp.get("from") ?? "");
  const to = new Date(sp.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to required." }, { status: 400 });
  }
  const notConnected = [...NOT_CONNECTED_STATUSES] as never[];
  const calls = await db.call.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      ...(group === "connected" ? { status: { notIn: notConnected } } : group === "missed" ? { status: { in: ["NO_ANSWER", "BUSY", "FAILED"] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select,
  });
  return NextResponse.json({ calls });
}
