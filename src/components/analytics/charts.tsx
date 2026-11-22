"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FlowLink, FlowNode } from "@/lib/analytics";

/** Accent palette. Values are CSS variables so Dark and Light each get shades that stay readable (see --n-* in globals.css). */
export const NEON = {
  violet: "var(--n-violet, #8b5cf6)",
  indigo: "var(--n-indigo, #6366f1)",
  cyan: "var(--n-cyan, #22d3ee)",
  pink: "var(--n-pink, #e879f9)",
  green: "var(--n-green, #34d399)",
  amber: "var(--n-amber, #fbbf24)",
  red: "var(--n-red, #fb7185)",
  slate: "var(--n-slate, #64748b)",
  // Theme-aware (see --chart-* in globals.css): pale on dark surfaces, dark on the light theme.
  grid: "var(--chart-grid, rgba(167,139,250,0.14))",
  axis: "var(--chart-axis, rgba(196,181,253,0.65))",
} as const;

/** A translucent version of any colour (works with the CSS-variable palette above). */
export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export type Tone = keyof Pick<typeof NEON, "violet" | "cyan" | "green" | "red" | "amber" | "pink" | "slate" | "indigo">;

/** Track an element's pixel width so SVG charts draw 1:1 (text never scales with the panel). */
function useMeasure<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** True when the user asked the OS for less motion — SMIL <animate> is not covered by the CSS media query, so we skip rendering it. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ---------------------------------------------------------------------------
// Line / area chart with hover read-out
// ---------------------------------------------------------------------------

export interface LineSeries {
  name: string;
  color: string;
  /** null = no data point (e.g. the forecast half of a combined axis). */
  values: (number | null)[];
  dashed?: boolean;
  area?: boolean;
}

export function LineAreaChart({
  labels,
  series,
  height = 150,
  yFormat = (v: number) => String(Math.round(v)),
  maxLabels = 6,
  onSelect,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  maxLabels?: number;
  /** Called with the bucket index when the user clicks the chart (drill-down). */
  onSelect?: (index: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useMeasure<HTMLDivElement>(380);
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const path = (vals: (number | null)[]) => {
    // smooth curve (Catmull-Rom -> cubic bezier) through the non-null points
    const pts = vals.flatMap((v, i) => (v == null ? [] : [[x(i), y(v)] as const]));
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = Math.min(pad.t + ih, Math.max(pad.t, p1[1] + (p2[1] - p0[1]) / 6));
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = Math.min(pad.t + ih, Math.max(pad.t, p2[1] - (p3[1] - p1[1]) / 6));
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
    }
    return d;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <div className="relative" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full h-auto select-none"
        role="img"
        style={onSelect ? { cursor: "pointer" } : undefined}
        onClick={() => hover !== null && onSelect?.(hover)}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / iw) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.38 }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={NEON.grid} strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={NEON.axis}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="9" fill={NEON.axis}>
              {l}
            </text>
          ) : null
        )}
        {series.map((s, si) => (
          <g key={si}>
            {s.area !== false && !s.dashed && n > 1 && (() => {
              const idx = s.values.flatMap((v, i) => (v == null ? [] : [i]));
              if (idx.length < 2) return null;
              return <path d={`${path(s.values)} L${x(idx[idx.length - 1])},${y(0)} L${x(idx[0])},${y(0)} Z`} fill={`url(#${uid}-g${si})`} />;
            })()}
            <path
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${s.color})` }}
            />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgba(255,255,255,0.35)" />
            {series.map((s, si) =>
              s.values[hover] == null ? null : <circle key={si} cx={x(hover)} cy={y(s.values[hover] as number)} r="3.5" fill={s.color} stroke="var(--chart-ring, #0b0720)" strokeWidth="1.5" />
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border nt-tooltip px-2 py-1 text-[10px] leading-tight shadow-lg"
          style={{ left: `${Math.min(78, Math.max(2, (x(hover) / W) * 100 - 10))}%` }}
        >
          <div className="mb-0.5 font-semibold nt-2">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1 nt-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}: <b>{s.values[hover] == null ? "—" : yFormat(s.values[hover] as number)}</b>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-[color:var(--chart-text,#ddd6fe)]">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bars (single or grouped)
// ---------------------------------------------------------------------------

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

export function BarChart({
  labels,
  series,
  height = 120,
  yFormat = (v: number) => String(Math.round(v)),
  maxLabels = 6,
  onSelect,
}: {
  labels: string[];
  series: BarSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  maxLabels?: number;
  onSelect?: (index: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useMeasure<HTMLDivElement>(280);
  const pad = { l: 30, r: 4, t: 6, b: 18 };
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / Math.max(1, n);
  const groupW = slot * 0.72;
  const barW = groupW / series.length;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <div className="relative" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto select-none" onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${uid}-b${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.35 }} />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.5, 1].map((f, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(f * max)} y2={y(f * max)} stroke={NEON.grid} strokeDasharray="2 4" />
            <text x={pad.l - 4} y={y(f * max) + 3} textAnchor="end" fontSize="9" fill={NEON.axis}>
              {yFormat(f * max)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const gx = pad.l + i * slot + (slot - groupW) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(i)} style={onSelect ? { cursor: "pointer" } : undefined}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * ih);
                return (
                  <rect
                    key={si}
                    x={gx + si * barW + 0.5}
                    y={pad.t + ih - h}
                    width={Math.max(1, barW - 1)}
                    height={h}
                    rx="1.5"
                    fill={`url(#${uid}-b${si})`}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                    style={hover === i ? { filter: `drop-shadow(0 0 3px ${s.color})` } : undefined}
                  />
                );
              })}
              {i % every === 0 && (
                <text x={pad.l + i * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize="9" fill={NEON.axis}>
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-1 top-0 z-10 rounded-md border nt-tooltip px-2 py-1 text-[10px] leading-tight">
          <div className="font-semibold nt-2">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="nt-1">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}: <b>{yFormat(s.values[hover] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-[color:var(--chart-text,#ddd6fe)]">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap (weekday x hour)
// ---------------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Heatmap({
  grid,
  connected,
  mode = "calls",
  onSelect,
}: {
  grid: number[][];
  /** per-slot connected counts — needed for the "pickup" mode */
  connected?: number[][];
  mode?: "calls" | "pickup";
  onSelect?: (dow: number, hour: number) => void;
}) {
  const pickup = mode === "pickup" && connected;
  const rate = (d: number, h: number) => (grid[d][h] > 0 ? ((connected![d][h] ?? 0) / grid[d][h]) * 100 : 0);
  const cellValue = (d: number, h: number) => (pickup ? rate(d, h) : grid[d][h]);
  const max = pickup ? 100 : Math.max(1, ...grid.flat());
  const [tip, setTip] = useState<string | null>(null);
  const color = (v: number) => {
    if (v === 0) return "rgba(139,92,246,0.08)";
    const t = v / max;
    // deep indigo -> violet -> pink -> amber
    if (t < 0.34) return `rgba(99,102,241,${0.25 + t * 1.6})`;
    if (t < 0.67) return `rgba(168,85,247,${0.55 + (t - 0.34)})`;
    return `rgba(${232 + Math.round((t - 0.67) * 60)},${121 + Math.round((t - 0.67) * 300)},${249 - Math.round((t - 0.67) * 400)},0.95)`;
  };
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between py-0.5 text-[9px] nt-3" style={{ height: 112 }}>
          {DAYS.map((d) => (
            <span key={d} className="leading-none">
              {d}
            </span>
          ))}
        </div>
        <div className="flex-1">
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))", height: 112 }}>
            {grid.flatMap((row, di) =>
              row.map((calls, h) => {
                const v = cellValue(di, h);
                return (
                  <div
                    key={`${di}-${h}`}
                    className="rounded-[2px] transition-transform hover:scale-125 hover:z-10"
                    style={{ background: color(pickup && calls === 0 ? 0 : v), cursor: onSelect && calls > 0 ? "pointer" : undefined }}
                    onClick={() => calls > 0 && onSelect?.(di, h)}
                    onMouseEnter={() =>
                      setTip(
                        pickup
                          ? `${DAYS[di]} ${h}:00–${h + 1}:00 · ${calls ? `${Math.round(v)}% pickup` : "no calls"} (${calls} call${calls === 1 ? "" : "s"})`
                          : `${DAYS[di]} ${h}:00–${h + 1}:00 · ${calls} call${calls === 1 ? "" : "s"}`
                      )
                    }
                    onMouseLeave={() => setTip(null)}
                    title={`${DAYS[di]} ${h}:00 — ${calls} calls`}
                  />
                );
              })
            )}
          </div>
          <div className="mt-1 flex justify-between text-[9px] nt-3">
            {[0, 4, 8, 12, 16, 20].map((h) => (
              <span key={h}>{h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}</span>
            ))}
            <span>11p</span>
          </div>
        </div>
        <div className="flex w-3 flex-col items-center gap-1">
          <div
            className="w-2 flex-1 rounded-full"
            style={{ height: 112, background: "linear-gradient(to top, rgba(99,102,241,.35), rgba(168,85,247,.8), rgba(251,191,36,.95))" }}
          />
        </div>
      </div>
      <div className="mt-1 h-3 text-[10px] nt-1">{tip ?? (pickup ? "Last 30 days · pick-up rate per slot (click a cell for the calls)" : `Last 30 days · busiest slot ${max} calls${onSelect ? " · click a cell" : ""}`)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ring gauge
// ---------------------------------------------------------------------------

export function RingGauge({
  value,
  size = 74,
  color = NEON.cyan,
  children,
}: {
  value: number;
  size?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: color }} />
            <stop offset="100%" style={{ stopColor: NEON.violet }} />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(139,92,246,0.2)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={`url(#${uid})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset .9s ease", filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold nt-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call flow (sankey)
// ---------------------------------------------------------------------------

export function FlowDiagram({ nodes, links }: { nodes: FlowNode[]; links: FlowLink[] }) {
  const layout = useMemo(() => {
    const W = 420;
    const H = 230;
    const nodeW = 12;
    const gap = 10;
    const cols = Math.max(0, ...nodes.map((n) => n.col)) + 1;
    const colX = (c: number) => (cols <= 1 ? 0 : (c / (cols - 1)) * (W - nodeW - 84));
    const scale = (() => {
      let best = Infinity;
      for (let c = 0; c < cols; c++) {
        const ns = nodes.filter((n) => n.col === c);
        const sum = ns.reduce((a, n) => a + n.value, 0);
        if (!sum) continue;
        best = Math.min(best, (H - gap * (ns.length - 1) - 8) / sum);
      }
      return Number.isFinite(best) ? best : 1;
    })();
    const pos = new Map<string, { x: number; y: number; h: number; out: number; inn: number; node: FlowNode }>();
    for (let c = 0; c < cols; c++) {
      const ns = nodes.filter((n) => n.col === c);
      const used = ns.reduce((a, n) => a + Math.max(4, n.value * scale), 0) + gap * Math.max(0, ns.length - 1);
      let y = (H - used) / 2;
      for (const n of ns) {
        const h = Math.max(4, n.value * scale);
        pos.set(n.id, { x: colX(c), y, h, out: 0, inn: 0, node: n });
        y += h + gap;
      }
    }
    const paths = links.map((l) => {
      const a = pos.get(l.from)!;
      const b = pos.get(l.to)!;
      const w = Math.max(2, l.value * scale);
      const y0 = a.y + a.out + w / 2;
      const y1 = b.y + b.inn + w / 2;
      a.out += w;
      b.inn += w;
      const x0 = a.x + nodeW;
      const x1 = b.x;
      const mx = (x0 + x1) / 2;
      return { d: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`, w, tone: b.node.tone, key: `${l.from}-${l.to}`, value: l.value, to: b.node.label };
    });
    return { W, H, nodeW, pos, paths };
  }, [nodes, links]);

  if (nodes.length === 0) {
    return <div className="py-10 text-center text-xs nt-3">Is range me abhi koi call nahi hui.</div>;
  }

  return (
    <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="w-full h-auto">
      {layout.paths.map((p) => (
        <path key={p.key} d={p.d} fill="none" stroke={NEON[p.tone]} strokeOpacity="0.38" strokeWidth={p.w}>
          <title>{`${p.value} → ${p.to}`}</title>
        </path>
      ))}
      {[...layout.pos.values()].map(({ x, y, h, node }) => (
        <g key={node.id}>
          <rect x={x} y={y} width={layout.nodeW} height={h} rx="3" fill={NEON[node.tone]} style={{ filter: `drop-shadow(0 0 5px ${NEON[node.tone]})` }} />
          <text x={x + layout.nodeW + 5} y={y + Math.min(h / 2, 14) + 1} fontSize="12" fill="var(--chart-strong, #ede9fe)" fontWeight="700">
            {node.value}
          </text>
          <text x={x + layout.nodeW + 5} y={y + Math.min(h / 2, 14) + 13} fontSize="10" fill={NEON.axis}>
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// World connectivity map (dotted land mask + animated routes)
// ---------------------------------------------------------------------------

/**
 * Coarse land mask, 5° per cell, 72 cols (lon -180..180) x 28 rows (lat 80..-60).
 * Each row is a list of inclusive [startCol, endCol] land ranges.
 */
const LAND: [number, number][][] = [
  [[13, 20], [24, 31], [37, 38], [53, 58], [62, 64]],
  [[2, 6], [9, 21], [24, 32], [40, 70]],
  [[1, 8], [9, 23], [25, 33], [38, 71]],
  [[1, 9], [10, 22], [26, 29], [32, 33], [37, 71]],
  [[4, 16], [21, 25], [35, 36], [37, 62], [66, 69]],
  [[7, 25], [34, 36], [38, 66], [68, 69]],
  [[9, 26], [34, 66], [67, 68]],
  [[10, 25], [34, 66], [67, 68]],
  [[11, 25], [34, 66], [67, 68]],
  [[12, 23], [34, 64], [67, 68]],
  [[12, 23], [34, 64]],
  [[13, 22], [33, 48], [50, 58], [63, 64]],
  [[14, 19], [21, 22], [33, 48], [50, 53], [54, 58], [61, 62]],
  [[17, 19], [33, 47], [51, 53], [54, 58], [61, 62]],
  [[18, 25], [34, 48], [52, 52], [55, 57], [59, 61]],
  [[20, 28], [38, 47], [55, 57], [59, 62], [63, 67]],
  [[19, 29], [38, 47], [55, 58], [62, 68]],
  [[19, 29], [39, 47], [57, 60], [64, 68]],
  [[19, 28], [39, 46], [63, 66]],
  [[20, 28], [39, 47], [59, 67]],
  [[21, 28], [39, 46], [59, 67]],
  [[21, 27], [39, 44], [59, 67]],
  [[22, 26], [40, 43], [60, 67]],
  [[22, 25], [41, 42], [61, 66], [70, 71]],
  [[22, 24], [64, 65], [70, 71]],
  [[22, 24], [70, 71]],
  [[22, 24]],
  [[23, 24]],
];

const CELL = 10;
const MAP_W = 72 * CELL;
const MAP_H = 28 * CELL;
const project = (lat: number, lon: number): [number, number] => [((lon + 180) / 5) * CELL + CELL / 2, ((80 - lat) / 5) * CELL + CELL / 2];

export interface MapRoute {
  id: string;
  label: string;
  lat: number;
  lon: number;
  count: number;
  cost: number;
}

export const MAP_HUB = { label: "Customers (India)", lat: 25.4, lon: 86.1 };

export function WorldMap({ routes }: { routes: MapRoute[] }) {
  const dots = useMemo(() => {
    const out: [number, number][] = [];
    LAND.forEach((ranges, r) => {
      for (const [a, b] of ranges) for (let c = a; c <= b; c++) out.push([c * CELL + CELL / 2, r * CELL + CELL / 2]);
    });
    return out;
  }, []);
  const [hub] = [project(MAP_HUB.lat, MAP_HUB.lon)];
  const maxCount = Math.max(1, ...routes.map((r) => r.count));
  const [active, setActive] = useState<string | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  return (
    <div>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto">
        <defs>
          <radialGradient id="mapGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#6d28d9" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6d28d9" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="url(#mapGlow)" />
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.6" fill="#a78bfa" opacity="0.5" />
        ))}
        {routes.map((r) => {
          const [x, y] = project(r.lat, r.lon);
          const dist = Math.hypot(x - hub[0], y - hub[1]);
          if (dist < 4) return null;
          const mx = (x + hub[0]) / 2;
          const my = Math.min(y, hub[1]) - dist * 0.28;
          const w = 1 + (r.count / maxCount) * 2.2;
          const on = active === null || active === r.id;
          return (
            <g key={r.id} opacity={on ? 1 : 0.25}>
              <path d={`M${hub[0]},${hub[1]} Q${mx},${my} ${x},${y}`} fill="none" stroke={NEON.cyan} strokeOpacity="0.25" strokeWidth={w + 2} />
              <path d={`M${hub[0]},${hub[1]} Q${mx},${my} ${x},${y}`} fill="none" stroke={NEON.cyan} strokeWidth={w} strokeDasharray="4 6" strokeLinecap="round">
                {!reduceMotion && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.4s" repeatCount="indefinite" />}
              </path>
            </g>
          );
        })}
        {routes.map((r) => {
          const [x, y] = project(r.lat, r.lon);
          const on = active === null || active === r.id;
          return (
            <g key={`n-${r.id}`} opacity={on ? 1 : 0.3} onMouseEnter={() => setActive(r.id)} onMouseLeave={() => setActive(null)} style={{ cursor: "default" }}>
              <circle cx={x} cy={y} r="9" fill={NEON.pink} opacity="0.18">
                {!reduceMotion && <animate attributeName="r" values="5;11;5" dur="2.6s" repeatCount="indefinite" />}
              </circle>
              <circle cx={x} cy={y} r="3.6" fill={NEON.pink} style={{ filter: `drop-shadow(0 0 5px ${NEON.pink})` }} />
              <text x={x} y={y - 11} textAnchor="middle" fontSize="15" fill="var(--chart-label, #f5d0fe)" fontWeight="600">
                {r.label}
              </text>
            </g>
          );
        })}
        <g>
          <circle cx={hub[0]} cy={hub[1]} r="12" fill={NEON.green} opacity="0.2">
            {!reduceMotion && <animate attributeName="r" values="6;15;6" dur="2.2s" repeatCount="indefinite" />}
          </circle>
          <circle cx={hub[0]} cy={hub[1]} r="4.6" fill={NEON.green} style={{ filter: `drop-shadow(0 0 6px ${NEON.green})` }} />
          <text x={hub[0]} y={hub[1] + 22} textAnchor="middle" fontSize="15" fill="var(--chart-hub, #bbf7d0)" fontWeight="700">
            {MAP_HUB.label}
          </text>
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] nt-3">
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: NEON.green }} /> Customer hub
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: NEON.pink }} /> Provider region
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-0.5 w-3" style={{ background: NEON.cyan }} /> Live route (thickness = usage)
        </span>
      </div>
    </div>
  );
}
