"use client";

import { useEffect, useRef, useState } from "react";

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext || null;
}

/** Live mic input level, as N bars (0-1 each) — a fresh AudioContext per recording session (stream changes every time). */
export function useMicLevelBars(stream: MediaStream | null, barCount = 6): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(barCount).fill(0));

  useEffect(() => {
    if (!stream) {
      setLevels(Array(barCount).fill(0));
      return;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / barCount));
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(Array.from({ length: barCount }, (_, i) => (data[i * step] || 0) / 255));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream, barCount]);

  return levels;
}

/**
 * Live playback level for an <audio> element, as N bars (0-1 each). The
 * Web Audio graph (source→analyser→destination) is wired up ONCE per
 * element instance — createMediaElementSource() throws if called twice on
 * the same element, and once wired, the element's native output is silent
 * by design (the graph replaces it), so re-connecting to ctx.destination is
 * what keeps it audible, not a double-output bug.
 */
export function useAudioLevelBars(audioEl: HTMLAudioElement | null, playing: boolean, barCount = 6): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(barCount).fill(0));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!audioEl || analyserRef.current) return;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    const source = ctx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
    ctxRef.current = ctx;
    return () => {
      ctx.close().catch(() => {});
    };
  }, [audioEl]);

  useEffect(() => {
    if (!playing || !analyserRef.current) {
      setLevels(Array(barCount).fill(0));
      return;
    }
    ctxRef.current?.resume().catch(() => {});
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / barCount));
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(Array.from({ length: barCount }, (_, i) => (data[i * step] || 0) / 255));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, barCount]);

  return levels;
}

/** Vertical equalizer — N bars whose height reflects `levels` (0-1 each), gold or per-color. */
export function EqualizerBars({ levels, color = "var(--gold-bright)", height = 40 }: { levels: number[]; color?: string; height?: number }) {
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {levels.map((lvl, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full transition-[height] duration-75 ease-out"
          style={{ height: `${Math.max(10, Math.min(100, lvl * 100))}%`, background: color, minHeight: 3 }}
        />
      ))}
    </div>
  );
}
