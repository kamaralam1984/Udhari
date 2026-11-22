/**
 * Per-call inbound audio buffering with a pause-based end-of-utterance
 * heuristic: a gap of `silenceMs` between incoming `media` frames is treated
 * as "customer finished speaking" and the buffered audio is flushed.
 *
 * This is a pragmatic MVP heuristic, not real voice-activity detection (no
 * energy/spectral analysis) — it will misfire on customers who pause
 * mid-sentence, and needs a tuning pass against real call audio once wired
 * up. True VAD is explicitly out of scope for this pass.
 */
export class UtteranceBuffer {
  private chunks: Buffer[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly silenceMs: number,
    private readonly onFlush: (audio: Buffer) => void
  ) {}

  push(base64Chunk: string): void {
    if (this.closed) return;
    this.chunks.push(Buffer.from(base64Chunk, "base64"));
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.silenceMs);
  }

  private flush(): void {
    if (this.chunks.length === 0) return;
    const audio = Buffer.concat(this.chunks);
    this.chunks = [];
    this.onFlush(audio);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.chunks = [];
  }
}

export const DEFAULT_SILENCE_MS = 700;
