/**
 * Provider-independent contracts. Nothing in this file or its implementers
 * may hardcode a vendor name in logic — vendor selection happens purely via
 * env vars (see registry.ts). Every *_API_KEY / *_PROVIDER value must come
 * from process.env, never a literal in source.
 */

export interface OutboundCallRequest {
  toPhoneNumber: string;
  fromPhoneNumber?: string;
  callId: string; // our internal Call.id, for webhook correlation
  webhookBaseUrl?: string;
}

export interface OutboundCallHandle {
  providerCallId: string;
  status: "QUEUED" | "RINGING" | "FAILED";
}

export interface TelephonyProvider {
  readonly name: string;
  placeCall(req: OutboundCallRequest): Promise<OutboundCallHandle>;
  hangUp(providerCallId: string): Promise<void>;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audioChunk: Buffer | string, opts?: { language?: string }): Promise<TranscriptionResult>;
}

export interface LlmCompletionRequest {
  systemPrompt: string;
  conversationHistory: { role: "system" | "assistant" | "user"; content: string }[];
  language?: string;
}

export interface LlmCompletionResult {
  text: string;
  tokensUsed?: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

export interface SynthesizeSpeechRequest {
  text: string;
  language?: string;
  voiceId?: string;
}

export interface SynthesizeSpeechResult {
  audioUrl: string;
  durationSeconds?: number;
  charactersUsed: number;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(req: SynthesizeSpeechRequest): Promise<SynthesizeSpeechResult>;
}

export interface CustomVoiceConfig {
  voiceId: string;
  consentOnFile: boolean;
}

export interface CustomVoiceProvider {
  readonly name: string;
  readonly supportsCustomVoice: boolean;
  synthesizeWithCustomVoice(
    req: SynthesizeSpeechRequest,
    config: CustomVoiceConfig
  ): Promise<SynthesizeSpeechResult>;
}

export interface MessageSendRequest {
  toPhoneNumber: string;
  body: string;
  /** Some vendors (e.g. WhatsApp Business API) require a pre-approved template name for outbound-initiated messages. */
  templateName?: string;
}

export interface MessageSendResult {
  providerMessageId: string;
  status: "sent" | "queued" | "failed";
}

export interface WhatsAppProvider {
  readonly name: string;
  sendMessage(req: MessageSendRequest): Promise<MessageSendResult>;
}

export interface SmsProvider {
  readonly name: string;
  sendMessage(req: MessageSendRequest): Promise<MessageSendResult>;
}
