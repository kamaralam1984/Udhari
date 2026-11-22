import type { MessageSendRequest, MessageSendResult, SmsProvider } from "../types";

/** Never calls a real SMS gateway. Logs the message and resolves immediately — see whatsapp/mock.ts. */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";

  async sendMessage(req: MessageSendRequest): Promise<MessageSendResult> {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[MockSmsProvider] to=${req.toPhoneNumber} body=${JSON.stringify(req.body)}`);
    }
    return {
      providerMessageId: `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "sent",
    };
  }
}
