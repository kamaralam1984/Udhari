import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/antiSpam";
import { sweepDueFollowUps } from "@/lib/followUp/scheduler";
import { emptySlotStats, loadSlotStats, type SlotStats } from "@/lib/followUp/bestTime";
import { dateInAppTz, partsInAppTz } from "@/lib/time";
import { cleanupCustomer, createTestCustomer } from "./helpers";

/** 60% pick-up overall; 2pm is bad (20%), 3pm is great (90%). */
function stats(): SlotStats {
  const s = emptySlotStats();
  for (let d = 0; d < 7; d++) {
    for (let h = 10; h <= 19; h++) {
      s.total[d][h] = 10;
      s.connected[d][h] = h === 14 ? 2 : h === 15 ? 9 : 6;
    }
  }
  return s;
}

const customers: string[] = [];
let original: Awaited<ReturnType<typeof getAppSettings>>;

async function overdueCustomer(scheduledHoursAgo: number, now: Date) {
  const c = await createTestCustomer({ outstandingAmount: 40000 });
  customers.push(c.id);
  const fu = await db.followUp.create({
    data: { customerId: c.id, scheduledDate: new Date(now.getTime() - scheduledHoursAgo * 3_600_000), reason: "[TEST] best time" },
  });
  return { customerId: c.id, followUpId: fu.id };
}

const callsFor = (customerId: string) => db.call.count({ where: { customerId } });

beforeAll(async () => {
  original = await getAppSettings();
  await db.appSettings.update({
    where: { id: "singleton" },
    data: {
      mode: "TEST",
      useBestCallTime: true,
      bestCallMaxDeferHours: 24,
      daysOverdueBeforeAiCall: 1,
      minOutstandingForAiCall: 0,
      quietHoursStart: 21,
      quietHoursEnd: 9,
    },
  });
});

afterAll(async () => {
  for (const id of customers) await cleanupCustomer(id).catch(() => {});
  await db.appSettings.update({
    where: { id: "singleton" },
    data: {
      mode: original.mode,
      useBestCallTime: original.useBestCallTime,
      bestCallMaxDeferHours: original.bestCallMaxDeferHours,
      daysOverdueBeforeAiCall: original.daysOverdueBeforeAiCall,
      minOutstandingForAiCall: original.minOutstandingForAiCall,
      quietHoursStart: original.quietHoursStart,
      quietHoursEnd: original.quietHoursEnd,
    },
  });
});

describe("scheduler: best time to call", () => {
  const bad = dateInAppTz(2026, 10, 25, 14, 10); // 2:10pm — weak pick-up hour
  const good = dateInAppTz(2026, 10, 25, 15, 10); // 3:10pm — strong pick-up hour

  it("holds an eligible AI call during a bad hour and does not burn an attempt", async () => {
    const { customerId, followUpId } = await overdueCustomer(25, bad);
    const r = await sweepDueFollowUps(bad, { slotStats: stats(), customerIds: [customerId] });
    expect(r.aiCallsDeferred).toBe(1);
    expect(r.aiCallsPlaced).toBe(0);
    expect(await callsFor(customerId)).toBe(0);
    const fu = await db.followUp.findUniqueOrThrow({ where: { id: followUpId } });
    expect(fu.status).toBe("PENDING");
    expect(fu.attemptCount).toBe(0);
  });

  it("places the same call once the good hour arrives", async () => {
    const { customerId } = await overdueCustomer(25, good);
    const r = await sweepDueFollowUps(good, { slotStats: stats(), customerIds: [customerId] });
    expect(r.aiCallsDeferred).toBe(0);
    expect(r.aiCallsPlaced).toBe(1);
    expect(await callsFor(customerId)).toBe(1);
  });

  it("stops waiting after the max-defer window, even in a bad hour", async () => {
    const { customerId } = await overdueCustomer(24 * 3, bad); // due 3 days ago -> window long over
    const r = await sweepDueFollowUps(bad, { slotStats: stats(), customerIds: [customerId] });
    expect(r.aiCallsDeferred).toBe(0);
    expect(r.aiCallsPlaced).toBe(1);
  });

  it("is a no-op when the setting is off (calls immediately)", async () => {
    await db.appSettings.update({ where: { id: "singleton" }, data: { useBestCallTime: false } });
    try {
      const { customerId } = await overdueCustomer(25, bad);
      const r = await sweepDueFollowUps(bad, { slotStats: stats(), customerIds: [customerId] });
      expect(r.aiCallsDeferred).toBe(0);
      expect(r.aiCallsPlaced).toBe(1);
    } finally {
      await db.appSettings.update({ where: { id: "singleton" }, data: { useBestCallTime: true } });
    }
  });

  it("calls immediately when there is no call history to learn from", async () => {
    const { customerId } = await overdueCustomer(25, bad);
    const r = await sweepDueFollowUps(bad, { slotStats: emptySlotStats(), customerIds: [customerId] });
    expect(r.aiCallsDeferred).toBe(0);
    expect(r.aiCallsPlaced).toBe(1);
  });

  it("loadSlotStats reads real calls into the right weekday x hour slot (SQL regression)", async () => {
    const c = await createTestCustomer();
    customers.push(c.id);
    const when = new Date(Date.now() - 24 * 3_600_000);
    const p = partsInAppTz(when);
    const dow = (p.weekday + 6) % 7;
    const before = await loadSlotStats("TEST");
    const statuses = ["COMPLETED", "COMPLETED", "AI_UNCERTAIN", "NO_ANSWER"] as const; // 3 connected, 1 not
    for (const status of statuses) {
      await db.call.create({ data: { customerId: c.id, phoneNumber: c.phoneNumber, mode: "TEST", status, createdAt: when } });
    }
    const after = await loadSlotStats("TEST");
    expect(after.total[dow][p.hour] - before.total[dow][p.hour]).toBe(4);
    expect(after.connected[dow][p.hour] - before.connected[dow][p.hour]).toBe(3);
  });
});
