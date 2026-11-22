import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { cleanupCustomer } from "./helpers";
import { dateInAppTz } from "@/lib/time";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/auth/guard", () => ({
  requireSession: vi.fn().mockResolvedValue({ sub: "test-user", email: "t@test.local", name: "Test", role: "STAFF" }),
  authErrorResponse: () => null,
}));

const { GET } = await import("@/app/api/promises/route");

let customerIds: string[] = [];

afterEach(async () => {
  for (const id of customerIds) {
    await cleanupCustomer(id);
  }
  customerIds = [];
});

// The shared helpers.ts createTestCustomer() derives phoneNumber from
// Date.now() + a per-module counter, which collides when several test files
// seed customers in the same millisecond (as happens with the heavy loop
// below). Use a UUID-derived number here instead, unique regardless of timing.
async function createUniqueTestCustomer() {
  return db.customer.create({
    data: {
      name: `TEST_PROMISE_CUSTOMER_${randomUUID()}`,
      phoneNumber: `9${randomUUID().replace(/-/g, "").slice(0, 13)}`,
      outstandingAmount: 75000,
      preferredLanguage: "hinglish",
    },
  });
}

/** One customer + one call + one promise, all wired together (callId is unique per promise). */
async function createPromiseFor(
  customerId: string,
  overrides: Partial<{ promisedDate: Date; status: "ACTIVE" | "FULFILLED" | "BROKEN" | "SUPERSEDED" | "CANCELLED" }> = {}
) {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  const call = await db.call.create({
    data: { customerId, phoneNumber: customer.phoneNumber, mode: "TEST", status: "CONNECTED" },
  });
  return db.promiseToPay.create({
    data: {
      callId: call.id,
      customerId,
      promisedAmount: 5000,
      promisedDate: overrides.promisedDate ?? dateInAppTz(2026, 8, 1, 0, 0, 0),
      paymentIntent: "WILL_PAY",
      confidence: 0.9,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/promises${qs}`);
}

// This DB is shared with a live dev server, so pre-existing rows (seed data,
// other manual testing) can share a status with what a test creates.
// Assertions below scope to the test's own customerId, or compare
// before/after counts, rather than assuming an empty table.
describe("GET /api/promises", () => {
  it("filters by status", async () => {
    const c = await createUniqueTestCustomer();
    customerIds.push(c.id);
    await createPromiseFor(c.id, { status: "ACTIVE" });
    await createPromiseFor(c.id, { status: "BROKEN" });

    const res = await GET(req("?status=ACTIVE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const mine = body.promises.filter((p: { customer: { id: string } }) => p.customer.id === c.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("ACTIVE");
  });

  it("orders by promisedDate ascending", async () => {
    const c = await createUniqueTestCustomer();
    customerIds.push(c.id);
    const later = dateInAppTz(2026, 8, 10, 0, 0, 0);
    const earlier = dateInAppTz(2026, 8, 1, 0, 0, 0);
    await createPromiseFor(c.id, { promisedDate: later, status: "FULFILLED" });
    await createPromiseFor(c.id, { promisedDate: earlier, status: "FULFILLED" });

    const res = await GET(req("?status=FULFILLED"));
    const body = await res.json();
    const mine = body.promises.filter((p: { customer: { id: string } }) => p.customer.id === c.id);
    expect(mine).toHaveLength(2);
    expect(new Date(mine[0].promisedDate).getTime()).toBeLessThan(new Date(mine[1].promisedDate).getTime());
  });

  it("paginates results at 50 per page and reports hasMore", async () => {
    const totalBefore = await db.promiseToPay.count({ where: { status: "CANCELLED" } });

    const c = await createUniqueTestCustomer();
    customerIds.push(c.id);
    const ADDED = 52;
    for (let i = 0; i < ADDED; i++) {
      await createPromiseFor(c.id, { status: "CANCELLED", promisedDate: dateInAppTz(2026, 8, 1 + (i % 27), 0, 0, 0) });
    }
    const totalAfter = totalBefore + ADDED;

    const page1 = await GET(req("?status=CANCELLED&page=1"));
    const body1 = await page1.json();
    expect(body1.promises).toHaveLength(Math.min(50, totalAfter));
    expect(body1.hasMore).toBe(totalAfter > 50);

    const page2 = await GET(req("?status=CANCELLED&page=2"));
    const body2 = await page2.json();
    expect(body2.promises).toHaveLength(Math.max(0, Math.min(50, totalAfter - 50)));
    expect(body2.hasMore).toBe(totalAfter > 100);

    const ids1 = new Set(body1.promises.map((p: { id: string }) => p.id));
    const ids2 = new Set(body2.promises.map((p: { id: string }) => p.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
  }, 30000);
});
