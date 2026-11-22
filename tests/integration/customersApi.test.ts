import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

const PORT = 3413;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;
let staffEmail: string;
const STAFF_PASSWORD = "Staff@12345";
const SEARCH_PREFIX = `PGTEST_${Date.now()}`;
const SEEDED_COUNT = 55;

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

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = extractCookie(res);
  return { res, cookie };
}

let ownerCookie: string;

beforeAll(async () => {
  staffEmail = `staff_${Date.now()}@test.local`;
  await db.user.create({
    data: { name: "Test Staff", email: staffEmail, passwordHash: await hashPassword(STAFF_PASSWORD), role: "STAFF" },
  });

  await db.customer.createMany({
    data: Array.from({ length: SEEDED_COUNT }, (_, i) => ({
      name: `${SEARCH_PREFIX}_${i}`,
      phoneNumber: `9${Date.now()}${String(i).padStart(3, "0")}`,
      outstandingAmount: 1000,
      preferredLanguage: "hinglish",
    })),
  });

  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
    detached: true,
  });
  await waitForServer();

  const ownerEmail = process.env.SEED_OWNER_EMAIL || "owner@maachandrakala.local";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || "Owner@12345";
  const { cookie, res } = await login(ownerEmail, ownerPassword);
  expect(res.status).toBe(200);
  ownerCookie = cookie;
}, 90000);

afterAll(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await db.user.deleteMany({ where: { email: staffEmail } });
  await db.customer.deleteMany({ where: { name: { startsWith: SEARCH_PREFIX } } });
  await db.customer.deleteMany({ where: { name: "API Test Customer" } });
});

describe("GET /api/customers", () => {
  it("returns a customer list", async () => {
    const res = await fetch(`${BASE}/api/customers`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.customers)).toBe(true);
  });

  it("respects the q search filter", async () => {
    const res = await fetch(`${BASE}/api/customers?q=${encodeURIComponent(SEARCH_PREFIX)}`, {
      headers: { Cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customers.length).toBeGreaterThan(0);
    expect(body.customers.every((c: { name: string }) => c.name.startsWith(SEARCH_PREFIX))).toBe(true);
  });

  it("paginates: page 1 returns 50 rows with hasMore true, page 2 returns the remainder with hasMore false", async () => {
    const page1 = await fetch(`${BASE}/api/customers?q=${encodeURIComponent(SEARCH_PREFIX)}&page=1`, {
      headers: { Cookie: ownerCookie },
    });
    expect(page1.status).toBe(200);
    const body1 = await page1.json();
    expect(body1.customers.length).toBe(50);
    expect(body1.hasMore).toBe(true);

    const page2 = await fetch(`${BASE}/api/customers?q=${encodeURIComponent(SEARCH_PREFIX)}&page=2`, {
      headers: { Cookie: ownerCookie },
    });
    expect(page2.status).toBe(200);
    const body2 = await page2.json();
    expect(body2.customers.length).toBe(SEEDED_COUNT - 50);
    expect(body2.hasMore).toBe(false);

    const page1Ids = new Set(body1.customers.map((c: { id: string }) => c.id));
    const overlap = body2.customers.some((c: { id: string }) => page1Ids.has(c.id));
    expect(overlap).toBe(false);
  });
});

describe("POST /api/customers", () => {
  it("creates a customer with valid data (OWNER)", async () => {
    const res = await fetch(`${BASE}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        name: "API Test Customer",
        phoneNumber: `7777${Date.now()}`.slice(0, 15),
        outstandingAmount: 5000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.customer.name).toBe("API Test Customer");
  });

  it("rejects invalid data (missing required fields)", async () => {
    const res = await fetch(`${BASE}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("blocks a STAFF user from creating a customer (OWNER/ADMIN only)", async () => {
    const { cookie } = await login(staffEmail, STAFF_PASSWORD);
    const res = await fetch(`${BASE}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Should Fail", phoneNumber: "+919999999999", outstandingAmount: 1000 }),
    });
    expect(res.status).toBe(403);
  });
});
