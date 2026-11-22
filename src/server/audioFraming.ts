/**
 * Encode/decode helpers for Twilio Media Streams' WebSocket message
 * envelope (used via <Connect><Stream> in the TwiML built by
 * telephony/twilio.ts), plus WAV parsing, a basic linear resampler, and a
 * G.711 mu-law codec to bridge Bhashini's TTS output (WAV, some sample
 * rate) to the 8kHz mu-law audio Twilio's Media Streams protocol requires,
 * and back for inbound audio going to STT.
 *
 * The Media Streams JSON envelope (`start`/`media`/`stop` event shapes) and
 * the 8kHz mu-law encoding requirement are Twilio's stable, documented
 * protocol — high confidence, not a guess. The mu-law codec below is the
 * standard ITU-T G.711 algorithm, also not vendor-specific.
 */

export const TWILIO_MEDIA_SAMPLE_RATE = 8000; // Twilio Media Streams: fixed 8kHz mu-law

export interface TwilioStartEvent {
  event: "start";
  streamSid: string;
  start: {
    streamSid: string;
    callSid: string;
    accountSid?: string;
    customParameters?: Record<string, string>;
  };
}

export interface TwilioMediaEvent {
  event: "media";
  streamSid: string;
  media: { track?: string; chunk?: string; timestamp?: string; payload: string };
}

export interface TwilioStopEvent {
  event: "stop";
  streamSid: string;
}

export type TwilioStreamEvent =
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioStopEvent
  | { event: string; [k: string]: unknown };

export function parseTwilioMessage(raw: string): TwilioStreamEvent | null {
  try {
    return JSON.parse(raw) as TwilioStreamEvent;
  } catch {
    return null;
  }
}

export function buildMediaFrame(streamSid: string, base64Audio: string): string {
  return JSON.stringify({ event: "media", streamSid, media: { payload: base64Audio } });
}

/** Decodes a `data:audio/...;base64,...` URI (as returned by TTS providers) into raw bytes. */
export function decodeDataUri(dataUri: string): Buffer {
  const commaIdx = dataUri.indexOf(",");
  if (!dataUri.startsWith("data:") || commaIdx === -1) {
    throw new Error("Expected a data: URI with base64 payload.");
  }
  return Buffer.from(dataUri.slice(commaIdx + 1), "base64");
}

interface WavPcm {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Int16Array;
}

/** Minimal WAV (PCM) parser — enough to read Bhashini's TTS output. */
export function parseWav(buf: Buffer): WavPcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE buffer.");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (chunkId === "data") {
      dataStart = body;
      dataLength = chunkSize;
    }
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (dataStart === -1 || !sampleRate) throw new Error("WAV buffer missing fmt/data chunks.");

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2);
  }
  return { sampleRate, channels, bitsPerSample, samples };
}

/** Naive linear-interpolation resampler, mono. Good enough for speech at MVP quality. */
export function resampleLinear(samples: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return samples;
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(samples.length * ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, samples.length - 1);
    const frac = srcPos - idx0;
    out[i] = Math.round(samples[idx0] * (1 - frac) + samples[idx1] * frac);
  }
  return out;
}

function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return samples;
  const frameCount = Math.floor(samples.length / channels);
  const mono = new Int16Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c];
    mono[i] = Math.round(sum / channels);
  }
  return mono;
}

// --- G.711 mu-law codec (ITU-T standard, not vendor-specific) --------------

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function linearToMulawSample(sampleIn: number): number {
  let sample = sampleIn;
  const sign = sample < 0 ? 0x80 : 0x00;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function mulawToLinearSample(mulawByte: number): number {
  const u = ~mulawByte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

export function pcm16ToMulaw(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = linearToMulawSample(samples[i]);
  return out;
}

export function mulawToPcm16(mulaw: Buffer): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) out[i] = mulawToLinearSample(mulaw[i]);
  return out;
}

/** Converts a Bhashini WAV data: URI into base64 8kHz mu-law frames for Twilio Media Streams. */
export function ttsDataUriToTwilioFrames(dataUri: string, chunkBytes = 160): string[] {
  const wav = parseWav(decodeDataUri(dataUri));
  const mono = downmixToMono(wav.samples, wav.channels);
  const resampled = resampleLinear(mono, wav.sampleRate, TWILIO_MEDIA_SAMPLE_RATE);
  const mulaw = pcm16ToMulaw(resampled);

  const frames: string[] = [];
  for (let offset = 0; offset < mulaw.length; offset += chunkBytes) {
    frames.push(mulaw.subarray(offset, offset + chunkBytes).toString("base64"));
  }
  return frames;
}

/** Wraps raw PCM16 mono samples in a minimal WAV container — most STT APIs expect a WAV, not headerless PCM. */
export function buildWavBuffer(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  return Buffer.concat([header, data]);
}

/** Converts accumulated raw mu-law bytes (decoded from Twilio `media` payloads) into a WAV buffer for STT. */
export function mulawBufferToWav(mulaw: Buffer): Buffer {
  const pcm = mulawToPcm16(mulaw);
  return buildWavBuffer(pcm, TWILIO_MEDIA_SAMPLE_RATE);
}
