import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { resolveRange, riskScore, pct } from "@/lib/analytics";
import { buildReportPdf } from "@/lib/reportPdf";
import { getAppSettings } from "@/lib/antiSpam";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection from customer-supplied text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

function xlsxCell(v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

async function toXlsx(sheet: string, header: string[], rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
  for (const r of rows) ws.addRow(r.map(xlsxCell));
  ws.columns.forEach((c, i) => {
    const longest = Math.max(header[i]?.length ?? 8, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
    c.width = Math.min(48, Math.max(10, longest + 2));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const isStaff = session.role === "STAFF";

  const sp = new URL(req.url).searchParams;
  const spec = resolveRange({ range: sp.get("range"), from: sp.get("from"), to: sp.get("to") }, new Date());
  const type = sp.get("type") === "collections" ? "collections" : sp.get("type") === "summary" ? "summary" : "calls";
  const format = sp.get("format") === "xlsx" ? "xlsx" : sp.get("format") === "pdf" ? "pdf" : "csv";
  const inRange = { gte: spec.from, lt: spec.to };
  const tag = `${type}-${spec.key === "custom" ? `${spec.from.toISOString().slice(0, 10)}_${spec.to.toISOString().slice(0, 10)}` : spec.key}`;

  if (isStaff && type === "collections") {
    return Response.json({ error: "Collection reports sirf owner/admin ke liye hain." }, { status: 403 });
  }

  const respond = (body: BodyInit, ext: string, mime: string) =>
    new Response(body, {
      headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename="${tag}.${ext}"`, "Cache-Control": "no-store" },
    });

  // ---- PDF management summary --------------------------------------------
  if (type === "summary" || format === "pdf") {
    const [settings, calls, promiseAgg, collected, cost, outstanding, users, byUser, collectionsByUser, top, riskCalls, riskPromises] = await Promise.all([
      getAppSettings(),
      db.call.groupBy({ by: ["status"], _count: true, where: { createdAt: inRange } }),
      db.promiseToPay.aggregate({ _count: true, _sum: { promisedAmount: true }, where: { createdAt: inRange } }),
      db.cashCollection.aggregate({ _count: true, _sum: { amount: true }, where: { collectedAt: inRange } }),
      db.callUsageLog.aggregate({ _sum: { estimatedCost: true }, where: { createdAt: inRange } }),
      db.customer.aggregate({ _sum: { outstandingAmount: true } }),
      db.user.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      db.call.groupBy({ by: ["initiatedByUserId"], _count: true, where: { createdAt: inRange, initiatedByUserId: { not: null } } }),
      db.cashCollection.groupBy({ by: ["collectedById"], _sum: { amount: true }, where: { collectedAt: inRange } }),
      isStaff
        ? Promise.resolve([])
        : db.customer.findMany({ where: { outstandingAmount: { gt: 0 } }, orderBy: { outstandingAmount: "desc" }, take: 10, select: { id: true, name: true, outstandingAmount: true, lastPaymentDate: true } }),
      isStaff ? Promise.resolve([]) : db.call.groupBy({ by: ["customerId", "status"], _count: true }),
      isStaff ? Promise.resolve([]) : db.promiseToPay.groupBy({ by: ["customerId", "status"], _count: true }),
    ]);
    const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
    const total = calls.reduce((a, c) => a + c._count, 0);
    const notConnected = ["QUEUED", "RINGING", "NO_ANSWER", "BUSY", "FAILED"];
    const connected = calls.filter((c) => !notConnected.includes(c.status)).reduce((a, c) => a + c._count, 0);
    const collectedAmt = Number(collected._sum.amount ?? 0);
    const costAmt = Number(cost._sum.estimatedCost ?? 0);
    const money = !isStaff;
    const nowMs = Date.now();

    const pdf = await buildReportPdf({
      business: settings.businessName,
      rangeLabel: spec.label,
      generatedAt: new Date().toLocaleString("en-IN"),
      showMoney: money,
      kpis: [
        { label: "Calls placed", value: String(total) },
        { label: "Connected", value: `${connected} (${pct(connected, total, 0)}%)` },
        { label: "Promises captured", value: String(promiseAgg._count) },
        ...(money
          ? [
              { label: "Cash collected", value: inr(collectedAmt) },
              { label: "Call cost", value: inr(costAmt) },
              { label: "Collected per Rs 1 spent", value: costAmt > 0 ? `Rs ${(collectedAmt / costAmt).toFixed(1)}` : "-" },
              { label: "Total outstanding", value: inr(Number(outstanding._sum.outstandingAmount ?? 0)) },
              { label: "Promised amount", value: inr(Number(promiseAgg._sum.promisedAmount ?? 0)) },
            ]
          : []),
      ],
      statusBreakdown: calls.map((c) => ({ label: c.status.replace(/_/g, " ").toLowerCase(), count: c._count })).sort((a, b) => b.count - a.count),
      staff: users
        .filter((u) => !isStaff || u.id === session.sub)
        .map((u) => ({
          name: u.name,
          calls: byUser.find((b) => b.initiatedByUserId === u.id)?._count ?? 0,
          collected: inr(Number(collectionsByUser.find((c) => c.collectedById === u.id)?._sum.amount ?? 0)),
        }))
        .sort((a, b) => b.calls - a.calls),
      topCustomers: top.map((c) => {
        const mine = riskCalls.filter((r) => r.customerId === c.id);
        const prom = riskPromises.filter((r) => r.customerId === c.id);
        const sum = (rows: { _count: number; status: string }[], f: (s: string) => boolean) => rows.filter((r) => f(r.status)).reduce((a, r) => a + r._count, 0);
        const r = riskScore({
          outstanding: Number(c.outstandingAmount),
          calls: sum(mine, () => true),
          noAnswer: sum(mine, (s) => ["NO_ANSWER", "BUSY", "FAILED"].includes(s)),
          promisesBroken: sum(prom, (s) => s === "BROKEN"),
          promisesFulfilled: sum(prom, (s) => s === "FULFILLED"),
          daysSincePayment: c.lastPaymentDate ? Math.floor((nowMs - c.lastPaymentDate.getTime()) / 86_400_000) : null,
        });
        return { name: c.name, outstanding: inr(Number(c.outstandingAmount)), risk: `${r.level} (${r.score})` };
      }),
    });
    return respond(new Uint8Array(pdf), "pdf", "application/pdf");
  }

  // ---- tabular exports ----------------------------------------------------
  let header: string[];
  let rows: unknown[][];
  if (type === "calls") {
    const calls = await db.call.findMany({
      where: { createdAt: inRange },
      orderBy: { createdAt: "desc" },
      take: 20_000,
      select: {
        id: true, createdAt: true, status: true, mode: true, language: true, duration: true, paymentIntent: true,
        promisedAmount: true, promisedDate: true, confidence: true, summary: true,
        customer: { select: { name: true, phoneNumber: true } },
        campaign: { select: { name: true } },
      },
    });
    header = ["Call ID", "Time (UTC)", "Customer", "Phone", "Campaign", "Status", "Mode", "Language", "Duration (s)", "Intent", "Promised amount", "Promised date", "Confidence", "Summary"];
    rows = calls.map((c) => [
      c.id, c.createdAt, c.customer.name, c.customer.phoneNumber, c.campaign?.name, c.status, c.mode, c.language, c.duration,
      c.paymentIntent, c.promisedAmount ? Number(c.promisedAmount) : null, c.promisedDate, c.confidence, c.summary,
    ]);
  } else {
    const list = await db.cashCollection.findMany({
      where: { collectedAt: inRange },
      orderBy: { collectedAt: "desc" },
      take: 20_000,
      select: {
        receiptNumber: true, collectedAt: true, amount: true, note: true,
        customer: { select: { name: true, phoneNumber: true } },
        collectedBy: { select: { name: true } },
      },
    });
    header = ["Receipt", "Collected at (UTC)", "Customer", "Phone", "Amount (INR)", "Collected by", "Note"];
    rows = list.map((r) => [r.receiptNumber, r.collectedAt, r.customer.name, r.customer.phoneNumber, Number(r.amount), r.collectedBy.name, r.note]);
  }

  if (format === "xlsx") {
    const buf = await toXlsx(type, header, rows);
    return respond(new Uint8Array(buf), "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  return respond(toCsv(header, rows), "csv", "text/csv; charset=utf-8");
}
