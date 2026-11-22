import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

// Own port, separate from authHttp (3411), calls (3412), customers (3413),
// orders (3414) — each HTTP test file spawns its own `next start` server.
const PORT = 3415;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;
let staffEmail: string;
const STAFF_PASSWORD = "Staff@12345";
const NAME_PREFIX = `CASHTEST_${Date.now()}`;

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
  return { res, cookie: extractCookie(res) };
}

let ownerCookie: string;
let staffCookie: string;
let customerId: string;

beforeAll(async () => {
  staffEmail = `staff_cash_${Date.now()}@test.local`;
  await db.user.create({
    data: { name: "Test Staff (cash)", email: staffEmail, passwordHash: await hashPassword(STAFF_PASSWORD), role: "STAFF" },
  });

  const customer = await db.customer.create({
    data: {
      name: `${NAME_PREFIX}_customer`,
      phoneNumber: `8${Date.now()}`.slice(0, 15),
      outstandingAmount: 5000,
      preferredLanguage: "hinglish",
    },
  });
  customerId = customer.id;

  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
    detached: true,
  });
  await waitForServer();

  const ownerEmail = process.env.SEED_OWNER_EMAIL || "owner@maachandrakala.local";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || "Owner@12345";
  const owner = await login(ownerEmail, ownerPassword);
  expect(owner.res.status).toBe(200);
  ownerCookie = owner.cookie;

  const staff = await login(staffEmail, STAFF_PASSWORD);
  expect(staff.res.status).toBe(200);
  staffCookie = staff.cookie;
}, 90000);

afterAll(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await db.reminderLog.deleteMany({ where: { customerId } });
  await db.followUp.deleteMany({ where: { customerId } });
  await db.cashCollection.deleteMany({ where: { customerId } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.user.deleteMany({ where: { email: staffEmail } });
});

describe("GET /api/cash-collections", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`);
    expect(res.status).toBe(401);
  });

  it("returns a collections list", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.collections)).toBe(true);
  });
});

describe("POST /api/cash-collections", () => {
  it("records a payment and reduces customer outstanding (STAFF allowed)", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookie },
      body: JSON.stringify({ customerId, amount: 1500, note: "test payment" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Number(body.collection.amount)).toBe(1500);
    expect(body.collection.receiptNumber).toMatch(/^RCP-/);

    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(Number(customer.outstandingAmount)).toBe(3500);
  });

  it("clamps outstanding at zero and never goes negative", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ customerId, amount: 999999 }),
    });
    expect(res.status).toBe(201);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(Number(customer.outstandingAmount)).toBe(0);
  });

  it("rejects invalid data (non-positive amount)", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ customerId, amount: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown customer", async () => {
    const res = await fetch(`${BASE}/api/cash-collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ customerId: "does-not-exist", amount: 100 }),
    });
    expect(res.status).toBe(404);
  });
});
