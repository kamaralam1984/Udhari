import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { cleanupCustomer, createTestCustomer } from "./helpers";

const PORT = 3419;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "Qa@12345678";

let server: ChildProcessWithoutNullStreams;
let ownerEmail: string;
let staffEmail: string;
let ownerCookie = "";
let staffCookie = "";
let customerId = "";
const createdCampaignIds: string[] = [];

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/login`)).status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not become ready in time");
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (path: string, cookie = "") => fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const stamp = `${Date.now()}`;
  ownerEmail = `qa_owner_${stamp}@test.local`;
  staffEmail = `qa_staff_${stamp}@test.local`;
  const passwordHash = await hashPassword(PASSWORD);
  await db.user.create({ data: { name: "QA Owner", email: ownerEmail, passwordHash, role: "OWNER" } });
  await db.user.create({ data: { name: "QA Staff", email: staffEmail, passwordHash, role: "STAFF" } });
  customerId = (await createTestCustomer({ outstandingAmount: 5000 })).id;

  server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: process.cwd(), env: { ...process.env }, stdio: "pipe", detached: true });
  await waitForServer();
  ownerCookie = await login(ownerEmail);
  staffCookie = await login(staffEmail);
}, 120000);

afterAll(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  for (const id of createdCampaignIds) {
    const calls = await db.call.findMany({ where: { campaignId: id }, select: { id: true } });
    await db.promiseToPay.deleteMany({ where: { callId: { in: calls.map((c) => c.id) } } });
    await db.call.deleteMany({ where: { campaignId: id } });
    await db.campaign.deleteMany({ where: { id } });
  }
  if (customerId) await cleanupCustomer(customerId).catch(() => {});
  await db.user.deleteMany({ where: { email: { in: [ownerEmail, staffEmail] } } });
});

describe("analytics / campaigns / live-calls APIs", () => {
  it("requires a session", async () => {
    for (const p of ["/api/analytics", "/api/live-calls", "/api/campaigns", "/api/analytics/calls?dow=1&hour=9", "/api/analytics/export"]) {
      expect((await get(p)).status, p).toBe(401);
    }
  });

  it("returns the full analytics payload for the owner (preset, custom and compare)", async () => {
    const res = await get("/api/analytics?range=7d", ownerCookie);
    expect(res.status).toBe(200);
    const d = await res.json();
    for (const k of ["totals", "gauges", "volume", "heatmap", "heatmapConnected", "bestSlots", "flow", "campaigns", "agents", "timeline", "trends", "customers", "roi", "alerts", "viewer"]) {
      expect(d, k).toHaveProperty(k);
    }
    expect(d.volume.labels).toHaveLength(7);
    expect(d.heatmap).toHaveLength(7);
    expect(d.viewer).toEqual({ role: "OWNER", scope: "all" });
    expect(d.compare).toBeNull();

    const custom = await (await get("/api/analytics?range=custom&from=2026-01-01&to=2026-01-10&compare=1", ownerCookie)).json();
    expect(custom.range).toBe("custom");
    expect(custom.volume.labels).toHaveLength(10);
    expect(custom.compare.delta).toHaveProperty("total");

    const reversed = await (await get("/api/analytics?range=custom&from=2026-02-10&to=2026-02-01", ownerCookie)).json();
    expect(reversed.range).toBe("24h");
  });

  it("hides money and other people's data from STAFF", async () => {
    const d = await (await get("/api/analytics?range=30d", staffCookie)).json();
    expect(d.viewer.scope).toBe("self");
    expect(d.customers).toBeNull();
    expect(d.roi).toBeNull();
    expect(d.collected).toEqual({ amount: 0, count: 0 });
    expect(d.agents).toHaveLength(1);
    expect(d.campaigns.find((c: { key: string }) => c.key === "recovery")).toBeUndefined();
    expect((await get("/api/analytics/export?type=collections&format=csv", staffCookie)).status).toBe(403);
    expect((await get("/api/analytics/export?type=calls&format=csv", staffCookie)).status).toBe(200);
  });

  it("exports Excel, CSV and PDF", async () => {
    const x = await get("/api/analytics/export?type=calls&format=xlsx&range=30d", ownerCookie);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    const xb = Buffer.from(await x.arrayBuffer());
    expect(xb.subarray(0, 2).toString()).toBe("PK"); // xlsx = zip

    const c = await get("/api/analytics/export?type=collections&format=csv&range=30d", ownerCookie);
    expect(c.headers.get("content-type")).toContain("text/csv");
    expect(await c.text()).toContain("Receipt");

    const p = await get("/api/analytics/export?type=summary&format=pdf&range=30d", ownerCookie);
    expect(p.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await p.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("drill-down validates its input", async () => {
    expect((await get("/api/analytics/calls?dow=9&hour=1", ownerCookie)).status).toBe(400);
    expect((await get("/api/analytics/calls", ownerCookie)).status).toBe(400);
    const ok = await get("/api/analytics/calls?dow=1&hour=11", ownerCookie);
    expect(ok.status).toBe(200);
    expect(Array.isArray((await ok.json()).calls)).toBe(true);
  });

  it("runs a campaign end to end with role + state guards", async () => {
    expect((await send("POST", "/api/campaigns", staffCookie, { name: "Nope", customerIds: [customerId] })).status).toBe(403);

    const created = await send("POST", "/api/campaigns", ownerCookie, { name: "QA campaign", customerIds: [customerId] });
    expect(created.status).toBe(201);
    const { campaign, membersAdded } = await created.json();
    createdCampaignIds.push(campaign.id);
    expect(membersAdded).toBe(1);

    // draft campaigns cannot place calls
    expect((await send("POST", `/api/campaigns/${campaign.id}/call-next`, ownerCookie, { mode: "TEST" })).status).toBe(409);
    expect((await send("PATCH", `/api/campaigns/${campaign.id}`, ownerCookie, { status: "ACTIVE" })).status).toBe(200);

    // PRODUCTION is refused while the app is in TEST mode
    expect((await send("POST", `/api/campaigns/${campaign.id}/call-next`, ownerCookie, { mode: "PRODUCTION" })).status).toBe(403);

    const next = await send("POST", `/api/campaigns/${campaign.id}/call-next`, ownerCookie, { mode: "TEST" });
    expect(next.status).toBe(201);
    expect((await next.json()).call.campaignId).toBe(campaign.id);

    const again = await (await send("POST", `/api/campaigns/${campaign.id}/call-next`, ownerCookie, { mode: "TEST" })).json();
    expect(again.done).toBe(true); // the only member has been called

    const detail = await (await get(`/api/campaigns/${campaign.id}`, ownerCookie)).json();
    expect(detail.stats.members).toBe(1);
    expect(detail.stats.called).toBe(1);
    expect(detail.stats.progress).toBe(100);

    expect((await send("DELETE", `/api/campaigns/${campaign.id}`, ownerCookie)).status).toBe(409); // active
    expect((await send("PATCH", `/api/campaigns/${campaign.id}`, ownerCookie, { status: "COMPLETED" })).status).toBe(200);
  });

  it("validates campaign input", async () => {
    expect((await send("POST", "/api/campaigns", ownerCookie, { name: "x" })).status).toBe(400);
    expect((await send("POST", "/api/campaigns", ownerCookie, { name: "Bad dates", startDate: "2026-05-02T00:00:00.000Z", endDate: "2026-05-01T00:00:00.000Z" })).status).toBe(400);
    expect((await get("/api/campaigns/does-not-exist", ownerCookie)).status).toBe(404);
  });

  it("serves live calls as a list", async () => {
    const d = await (await get("/api/live-calls", ownerCookie)).json();
    expect(Array.isArray(d.calls)).toBe(true);
  });

  it("saves the new alert / report settings and rejects out-of-range values", async () => {
    const before = await db.appSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    try {
      const ok = await send("PATCH", "/api/settings", ownerCookie, { alertMinSuccessRate: 85, dailyReportHour: 20, dailyReportEnabled: false });
      expect(ok.status).toBe(200);
      expect((await ok.json()).settings.alertMinSuccessRate).toBe(85);
      expect((await send("PATCH", "/api/settings", ownerCookie, { alertMinSuccessRate: 150 })).status).toBe(400);
      expect((await send("PATCH", "/api/settings", ownerCookie, { dailyReportHour: 24 })).status).toBe(400);
      expect((await send("PATCH", "/api/settings", ownerCookie, { bestCallMaxDeferHours: 0 })).status).toBe(400);
      expect((await send("PATCH", "/api/settings", ownerCookie, { bestCallMaxDeferHours: 99 })).status).toBe(400);
      const smart = await send("PATCH", "/api/settings", ownerCookie, { useBestCallTime: true, bestCallMaxDeferHours: 12 });
      expect(smart.status).toBe(200);
      expect((await (await get("/api/analytics?range=24h", ownerCookie)).json()).scheduler).toEqual({ useBestCallTime: true, maxDeferHours: 12 });
    } finally {
      await db.appSettings.update({
        where: { id: "singleton" },
        data: {
          alertMinSuccessRate: before.alertMinSuccessRate,
          dailyReportHour: before.dailyReportHour,
          dailyReportEnabled: before.dailyReportEnabled,
          useBestCallTime: before.useBestCallTime,
          bestCallMaxDeferHours: before.bestCallMaxDeferHours,
        },
      });
    }
  });
});
