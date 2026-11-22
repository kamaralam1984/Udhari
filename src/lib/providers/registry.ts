import { MockTelephonyProvider } from "./telephony/mock";
import { ExotelTelephonyProvider } from "./telephony/exotel";
import { TwilioTelephonyProvider } from "./telephony/twilio";
import { MockSttProvider } from "./stt/mock";
import { BhashiniSttProvider } from "./stt/bhashini";
import { OpenAiSttProvider } from "./stt/openai";
import { MockLlmProvider } from "./llm/mock";
import { OpenAiLlmProvider } from "./llm/openai";
import { MockTtsProvider } from "./tts/mock";
import { BhashiniTtsProvider } from "./tts/bhashini";
import { OpenAiTtsProvider } from "./tts/openai";
import { MockCustomVoiceProvider } from "./customVoice/mock";
import { MockWhatsAppProvider } from "./whatsapp/mock";
import { MockSmsProvider } from "./sms/mock";
import type {
  CustomVoiceProvider,
  LLMProvider,
  SmsProvider,
  SpeechToTextProvider,
  TelephonyProvider,
  TextToSpeechProvider,
  WhatsAppProvider,
} from "./types";

/**
 * Single seam for vendor selection. Every provider is chosen by name from an
 * env var — no vendor SDK or vendor-specific branch lives anywhere else in
 * the app. Adding a real vendor means: implement the interface in this
 * folder, register its name here, and set the env var. No other code changes.
 */

function unsupported(kind: string, providerName: string): never {
  throw new Error(
    `${kind}_PROVIDER="${providerName}" is not implemented yet. ` +
      `Add an implementation under src/lib/providers/${kind.toLowerCase()}/ and register it in registry.ts, ` +
      `or set ${kind}_PROVIDER=mock to keep using the mock in the meantime.`
  );
}

export function getTelephonyProvider(): TelephonyProvider {
  const name = process.env.TELEPHONY_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockTelephonyProvider();
    case "exotel":
      return new ExotelTelephonyProvider();
    case "twilio":
      return new TwilioTelephonyProvider();
    default:
      return unsupported("TELEPHONY", name);
  }
}

export function getSttProvider(): SpeechToTextProvider {
  const name = process.env.STT_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockSttProvider();
    case "bhashini":
      return new BhashiniSttProvider();
    case "openai":
      return new OpenAiSttProvider();
    default:
      return unsupported("STT", name);
  }
}

export function getLlmProvider(): LLMProvider {
  const name = process.env.LLM_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockLlmProvider();
    case "openai":
      return new OpenAiLlmProvider();
    default:
      return unsupported("LLM", name);
  }
}

export function getTtsProvider(): TextToSpeechProvider {
  const name = process.env.TTS_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockTtsProvider();
    case "bhashini":
      return new BhashiniTtsProvider();
    case "openai":
      return new OpenAiTtsProvider();
    default:
      return unsupported("TTS", name);
  }
}

export function getCustomVoiceProvider(): CustomVoiceProvider | null {
  const name = process.env.CUSTOM_VOICE_PROVIDER || "none";
  if (name === "none") return null;
  switch (name) {
    case "mock":
      return new MockCustomVoiceProvider();
    default:
      return unsupported("CUSTOM_VOICE", name);
  }
}

export function getCustomVoiceConfig() {
  return {
    voiceId: process.env.CUSTOM_VOICE_ID || "",
    consentOnFile: process.env.CUSTOM_VOICE_CONSENT_ON_FILE === "true",
  };
}

export function getWhatsAppProvider(): WhatsAppProvider {
  const name = process.env.WHATSAPP_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockWhatsAppProvider();
    default:
      return unsupported("WHATSAPP", name);
  }
}

export function getSmsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER || "mock";
  switch (name) {
    case "mock":
      return new MockSmsProvider();
    default:
      return unsupported("SMS", name);
  }
}

export function getProviderNames() {
  return {
    telephony: process.env.TELEPHONY_PROVIDER || "mock",
    stt: process.env.STT_PROVIDER || "mock",
    llm: process.env.LLM_PROVIDER || "mock",
    tts: process.env.TTS_PROVIDER || "mock",
    customVoice: process.env.CUSTOM_VOICE_PROVIDER || "none",
    whatsapp: process.env.WHATSAPP_PROVIDER || "mock",
    sms: process.env.SMS_PROVIDER || "mock",
  };
}
