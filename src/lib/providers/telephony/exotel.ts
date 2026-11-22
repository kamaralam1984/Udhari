import type { OutboundCallHandle, OutboundCallRequest, TelephonyProvider } from "../types";

/**
 * Real outbound dialing via Exotel's Call Connect API, routed into a
 * pre-built Exotel App Bazaar Flow that contains a Voicebot Applet pointed
 * at our WSS audio-bridge endpoint (see src/server/exotelStreamHandler.ts).
 *
 * NOTE: endpoint path, auth scheme, and the exact flow-reference field name
 * below are based on Exotel's generally documented Call API shape at the
 * time this was written — verify against Exotel's current developer docs
 * before relying on this in production, and adjust as needed.
 */
export class ExotelTelephonyProvider implements TelephonyProvider {
  readonly name = "exotel";

  private get accountSid(): string {
    const sid = process.env.EXOTEL_ACCOUNT_SID;
    if (!sid) throw new Error("EXOTEL_ACCOUNT_SID is not set.");
    return sid;
  }

  private get apiKey(): string {
    const key = process.env.TELEPHONY_API_KEY;
    if (!key) throw new Error("TELEPHONY_API_KEY is not set.");
    return key;
  }

  private get apiSecret(): string {
    const secret = process.env.TELEPHONY_API_SECRET;
    if (!secret) throw new Error("TELEPHONY_API_SECRET is not set.");
    return secret;
  }

  private get subdomain(): string {
    return process.env.EXOTEL_SUBDOMAIN || "api.exotel.com";
  }

  private get baseUrl(): string {
    return `https://${this.apiKey}:${this.apiSecret}@${this.subdomain}/v1/Accounts/${this.accountSid}`;
  }

  async placeCall(req: OutboundCallRequest): Promise<OutboundCallHandle> {
    const fromNumber = process.env.TELEPHONY_FROM_NUMBER;
    if (!fromNumber) throw new Error("TELEPHONY_FROM_NUMBER is not set.");
    const flowAppId = process.env.EXOTEL_FLOW_APP_ID;
    if (!flowAppId) throw new Error("EXOTEL_FLOW_APP_ID is not set.");
    const webhookBase = req.webhookBaseUrl || process.env.TELEPHONY_WEBHOOK_BASE_URL;
    if (!webhookBase) throw new Error("TELEPHONY_WEBHOOK_BASE_URL is not set.");
    const webhookSecret = process.env.EXOTEL_WEBHOOK_SECRET || "";

    const body = new URLSearchParams({
      From: req.toPhoneNumber,
      CallerId: fromNumber,
      Url: `http://my.exotel.com/${this.accountSid}/exoml/start_voice/${flowAppId}`,
      StatusCallback: `${webhookBase}/api/webhooks/exotel/status?token=${encodeURIComponent(webhookSecret)}`,
      CustomField: req.callId,
    });

    const res = await fetch(`${this.baseUrl}/Calls/connect.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Exotel placeCall failed (${res.status}): ${detail}`);
      return { providerCallId: "", status: "FAILED" };
    }

    const data = (await res.json()) as { Call?: { Sid?: string } };
    const providerCallId = data.Call?.Sid ?? "";
    if (!providerCallId) {
      return { providerCallId: "", status: "FAILED" };
    }
    return { providerCallId, status: "QUEUED" };
  }

  async hangUp(providerCallId: string): Promise<void> {
    const body = new URLSearchParams({ Status: "completed" });
    await fetch(`${this.baseUrl}/Calls/${providerCallId}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }
}
