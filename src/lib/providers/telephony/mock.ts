import type { OutboundCallHandle, OutboundCallRequest, TelephonyProvider } from "../types";

/** Never dials a real number. Used for TEST MODE and local development. */
export class MockTelephonyProvider implements TelephonyProvider {
  readonly name = "mock";

  async placeCall(req: OutboundCallRequest): Promise<OutboundCallHandle> {
    return {
      providerCallId: `mock_call_${req.callId}_${Date.now()}`,
      status: "RINGING",
    };
  }

  async hangUp(): Promise<void> {
    return;
  }
}
