import { NextResponse } from "next/server";
import { requireSession, authErrorResponse } from "@/lib/auth/guard";
import { dispatchPendingNotifications } from "@/lib/notifications/dispatcher";

/**
 * Manually sends pending owner WhatsApp/SMS notifications now, instead of
 * waiting for Phase D's scheduler (which will call the same
 * dispatchPendingNotifications() on an interval once it exists).
 */
export async function POST() {
  try {
    await requireSession(["OWNER", "ADMIN"]);
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const result = await dispatchPendingNotifications();
  return NextResponse.json({ result });
}
