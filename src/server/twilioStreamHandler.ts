import type { WebSocket } from "ws";
import { db } from "@/lib/db";
import { getSttProvider, getTtsProvider } from "@/lib/providers/registry";
import { resolveBhashiniLanguageCode } from "@/lib/providers/bhashiniPipeline";
import { advanceCallTurn } from "@/lib/callEngine/advanceTurn";
import { UtteranceBuffer, DEFAULT_SILENCE_MS } from "./audioBuffer";
import {
  parseTwilioMessage,
  buildMediaFrame,
  ttsDataUriToTwilioFrames,
  mulawBufferToWav,
  type TwilioStartEvent,
  type TwilioMediaEvent,
} from "./audioFraming";

/**
 * Bridges one Twilio Media Streams WebSocket connection (opened via the
 * <Connect><Stream> TwiML built in telephony/twilio.ts) to the same call
 * engine the mock-mode text flow uses: STT -> advanceCallTurn -> TTS ->
 * audio back over the socket. Correlates the connection to our internal
 * Call directly from the `callId` <Parameter> embedded in the TwiML — no DB
 * lookup needed for that, unlike a provider whose stream connection only
 * carries the provider's own call id. The customer's preferredLanguage IS
 * looked up here (once, at stream start) so the STT/TTS language code
 * matches the language callEngine/dialogue.ts is speaking in — see
 * bhashiniPipeline.ts's resolveBhashiniLanguageCode for the vendor mapping.
 */
export function handleTwilioStreamConnection(ws: WebSocket): void {
  let callId: string | null = null;
  let streamSid: string | null = null;
  let buffer: UtteranceBuffer | null = null;
  let processingTurn = false;
  let bridgeLanguage = "hi"; // safe default until the customer's language is loaded in handleStart

  async function sendAiAudio(text: string): Promise<void> {
    if (!streamSid) return;
    const tts = await getTtsProvider().synthesize({ text, language: bridgeLanguage });
    const frames = ttsDataUriToTwilioFrames(tts.audioUrl);
    for (const frame of frames) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(buildMediaFrame(streamSid, frame));
    }
  }

  async function handleUtterance(mulawAudio: Buffer): Promise<void> {
    if (!callId || processingTurn) return;
    processingTurn = true;
    try {
      const wav = mulawBufferToWav(mulawAudio);
      const transcription = await getSttProvider().transcribe(wav, { language: bridgeLanguage });
      if (!transcription.text.trim()) return;
      const result = await advanceCallTurn(callId, transcription.text);
      await sendAiAudio(result.aiLine);
      if (result.done) ws.close();
    } catch (err) {
      console.error("Twilio bridge: turn handling failed", err);
    } finally {
      processingTurn = false;
    }
  }

  function handleStart(event: TwilioStartEvent): void {
    streamSid = event.streamSid;
    const embeddedCallId = event.start?.customParameters?.callId;
    if (!embeddedCallId) {
      console.error("Twilio bridge: start event had no callId parameter — check the <Stream> TwiML in telephony/twilio.ts.");
      return;
    }
    callId = embeddedCallId;
    // Buffer audio immediately (don't block on the DB round-trip below, which
    // would otherwise silently drop any media frames that arrive first).
    buffer = new UtteranceBuffer(DEFAULT_SILENCE_MS, (audio) => void handleUtterance(audio));

    db.call
      .findUnique({ where: { id: embeddedCallId }, include: { customer: true } })
      .then((call) => {
        bridgeLanguage = resolveBhashiniLanguageCode(call?.customer.preferredLanguage);
      })
      .catch((err) => console.error("Twilio bridge: failed to load customer language, staying on default", err));
  }

  ws.on("message", (raw: Buffer) => {
    const event = parseTwilioMessage(raw.toString());
    if (!event) return;

    switch (event.event) {
      case "start":
        handleStart(event as TwilioStartEvent);
        break;
      case "media":
        buffer?.push((event as TwilioMediaEvent).media.payload);
        break;
      case "stop":
        buffer?.close();
        break;
      default:
        break;
    }
  });

  ws.on("close", () => buffer?.close());
  ws.on("error", (err) => {
    console.error("Twilio bridge: WS error", err);
    buffer?.close();
  });
}
