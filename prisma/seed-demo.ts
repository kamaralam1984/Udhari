/**
 * Optional DEMO data so the Analytics page has something to draw.
 *   npm run db:seed-demo            -> add ~30 days of fake calls/promises/collections
 *   npm run db:seed-demo -- --clear -> remove everything this script created
 * Everything it creates is tagged (DEMO- ids / "[DEMO]" prefix) so --clear is exact.
 */
import { PrismaClient, type CallStatus, type PaymentIntent } from "@prisma/client";

const db = new PrismaClient();
const DAY = 86_400_000;

async function clear() {
  const calls = await db.call.findMany({ where: { telephonyProviderCallId: { startsWith: "DEMO-" } }, select: { id: true } });
  const ids = calls.map((c) => c.id);
  await db.cashCollection.deleteMany({ where: { receiptNumber: { startsWith: "DEMO-" } } });
  await db.promiseToPay.deleteMany({ where: { callId: { in: ids } } });
  await db.staffTask.deleteMany({ where: { title: { startsWith: "[DEMO]" } } });
  await db.call.deleteMany({ where: { id: { in: ids } } }); // transcripts/usage/summary cascade
  await db.followUp.deleteMany({ where: { reason: { startsWith: "[DEMO]" } } });
  console.log(`Removed ${ids.length} demo calls and related rows.`);
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[], weights: number[]): T => {
  let r = Math.random() * weights.reduce((x, y) => x + y, 0);
  for (let i = 0; i < arr.length; i++) if ((r -= weights[i]) <= 0) return arr[i];
  return arr[arr.length - 1];
};

async function main() {
  if (process.argv.includes("--clear")) return clear();

  const customers = await db.customer.findMany({ take: 20 });
  const users = await db.user.findMany({ where: { isActive: true } });
  if (!customers.length || !users.length) throw new Error("Run `npm run db:seed` first (needs customers + a user).");

  const now = Date.now();
  const statuses: CallStatus[] = ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "AI_UNCERTAIN", "CALLBACK_REQUESTED", "WRONG_NUMBER"];
  const statusW = [55, 18, 7, 2, 8, 6, 4];
  const intents: PaymentIntent[] = ["WILL_PAY", "PARTIAL_PAY", "ALREADY_PAID", "CANNOT_PAY", "REFUSED", "UNCLEAR"];
  const intentW = [38, 14, 10, 14, 8, 16];
  const summaries = [
    "Customer ne is Friday tak payment ka vaada kiya.",
    "Aadha payment abhi, baaki next week dene ko kaha.",
    "Customer ne bataya payment pehle hi ho chuka hai.",
    "Abhi paise nahi hain, 10 din baad call karne ko kaha.",
    "Customer ne call back maanga, shaam ko free hoga.",
    "Awaaz clear nahi thi, staff review chahiye.",
  ];

  let made = 0;
  for (let day = 29; day >= 0; day--) {
    const perDay = Math.round(rnd(6, 16) * (day % 7 === 0 ? 0.4 : 1));
    for (let k = 0; k < perDay; k++) {
      // office-hours-weighted time of day
      const hour = pick([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], [5, 9, 12, 8, 5, 6, 10, 11, 9, 6, 3]);
      const created = new Date(now - day * DAY);
      created.setHours(hour, Math.floor(rnd(0, 60)), Math.floor(rnd(0, 60)));
      if (created.getTime() > now) continue;

      const status = pick(statuses, statusW);
      const connected = !["NO_ANSWER", "BUSY", "FAILED"].includes(status);
      const intent = connected ? pick(intents, intentW) : null;
      const startedAt = connected ? new Date(created.getTime() + rnd(3, 22) * 1000) : null;
      const duration = connected ? Math.round(rnd(25, 160)) : null;
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const staff = users[Math.floor(Math.random() * users.length)];
      const willPromise = intent === "WILL_PAY" || intent === "PARTIAL_PAY";

      const call = await db.call.create({
        data: {
          customerId: customer.id,
          phoneNumber: customer.phoneNumber,
          mode: "TEST",
          telephonyProviderCallId: `DEMO-${made}-${Math.random().toString(36).slice(2, 8)}`,
          status,
          language: customer.preferredLanguage,
          startedAt,
          endedAt: startedAt && duration ? new Date(startedAt.getTime() + duration * 1000) : null,
          duration,
          summary: connected ? summaries[Math.floor(Math.random() * summaries.length)] : null,
          paymentIntent: intent,
          confidence: connected ? Math.round(rnd(0.62, 0.98) * 100) / 100 : null,
          initiatedByUserId: staff.id,
          createdAt: created,
          updatedAt: created,
        },
      });

      for (const [provider, providerName, cost] of [
        ["TELEPHONY", "twilio", rnd(0.4, 1.6)],
        ["STT", "google", rnd(0.1, 0.5)],
        ["LLM", "openai", rnd(0.1, 0.6)],
        ["TTS", "elevenlabs", rnd(0.2, 0.9)],
      ] as const) {
        if (!connected && provider !== "TELEPHONY") continue;
        await db.callUsageLog.create({
          data: { callId: call.id, provider, providerName, durationSeconds: duration, estimatedCost: cost.toFixed(4), createdAt: created },
        });
      }

      if (willPromise) {
        const age = day;
        const status = age > 6 ? pick(["FULFILLED", "BROKEN", "ACTIVE"] as const, [60, 30, 10]) : "ACTIVE";
        await db.promiseToPay.create({
          data: {
            callId: call.id,
            customerId: customer.id,
            promisedAmount: Math.round(rnd(1500, 18000)),
            promisedDate: new Date(created.getTime() + 3 * DAY),
            paymentIntent: intent!,
            confidence: 0.9,
            confirmedByCustomer: true,
            status,
            createdAt: created,
            updatedAt: created,
          },
        });
        if (status === "FULFILLED") {
          await db.cashCollection.create({
            data: {
              customerId: customer.id,
              amount: Math.round(rnd(1500, 18000)),
              collectedAt: new Date(created.getTime() + 2 * DAY),
              collectedById: staff.id,
              receiptNumber: `DEMO-${made}-${Math.random().toString(36).slice(2, 7)}`,
              note: "[DEMO]",
            },
          });
        }
      }
      made++;
    }
  }

  // forward-looking follow-ups (feeds the load forecast) + a few open tasks
  for (let d = 0; d < 7; d++) {
    for (let k = 0; k < Math.round(rnd(1, 5)); k++) {
      await db.followUp.create({
        data: {
          customerId: customers[Math.floor(Math.random() * customers.length)].id,
          scheduledDate: new Date(now + d * DAY + rnd(1, 9) * 3_600_000),
          reason: "[DEMO] payment follow-up",
        },
      });
    }
  }
  for (let i = 0; i < 4; i++) {
    const resolved = i < 2;
    await db.staffTask.create({
      data: {
        type: "AI_UNCERTAIN_REVIEW",
        status: resolved ? "RESOLVED" : "OPEN",
        customerId: customers[i % customers.length].id,
        title: "[DEMO] Review uncertain call",
        description: "Demo task",
        resolvedById: resolved ? users[0].id : null,
        resolvedAt: resolved ? new Date(now - i * DAY) : null,
      },
    });
  }

  console.log(`Created ${made} demo calls (+ promises, collections, usage logs, follow-ups, tasks).`);
  console.log("Remove with: npm run db:seed-demo -- --clear");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
