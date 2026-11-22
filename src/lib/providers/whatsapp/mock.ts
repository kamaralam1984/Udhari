import type { MessageSendRequest, MessageSendResult, WhatsAppProvider } from "../types";

/**
 * Never calls a real WhatsApp Business API. Logs the message and resolves
 * immediately, so the reminder/dispatch flow can be built and demoed before
 * a real vendor account exists — same mock-first pattern used for
 * telephony/STT/TTS while Bhashini approval was pending.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";

  async sendMessage(req: MessageSendRequest): Promise<MessageSendResult> {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[MockWhatsAppProvider] to=${req.toPhoneNumber} body=${JSON.stringify(req.body)}`);
    }
    return {
      providerMessageId: `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "sent",
    };
  }
}
