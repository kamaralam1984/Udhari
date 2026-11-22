import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

// Own port, separate from authHttp (3411), calls (3412), customers (3413) —
// each HTTP test file spawns its own `next start` server.
const PORT = 3414;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;
let staffEmail: string;
const STAFF_PASSWORD = "Staff@12345";
const NAME_PREFIX = `ORDERSTEST_${Date.now()}`;

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
  staffEmail = `staff_orders_${Date.now()}@test.local`;
  await db.user.create({
    data: { name: "Test Staff (orders)", email: staffEmail, passwordHash: await hashPassword(STAFF_PASSWORD), role: "STAFF" },
  });

  const customer = await db.customer.create({
    data: {
      name: `${NAME_PREFIX}_customer`,
      phoneNumber: `8${Date.now()}`.slice(0, 15),
      outstandingAmount: 0,
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
  const orders = await db.order.findMany({ where: { customerId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await db.reminderLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.followUp.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.cashCollection.deleteMany({ where: { orderId: { in: orderIds } } });
  }
  await db.order.deleteMany({ where: { customerId } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.user.deleteMany({ where: { email: staffEmail } });
});

describe("GET /api/orders", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/api/orders`);
    expect(res.status).toBe(401);
  });

  it("returns an order list", async () => {
    const res = await fetch(`${BASE}/api/orders`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.orders)).toBe(true);
  });
});

describe("POST /api/orders", () => {
  it("creates an order with computed totals (STAFF allowed)", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookie },
      body: JSON.stringify({
        customerId,
        items: [
          { itemName: "Cement", quantity: 10, unit: "bag", rate: 350 },
          { itemName: "Sand", quantity: 2, unit: "truck", rate: 4000 },
        ],
        paidNow: 1000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Number(body.order.totalAmount)).toBe(11500);
    expect(Number(body.order.paidAmount)).toBe(1000);
    expect(body.order.status).toBe("OPEN");

    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(Number(customer.outstandingAmount)).toBe(10500);
  });

  it("marks the order PAID when paidNow covers the total", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        customerId,
        items: [{ itemName: "Bricks", quantity: 100, rate: 10 }],
        paidNow: 1000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.order.status).toBe("PAID");
  });

  it("rejects invalid data (no items)", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ customerId, items: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown customer", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ customerId: "does-not-exist", items: [{ itemName: "X", quantity: 1, rate: 1 }] }),
    });
    expect(res.status).toBe(404);
  });
});
