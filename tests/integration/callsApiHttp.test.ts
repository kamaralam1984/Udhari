import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createTestCustomer, createCallRow, cleanupCustomer } from "./helpers";

// Separate port from tests/integration/authHttp.test.ts so both HTTP test
// files can run their own `next start` server without colliding.
const PORT = 3412;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;
let staffEmail: string;
const STAFF_PASSWORD = "Staff@12345";
let cookie: string;
let customerId: string;

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not become ready in time");
}

function extractCookie(res: Response): string {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

beforeAll(async () => {
  staffEmail = `staff_calls_${Date.now()}@test.local`;
  await db.user.create({
    data: { name: "Test Staff (calls)", email: staffEmail, passwordHash: await hashPassword(STAFF_PASSWORD), role: "STAFF" },
  });

  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
    detached: true,
  });
  await waitForServer();

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: staffEmail, password: STAFF_PASSWORD }),
  });
  cookie = extractCookie(loginRes);

  const customer = await createTestCustomer();
  customerId = customer.id;
}, 90000);

afterAll(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await cleanupCustomer(customerId);
  await db.user.deleteMany({ where: { email: staffEmail } });
});

describe("GET /api/calls", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/api/calls`);
    expect(res.status).toBe(401);
  });

  it("lists calls for the authenticated user, newest first, with customer included", async () => {
    const a = await createCallRow(customerId);
    await new Promise((r) => setTimeout(r, 5));
    const b = await createCallRow(customerId);

    const res = await fetch(`${BASE}/api/calls?customerId=${customerId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.calls)).toBe(true);
    const ids = body.calls.map((c: { id: string }) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(body.calls[0].customer.id).toBe(customerId);
  });

  it("filters by mode", async () => {
    await cleanupCustomer(customerId);
    const customer = await createTestCustomer();
    customerId = customer.id;
    await createCallRow(customerId, "TEST");

    const res = await fetch(`${BASE}/api/calls?customerId=${customerId}&mode=PRODUCTION`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls.length).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  it("paginates: page 1 returns 50 rows with hasMore=true, page 2 returns the remainder with hasMore=false", async () => {
    await cleanupCustomer(customerId);
    const customer = await createTestCustomer();
    customerId = customer.id;

    const TOTAL = 55;
    for (let i = 0; i < TOTAL; i++) {
      await createCallRow(customerId);
    }

    const page1Res = await fetch(`${BASE}/api/calls?customerId=${customerId}&page=1`, { headers: { Cookie: cookie } });
    expect(page1Res.status).toBe(200);
    const page1 = await page1Res.json();
    expect(page1.calls.length).toBe(50);
    expect(page1.hasMore).toBe(true);

    const page2Res = await fetch(`${BASE}/api/calls?customerId=${customerId}&page=2`, { headers: { Cookie: cookie } });
    expect(page2Res.status).toBe(200);
    const page2 = await page2Res.json();
    expect(page2.calls.length).toBe(TOTAL - 50);
    expect(page2.hasMore).toBe(false);

    const page1Ids = new Set(page1.calls.map((c: { id: string }) => c.id));
    const page2Ids = new Set(page2.calls.map((c: { id: string }) => c.id));
    for (const id of page2Ids) expect(page1Ids.has(id)).toBe(false);
  }, 30000);
});
