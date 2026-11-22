import { randomInt } from "node:crypto";
import { db } from "@/lib/db";

let counter = 0;

/**
 * Test files run as separate vitest worker processes and can call this in
 * the same millisecond, so Date.now()+counter alone isn't unique enough —
 * a random component keeps the generated phoneNumber (which is @unique)
 * collision-free across concurrent processes.
 */
export async function createTestCustomer(overrides: Partial<{ outstandingAmount: number; doNotCall: boolean }> = {}) {
  counter += 1;
  const unique = `${Date.now()}${randomInt(1000, 9999)}${counter}`;
  return db.customer.create({
    data: {
      name: `TEST_CUSTOMER_${unique}`,
      phoneNumber: `9${unique}`.slice(0, 15),
      outstandingAmount: overrides.outstandingAmount ?? 75000,
      preferredLanguage: "hinglish",
      doNotCall: overrides.doNotCall ?? false,
    },
  });
}

export async function createCallRow(customerId: string, mode: "TEST" | "PRODUCTION" = "TEST") {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  return db.call.create({
    data: {
      customerId,
      phoneNumber: customer.phoneNumber,
      mode,
      status: "CONNECTED",
    },
  });
}

/** Deletes a test customer and everything that references it, in FK-safe order. */
export async function cleanupCustomer(customerId: string) {
  const calls = await db.call.findMany({ where: { customerId }, select: { id: true } });
  const callIds = calls.map((c) => c.id);

  await db.notification.deleteMany({ where: { customerId } });
  await db.staffTask.deleteMany({ where: { customerId } });
  await db.auditLog.deleteMany({ where: { promise: { customerId } } });
  await db.promiseToPay.deleteMany({ where: { customerId } });
  if (callIds.length) {
    await db.callUsageLog.deleteMany({ where: { callId: { in: callIds } } });
    await db.callTranscript.deleteMany({ where: { callId: { in: callIds } } });
    await db.callSummary.deleteMany({ where: { callId: { in: callIds } } });
  }
  await db.call.deleteMany({ where: { customerId } });
  await db.followUp.deleteMany({ where: { customerId } });
  await db.customer.delete({ where: { id: customerId } });
}
