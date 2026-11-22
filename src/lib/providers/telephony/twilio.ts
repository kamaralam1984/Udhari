import type { OutboundCallHandle, OutboundCallRequest, TelephonyProvider } from "../types";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

function buildTwiml(streamUrl: string, callId: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Connect><Stream url="${streamUrl}">` +
    `<Parameter name="callId" value="${callId}" /></Stream></Connect></Response>`
  );
}

/**
 * Real outbound dialing via Twilio's Calls API. Unlike Exotel, no manual
 * dashboard flow needs to be pre-built — the TwiML that connects the call
 * into our audio bridge (<Connect><Stream>) is generated inline per call,
 * with our internal Call.id embedded as a <Parameter>, so
 * TwilioStreamHandler (src/server/twilioStreamHandler.ts) can read it
 * straight out of the stream's `start` event with no extra DB lookup.
 */
export class TwilioTelephonyProvider implements TelephonyProvider {
  readonly name = "twilio";

  private get accountSid(): string {
    const sid = process.env.TELEPHONY_API_KEY; // Twilio Account SID
    if (!sid) throw new Error("TELEPHONY_API_KEY (Twilio Account SID) is not set.");
    return sid;
  }

  private get authToken(): string {
    const token = process.env.TELEPHONY_API_SECRET; // Twilio Auth Token
    if (!token) throw new Error("TELEPHONY_API_SECRET (Twilio Auth Token) is not set.");
    return token;
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
  }

  async placeCall(req: OutboundCallRequest): Promise<OutboundCallHandle> {
    const fromNumber = process.env.TELEPHONY_FROM_NUMBER;
    if (!fromNumber) throw new Error("TELEPHONY_FROM_NUMBER is not set.");
    const webhookBase = req.webhookBaseUrl || process.env.TELEPHONY_WEBHOOK_BASE_URL;
    if (!webhookBase) throw new Error("TELEPHONY_WEBHOOK_BASE_URL is not set.");

    const wssUrl = webhookBase.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/twilio-stream";
    const statusCallback = `${webhookBase}/api/webhooks/twilio/status?callId=${encodeURIComponent(req.callId)}&token=${encodeURIComponent(process.env.TWILIO_WEBHOOK_SECRET || "")}`;

    const body = new URLSearchParams({
      To: req.toPhoneNumber,
      From: fromNumber,
      Twiml: buildTwiml(wssUrl, req.callId),
      StatusCallback: statusCallback,
      StatusCallbackEvent: "initiated ringing answered completed",
    });

    const res = await fetch(`${TWILIO_API_BASE}/Accounts/${this.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Twilio placeCall failed (${res.status}): ${detail}`);
      return { providerCallId: "", status: "FAILED" };
    }

    const data = (await res.json()) as { sid?: string };
    if (!data.sid) return { providerCallId: "", status: "FAILED" };
    return { providerCallId: data.sid, status: "QUEUED" };
  }

  async hangUp(providerCallId: string): Promise<void> {
    const body = new URLSearchParams({ Status: "completed" });
    await fetch(`${TWILIO_API_BASE}/Accounts/${this.accountSid}/Calls/${providerCallId}.json`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  }
}
