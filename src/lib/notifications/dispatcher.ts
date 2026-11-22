import { db } from "../db";
import { getWhatsAppProvider, getSmsProvider } from "../providers/registry";

export interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
  skippedNoOwnerNumber: number;
}

/**
 * Picks up owner-facing Notification rows still sitting PENDING on the
 * whatsapp_stub/sms_stub channels (written by sendOwnerNotification —
 * src/lib/notifications/provider.ts) and actually sends them through the
 * configured WhatsApp/SMS provider (mock by default). This is the "sender"
 * that provider.ts's own comment says was always the next step — nothing
 * about the call-flow code that writes these rows changes.
 *
 * Called manually today (POST /api/notifications/dispatch); Phase D's
 * scheduler will call this on an interval instead.
 */
export async function dispatchPendingNotifications(): Promise<DispatchResult> {
  const owner = await db.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });

  const pending = await db.notification.findMany({
    where: { status: "PENDING", channel: { in: ["WHATSAPP_STUB", "SMS_STUB"] } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const result: DispatchResult = { attempted: 0, sent: 0, failed: 0, skippedNoOwnerNumber: 0 };

  // Owner's WhatsApp number doubles as the SMS-capable number — there is no
  // separate owner SMS field, and in practice a shop owner's WhatsApp number
  // is their regular mobile number.
  const ownerNumber = owner?.whatsappNumber;
  if (!ownerNumber) {
    result.skippedNoOwnerNumber = pending.length;
    return result;
  }

  for (const row of pending) {
    result.attempted++;
    try {
      const send =
        row.channel === "WHATSAPP_STUB"
          ? await getWhatsAppProvider().sendMessage({ toPhoneNumber: ownerNumber, body: `${row.title}\n\n${row.body}` })
          : await getSmsProvider().sendMessage({ toPhoneNumber: ownerNumber, body: `${row.title}\n${row.body}`.slice(0, 480) });

      await db.notification.update({
        where: { id: row.id },
        data: { status: send.status === "failed" ? "FAILED" : "SENT" },
      });
      if (send.status === "failed") result.failed++;
      else result.sent++;
    } catch {
      await db.notification.update({ where: { id: row.id }, data: { status: "FAILED" } });
      result.failed++;
    }
  }

  return result;
}
