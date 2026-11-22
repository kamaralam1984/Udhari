import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL || "owner@maachandrakala.local";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || "Owner@12345";
  const ownerName = process.env.SEED_OWNER_NAME || "Owner";

  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  const owner = await db.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: { name: ownerName, email: ownerEmail, passwordHash, role: "OWNER" },
  });
  console.log(`Owner user ready: ${owner.email}`);

  await db.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      mode: (process.env.APP_MODE as "TEST" | "PRODUCTION") || "TEST",
      minGapHoursBetweenCalls: parseInt(process.env.ANTI_SPAM_MIN_GAP_HOURS || "24", 10),
      maxAttemptsPerDay: parseInt(process.env.ANTI_SPAM_MAX_ATTEMPTS_PER_DAY || "1", 10),
      maxAttemptsPerPromise: parseInt(process.env.ANTI_SPAM_MAX_ATTEMPTS_PER_PROMISE || "3", 10),
      quietHoursStart: parseInt(process.env.ANTI_SPAM_QUIET_HOURS_START || "21", 10),
      quietHoursEnd: parseInt(process.env.ANTI_SPAM_QUIET_HOURS_END || "9", 10),
      timezone: process.env.TIMEZONE || "Asia/Kolkata",
    },
  });
  console.log("App settings ready (TEST mode by default).");

  const sampleCustomers = [
    { name: "Ramesh Kumar", phoneNumber: "+919835010001", outstandingAmount: 75000, preferredLanguage: "hinglish" },
    { name: "Suresh Sah", phoneNumber: "+919835010002", outstandingAmount: 32000, preferredLanguage: "magahi" },
    { name: "Anita Devi", phoneNumber: "+919835010003", outstandingAmount: 18500, preferredLanguage: "hindi" },
    { name: "Manoj Yadav", phoneNumber: "+919835010004", outstandingAmount: 120000, preferredLanguage: "hinglish" },
    { name: "Pooja Kumari", phoneNumber: "+919835010005", outstandingAmount: 5400, preferredLanguage: "hindi" },
    { name: "Birendra Mahto", phoneNumber: "+919835010006", outstandingAmount: 96000, preferredLanguage: "magahi" },
  ];

  for (const c of sampleCustomers) {
    await db.customer.upsert({
      where: { phoneNumber: c.phoneNumber },
      update: {},
      create: c,
    });
  }
  console.log(`Seeded ${sampleCustomers.length} sample customers.`);

  const sampleLanguageTests = [
    "10 din baad pachaas हजार दे देंगे",
    "अगिला सोमर के पचास हजार देब",
    "अभी बीस हजार दे सकत हैं",
    "पइसा पहिले ही दे दिए हैं",
    "अभी पैसा नइखे, थोड़ा टाइम दीजिए",
  ];
  for (const text of sampleLanguageTests) {
    const existing = await db.languageTest.findFirst({ where: { inputText: text } });
    if (!existing) {
      await db.languageTest.create({ data: { inputText: text, createdById: owner.id } });
    }
  }
  console.log(`Seeded ${sampleLanguageTests.length} sample language-lab entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
