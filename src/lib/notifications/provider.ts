import { db } from "../db";

export type NotificationChannelName = "dashboard" | "whatsapp_stub" | "sms_stub";

function activeChannels(): NotificationChannelName[] {
  const raw = process.env.NOTIFICATION_CHANNELS || "dashboard";
  return raw.split(",").map((c) => c.trim()).filter(Boolean) as NotificationChannelName[];
}

export interface NotificationInput {
  customerId?: string;
  callId?: string;
  title: string;
  body: string;
}

const CHANNEL_TO_DB: Record<NotificationChannelName, "DASHBOARD" | "WHATSAPP_STUB" | "SMS_STUB"> = {
  dashboard: "DASHBOARD",
  whatsapp_stub: "WHATSAPP_STUB",
  sms_stub: "SMS_STUB",
};

/**
 * Provider-independent notification fan-out. Only "dashboard" is a live
 * channel today — it writes a row the UI polls. whatsapp_stub/sms_stub are
 * recorded (so the architecture and history are real) but never call an
 * external API; wiring a real WhatsApp/SMS vendor later means adding a
 * sender here, not changing call-flow code.
 */
export async function sendOwnerNotification(input: NotificationInput) {
  const channels = activeChannels();
  const created = [];
  for (const channel of channels) {
    const row = await db.notification.create({
      data: {
        channel: CHANNEL_TO_DB[channel] ?? "DASHBOARD",
        status: channel === "dashboard" ? "SENT" : "PENDING",
        customerId: input.customerId,
        callId: input.callId,
        title: input.title,
        body: input.body,
      },
    });
    created.push(row);
  }
  return created;
}
