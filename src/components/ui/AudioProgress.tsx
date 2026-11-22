"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, Mic, Square } from "lucide-react";
import clsx from "clsx";

/** Real, XHR-tracked upload progress (0-100) — animated gold sweep fill, not a fake/simulated bar. */
export function UploadProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)] mb-1">
          <span>{label}</span>
          <span>{Math.round(percent)}%</span>
        </div>
      )}
      <div className="upload-track">
        <div className="upload-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}

/**
 * Round "AI understanding" ring. `indeterminate` shows a rotating partial
 * arc while STT/NLU processing is in flight (there's no real granular
 * mid-flight signal from the server to report — this is an honest activity
 * indicator, not a fake percentage). Once a real result lands, pass
 * `indeterminate={false}` with the actual confidence `value` (0-100) and it
 * animates into place as the genuine number, colored by how confident it is.
 */
export function RoundProgress({
  value,
  indeterminate = false,
  size = 64,
  label,
}: {
  value: number;
  indeterminate?: boolean;
  size?: number;
  label?: string;
}) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const tone = clamped >= 70 ? "var(--green-bright)" : clamped >= 40 ? "var(--yellow-bright)" : "var(--red)";
  const offset = indeterminate ? circumference * 0.78 : circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            className={clsx("round-progress-value", indeterminate && "round-progress-spin")}
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={indeterminate ? "var(--gold-bright)" : tone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: indeterminate ? "var(--gold-bright)" : tone }}>
          {indeterminate ? "…" : `${Math.round(clamped)}%`}
        </div>
      </div>
      {label && <div className="text-[10px] text-[var(--text-faint)] text-center max-w-[90px]">{label}</div>}
    </div>
  );
}

/**
 * "Hear the AI's voice" button — plays the given audioUrl, pulsing while
 * live so it's obvious something is actually speaking. When audioUrl is
 * null (mock TTS — no real audio, see providers/tts/mock.ts), the button is
 * disabled and says so, rather than silently doing nothing on click.
 */
export function AudioPlayButton({ audioUrl, autoPlay = false }: { audioUrl: string | null; autoPlay?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (autoPlay && audioUrl && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [audioUrl, autoPlay]);

  function toggle() {
    if (!audioUrl || !audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="round-icon-wrap">
        <button
          type="button"
          className={clsx("round-icon-btn", playing && "is-playing")}
          disabled={!audioUrl}
          onClick={toggle}
          title={audioUrl ? "AI ki awaaz sunein" : "Real awaaz uplabdh nahi — TTS_PROVIDER ko real vendor par set karein"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </span>
      <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
        <Volume2 size={12} />
        {audioUrl ? (playing ? "Bol raha hai…" : "AI ki awaaz sunein") : "Real awaaz uplabdh nahi (mock)"}
      </span>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  );
}

/**
 * Round mic button — same shape/language as AudioPlayButton, so the pair
 * reads as one "voice" control. Pulses red while recording ("listening"),
 * always has the slim rotating gold ring (.round-icon-wrap) even at rest.
 */
export function MicButton({
  recording,
  disabled,
  onToggle,
}: {
  recording: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="round-icon-wrap">
      <button
        type="button"
        className={clsx("round-icon-btn", recording && "is-recording")}
        disabled={disabled}
        onClick={onToggle}
        title={recording ? "Recording rokein aur bhejein" : "Mic se bolna shuru karein"}
      >
        {recording ? <Square size={17} /> : <Mic size={19} />}
      </button>
    </span>
  );
}
