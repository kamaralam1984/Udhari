import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

const PORT = 3411;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;
let staffEmail: string;
const STAFF_PASSWORD = "Staff@12345";

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

beforeAll(async () => {
  staffEmail = `staff_${Date.now()}@test.local`;
  await db.user.create({
    data: { name: "Test Staff", email: staffEmail, passwordHash: await hashPassword(STAFF_PASSWORD), role: "STAFF" },
  });

  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
    detached: true, // own process group, so we can kill the whole tree (npx -> next-server) below
  });
  await waitForServer();
}, 90000);

afterAll(async () => {
  // `npx next start` forks a child `next-server` process; killing only the
  // npx wrapper leaves that child running and holding the port. Killing the
  // whole process group (negative pid) takes both down.
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await db.user.deleteMany({ where: { email: staffEmail } });
  // Reset settings mode back to TEST in case a test left it flipped.
  await db.appSettings.update({ where: { id: "singleton" }, data: { mode: "TEST" } }).catch(() => {});
});

describe("HTTP authorization (owner/staff gating)", () => {
  it("rejects unauthenticated requests to a protected API route", async () => {
    const res = await fetch(`${BASE}/api/customers`);
    expect(res.status).toBe(401);
  });

  it("rejects invalid credentials", async () => {
    const { res } = await login(staffEmail, "wrong-password");
    expect(res.status).toBe(401);
  });

  it("logs in a STAFF user but blocks them from activating PRODUCTION mode", async () => {
    const { res: loginRes, cookie } = await login(staffEmail, STAFF_PASSWORD);
    expect(loginRes.status).toBe(200);

    const res = await fetch(`${BASE}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "PRODUCTION" }),
    });
    expect(res.status).toBe(403);
  });

  it("blocks a STAFF user from creating a new customer (OWNER/ADMIN only)", async () => {
    const { cookie } = await login(staffEmail, STAFF_PASSWORD);
    const res = await fetch(`${BASE}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Should Fail", phoneNumber: "+919999999999", outstandingAmount: 1000 }),
    });
    expect(res.status).toBe(403);
  });

  it("allows the OWNER to activate and deactivate PRODUCTION mode", async () => {
    const ownerEmail = process.env.SEED_OWNER_EMAIL || "owner@maachandrakala.local";
    const ownerPassword = process.env.SEED_OWNER_PASSWORD || "Owner@12345";
    const { cookie, res: loginRes } = await login(ownerEmail, ownerPassword);
    expect(loginRes.status).toBe(200);

    const activate = await fetch(`${BASE}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "PRODUCTION" }),
    });
    expect(activate.status).toBe(200);
    const body = await activate.json();
    expect(body.settings.mode).toBe("PRODUCTION");

    const revert = await fetch(`${BASE}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "TEST" }),
    });
    expect(revert.status).toBe(200);
  });
});
