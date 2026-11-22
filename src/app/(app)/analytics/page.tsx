"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Download,
  FileSpreadsheet,
  FileText,
  Phone,
  PhoneMissed,
  Plus,
  Printer,
  RefreshCw,
  Trophy,
  User as UserIcon,
  X,
} from "lucide-react";
import { api, formatInrClient } from "@/lib/apiClient";
import { bestSlotLabel } from "@/lib/analyticsLabels";
import type { FlowLink, FlowNode, CampaignCard, BestSlot, RiskLevel } from "@/lib/analytics";
import {
  BarChart,
  FlowDiagram,
  Heatmap,
  LineAreaChart,
  MAP_HUB,
  NEON,
  RingGauge,
  WorldMap,
  type MapRoute,
} from "@/components/analytics/charts";

type RangeKey = "24h" | "7d" | "30d" | "custom";
type Tab = "overview" | "campaigns" | "analytics" | "agents" | "customers" | "reports";

interface CompareBlock {
  label: string;
  prev: { total: number; connected: number; promises: number; collected: number; cost: number };
  delta: { total: number | null; connected: number | null; promises: number | null; collected: number | null; cost: number | null };
}

interface AlertRow {
  key: string;
  severity: "warning" | "critical";
  title: string;
  body: string;
}

interface DrillCall {
  id: string;
  status: string;
  paymentIntent: string | null;
  duration: number | null;
  summary: string | null;
  createdAt: string;
  customer: { name: string; phoneNumber: string };
}

interface LiveCall {
  id: string;
  status: string;
  mode: string;
  language: string | null;
  customer: string;
  campaign: { id: string; name: string } | null;
  seconds: number;
  lines: { speaker: string; text: string }[];
}

interface AnalyticsData {
  range: RangeKey;
  rangeLabel: string;
  from: string;
  to: string;
  viewer: { role: string; scope: "all" | "self" };
  alerts: AlertRow[];
  compare: CompareBlock | null;
  roi: { collected: number; cost: number; ratio: number | null; net: number } | null;
  heatmapConnected: number[][];
  bestSlots: BestSlot[];
  generatedAt: string;
  live: { concurrent: number; callsToday: number; collectedToday: number; mode: "TEST" | "MIXED" | "PRODUCTION" };
  totals: { total: number; connected: number; missed: number; failed: number; inQueue: number; avgWaitSec: number; fcr: number; avgConfidence: number; promises: number };
  gauges: { callSuccessRate: number; staffResolutionRate: number; openTasks: number };
  volume: { labels: string[]; connected: number[]; missed: number[]; starts: number[]; stepMs: number };
  wait: { labels: string[]; values: number[] };
  fcr: { labels: string[]; values: number[] };
  heatmap: number[][];
  flow: { nodes: FlowNode[]; links: FlowLink[] };
  campaigns: CampaignCard[];
  agents: { id: string; name: string; role: string; callsInitiated: number; tasksResolved: number; collections: number; collected: number }[];
  ai: { callsHandled: number; avgConfidence: number };
  timeline: { id: string; customer: string; status: string; intent: string | null; summary: string | null; duration: number | null; language: string | null; createdAt: string }[];
  network: { providers: { kind: string; name: string; cost: number; count: number }[]; languages: { language: string; count: number }[]; totalCalls: number };
  trends: {
    monthly: { labels: string[]; total: number[]; connected: number[] };
    efficiency: { labels: string[]; promiseRate: number[]; connectRate: number[]; collected: number[] };
    forecast: { labels: string[]; actual: number[]; planned: number[]; overdueBacklog: number };
  };
  customers: {
    total: number;
    doNotCall: number;
    withOutstanding: number;
    outstandingTotal: number;
    languages: { language: string; count: number }[];
    topOutstanding: {
      id: string;
      name: string;
      phone: string;
      outstanding: number;
      lastPaymentDate: string | null;
      doNotCall: boolean;
      risk: { score: number; level: RiskLevel; reasons: string[] };
    }[];
  } | null;
  collected: { amount: number; count: number };
}

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "analytics", label: "Analytics" },
  { key: "agents", label: "Agents" },
  { key: "customers", label: "Customers" },
  { key: "reports", label: "Reports" },
];

const RANGE_LABEL: Record<RangeKey, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom range" };

/** Approximate primary hosting region of each provider (for the connectivity map only). */
const REGIONS: { match: RegExp; id: string; label: string; lat: number; lon: number }[] = [
  { match: /twilio/i, id: "us-east", label: "USA", lat: 38.9, lon: -77.4 },
  { match: /openai|anthropic|claude|elevenlabs|deepgram|google|gemini/i, id: "us-west", label: "California", lat: 37.4, lon: -122 },
  { match: /exotel|sarvam|bhashini/i, id: "india", label: "Mumbai", lat: 19.1, lon: 72.9 },
  { match: /azure|microsoft/i, id: "europe", label: "Europe", lat: 52.4, lon: 4.9 },
];
const FALLBACK_REGION = { id: "sg", label: "Singapore", lat: 1.35, lon: 103.8 };

function buildRoutes(providers: AnalyticsData["network"]["providers"]): MapRoute[] {
  const map = new Map<string, MapRoute>();
  for (const p of providers) {
    if (/mock|local|stub/i.test(p.name)) continue;
    const r = REGIONS.find((x) => x.match.test(p.name)) ?? FALLBACK_REGION;
    const cur = map.get(r.id) ?? { id: r.id, label: r.label, lat: r.lat, lon: r.lon, count: 0, cost: 0 };
    cur.count += p.count;
    cur.cost += p.cost;
    map.set(r.id, cur);
  }
  return [...map.values()];
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const nf = (n: number) => n.toLocaleString("en-IN");

type DrillOpen = (query: string, title: string) => void;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function bucketQuery(d: AnalyticsData, i: number, group: "all" | "connected" | "missed"): string {
  const from = new Date(d.volume.starts[i]).toISOString();
  const to = new Date(d.volume.starts[i] + d.volume.stepMs).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group=${group}`;
}

function NPanel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`npanel ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="npanel-title">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-6 text-center text-xs text-violet-200/60">{text}</div>;
}

function Sparkline({ values, color = NEON.cyan }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  if (n < 2) return null;
  const pts = values.map((v, i) => `${(i / (n - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function RangeSelect({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <select className="nselect" value={value} onChange={(e) => onChange(e.target.value as RangeKey)} aria-label="Time range">
      {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
        <option key={k} value={k}>
          {RANGE_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

function RealTimePanel({ d, range, setRange, drill }: { d: AnalyticsData; range: RangeKey; setRange: (r: RangeKey) => void; drill: DrillOpen }) {
  return (
    <NPanel title="Real-Time Analytics Panel" right={<RangeSelect value={range} onChange={setRange} />}>
      <div className="mb-1 text-[10px] text-violet-200/70">Connected vs missed calls ({d.totals.total} placed) · click a point for the calls</div>
      <LineAreaChart
        labels={d.volume.labels}
        onSelect={(i) => drill(bucketQuery(d, i, "all"), `${d.volume.labels[i]} — calls`)}
        series={[
          { name: "Connected", color: NEON.violet, values: d.volume.connected },
          { name: "Missed / failed", color: NEON.cyan, values: d.volume.missed },
        ]}
      />
    </NPanel>
  );
}

function WaitPanel({ d, drill }: { d: AnalyticsData; drill: DrillOpen }) {
  return (
    <NPanel title="Average Wait Time" right={<span className="nchip">{d.totals.avgWaitSec ? `${d.totals.avgWaitSec}s avg` : "—"}</span>}>
      <BarChart
        labels={d.wait.labels}
        series={[{ name: "Wait (sec)", color: NEON.violet, values: d.wait.values }]}
        yFormat={(v) => `${Math.round(v)}s`}
        unit="s"
        maxLabels={3}
        height={110}
        onSelect={(i) => drill(bucketQuery(d, i, "connected"), `${d.wait.labels[i]} — connected calls`)}
      />
    </NPanel>
  );
}

function FcrPanel({ d, drill }: { d: AnalyticsData; drill: DrillOpen }) {
  return (
    <NPanel title="First Call Resolution Rate" right={<span className="nchip">{d.totals.connected ? `${d.totals.fcr}%` : "—"}</span>}>
      <BarChart
        labels={d.fcr.labels}
        series={[{ name: "FCR", color: NEON.pink, values: d.fcr.values }]}
        yFormat={(v) => `${Math.round(v)}%`}
        unit="%"
        maxLabels={3}
        height={110}
        onSelect={(i) => drill(bucketQuery(d, i, "connected"), `${d.fcr.labels[i]} — connected calls`)}
      />
    </NPanel>
  );
}

function HeatPanel({ d, drill }: { d: AnalyticsData; drill: DrillOpen }) {
  const [mode, setMode] = useState<"calls" | "pickup">("calls");
  return (
    <NPanel
      title="Peak Call Times"
      right={
        <div className="flex overflow-hidden rounded-md border border-violet-400/30 text-[10px]">
          {(["calls", "pickup"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-2 py-0.5 ${mode === m ? "bg-violet-600 text-white" : "text-violet-200"}`}>
              {m === "calls" ? "Calls" : "Pick-up %"}
            </button>
          ))}
        </div>
      }
    >
      <Heatmap
        grid={d.heatmap}
        connected={d.heatmapConnected}
        mode={mode}
        onSelect={(dow, hour) => drill(`dow=${dow}&hour=${hour}`, `${DAY_NAMES[dow]} ${hour}:00 — last 30 days`)}
      />
      <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-2 py-1.5 text-[10px] text-emerald-100/90">
        <b className="text-emerald-300">Best time to call:</b>{" "}
        {d.bestSlots.length === 0 ? "abhi kam data hai (har slot me 3+ calls chahiye)." : d.bestSlots.map((b) => bestSlotLabel(b)).join("  |  ")}
      </div>
    </NPanel>
  );
}

function FlowPanel({ d }: { d: AnalyticsData }) {
  return (
    <NPanel title="Call Flow Diagram" className="flex-1" right={<span className="nchip">{d.rangeLabel}</span>}>
      <FlowDiagram nodes={d.flow.nodes} links={d.flow.links} />
    </NPanel>
  );
}

function GaugeRow({ d }: { d: AnalyticsData }) {
  const stable = d.gauges.callSuccessRate >= 95;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <NPanel title="Concurrent Calls">
        <div className="text-[10px] text-violet-200/70">Live now</div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-3xl font-bold leading-none text-white tabular-nums">{nf(d.live.concurrent)}</div>
          <div className="w-14">
            <Sparkline values={d.volume.connected} />
          </div>
        </div>
        <div className="mt-1.5 text-[10px] text-violet-200/70">
          Total today: <b className="text-violet-100">{nf(d.live.callsToday)}</b>
        </div>
      </NPanel>
      <NPanel title="Call Success Rate">
        <div className="text-3xl font-bold leading-none text-white tabular-nums">{d.gauges.callSuccessRate.toFixed(2)}%</div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: stable ? NEON.green : NEON.amber }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: stable ? NEON.green : NEON.amber, boxShadow: `0 0 8px ${stable ? NEON.green : NEON.amber}` }} />
          {stable ? "Stable" : "Degraded"}
        </div>
        <div className="mt-1 text-[10px] text-violet-200/70">{d.totals.failed} failed of {d.totals.total}</div>
      </NPanel>
      <NPanel title="Support Availability">
        <div className="flex items-center gap-3">
          <RingGauge value={d.gauges.staffResolutionRate} color={NEON.cyan}>
            <span className="text-[13px]">{Math.round(d.gauges.staffResolutionRate)}%</span>
          </RingGauge>
          <div className="text-[10px] leading-snug text-violet-200/70">
            Staff tasks resolved
            <div className="font-semibold text-violet-100">{d.gauges.openTasks} open</div>
          </div>
        </div>
      </NPanel>
    </div>
  );
}

function CampaignPanel({ d, big = false }: { d: AnalyticsData; big?: boolean }) {
  const [filter, setFilter] = useState<"all" | "active">("all");
  const rows = d.campaigns.filter((c) => filter === "all" || c.active);
  return (
    <NPanel
      title="Campaign Management"
      right={
        <div className="flex items-center gap-1.5">
          {d.viewer.scope === "all" && (
            <Link href="/campaigns" className="nbtn inline-flex items-center gap-1" title="Naya campaign banao ya manage karo">
              <Plus size={10} /> Campaigns
            </Link>
          )}
          <select className="nselect" value={filter} onChange={(e) => setFilter(e.target.value as "all" | "active")} aria-label="Campaign filter">
            <option value="all">All</option>
            <option value="active">Active</option>
          </select>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty text="Koi active campaign nahi." />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1.6fr_1.2fr_0.6fr_auto] gap-2 px-1 text-[9px] uppercase tracking-wide text-violet-300/60">
            <span>Campaign</span>
            <span>Progress</span>
            <span>Success</span>
            <span>Action</span>
          </div>
          {rows.map((c) => (
            <div key={c.key} className={`grid grid-cols-[1.6fr_1.2fr_0.6fr_auto] items-center gap-2 rounded-lg border border-violet-400/15 bg-violet-950/40 px-2 ${big ? "py-3" : "py-2"}`}>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold text-violet-50" title={c.name}>
                  {c.kind === "campaign" && <span className="mr-1 rounded bg-fuchsia-500/25 px-1 text-[8px] uppercase text-fuchsia-200">live</span>}
                  {c.name}
                </div>
                {big && (
                  <div className="text-[10px] text-violet-300/70">
                    {c.key === "recovery" ? `${formatInrClient(c.done)} of ${formatInrClient(c.total)}` : `${nf(c.done)} of ${nf(c.total)}`}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-violet-400/15">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.progress)}%`, background: `linear-gradient(90deg, ${NEON.violet}, ${NEON.cyan})`, boxShadow: `0 0 8px ${NEON.violet}` }} />
                </div>
                <span className="w-9 text-right text-[10px] tabular-nums text-violet-100">{c.progress.toFixed(0)}%</span>
              </div>
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: c.successRate >= 60 ? NEON.green : c.successRate >= 30 ? NEON.amber : NEON.red }}>
                {c.successRate.toFixed(1)}%
              </span>
              <Link href={c.href} className={`nbtn ${c.active ? "nbtn-on" : ""}`}>
                {c.active ? "Active" : "View"}
              </Link>
            </div>
          ))}
        </div>
      )}
    </NPanel>
  );
}

function MapPanel({ d }: { d: AnalyticsData }) {
  const routes = useMemo(() => buildRoutes(d.network.providers), [d.network.providers]);
  const langTotal = d.network.languages.reduce((a, l) => a + l.count, 0);
  return (
    <NPanel title="Global Connectivity Map" className="flex-1" right={<span className="nchip">{MAP_HUB.label}</span>}>
      <WorldMap routes={routes} />
      {d.network.providers.length === 0 ? (
        <div className="mt-2 text-[10px] text-violet-200/60">Is range me koi provider usage log nahi — pehli call ke baad routes yahan dikhenge.</div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-violet-200/80 sm:grid-cols-3">
          {d.network.providers.map((p) => (
            <div key={`${p.kind}-${p.name}`} className="flex items-center justify-between gap-2 border-b border-violet-400/10 pb-0.5">
              <span className="truncate">
                <b className="text-violet-100">{p.name}</b> · {p.kind.toLowerCase().replace("_", " ")}
              </span>
              <span className="tabular-nums">{nf(p.count)} · ₹{p.cost.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
      {langTotal > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {d.network.languages.slice(0, 5).map((l) => (
            <span key={l.language} className="nchip">
              {l.language} {Math.round((l.count / langTotal) * 100)}%
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 text-[9px] text-violet-300/50">Provider regions approximate hain (provider ke primary hosting region ke hisaab se).</div>
    </NPanel>
  );
}

function AlertsStrip({ alerts }: { alerts: AlertRow[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5" role="alert">
      {alerts.map((a) => (
        <div
          key={a.key}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
            a.severity === "critical" ? "border-red-400/40 bg-red-500/10 text-red-100" : "border-amber-400/40 bg-amber-500/10 text-amber-100"
          }`}
        >
          <AlertTriangle size={14} className={a.severity === "critical" ? "mt-0.5 text-red-300" : "mt-0.5 text-amber-300"} />
          <div>
            <b>{a.title}</b> — <span className="opacity-90">{a.body}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Delta({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value === undefined) return null;
  if (value === null) return <span className="text-[10px] text-violet-300/60">naya</span>;
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: value === 0 ? NEON.axis : good ? NEON.green : NEON.red }}>
      <Icon size={11} />
      {Math.abs(value)}%
    </span>
  );
}

function KpiStrip({ d }: { d: AnalyticsData }) {
  const c = d.compare;
  if (!c) return null;
  const items: { label: string; value: string; prev: string; delta: number | null; invert?: boolean; hide?: boolean }[] = [
    { label: "Calls", value: nf(d.totals.total), prev: nf(c.prev.total), delta: c.delta.total },
    { label: "Connected", value: nf(d.totals.connected), prev: nf(c.prev.connected), delta: c.delta.connected },
    { label: "Promises", value: nf(d.totals.promises), prev: nf(c.prev.promises), delta: c.delta.promises },
    { label: "Collected", value: formatInrClient(d.collected.amount), prev: formatInrClient(c.prev.collected), delta: c.delta.collected, hide: d.viewer.scope === "self" },
    { label: "Call cost", value: `₹${(d.roi?.cost ?? 0).toFixed(0)}`, prev: `₹${c.prev.cost.toFixed(0)}`, delta: c.delta.cost, invert: true, hide: d.viewer.scope === "self" },
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items
        .filter((i) => !i.hide)
        .map((i) => (
          <NPanel key={i.label} title={i.label}>
            <div className="flex items-end justify-between gap-2">
              <div className="text-xl font-bold tabular-nums text-white">{i.value}</div>
              <Delta value={i.delta} invert={i.invert} />
            </div>
            <div className="mt-0.5 text-[9px] text-violet-300/60">pichhla period: {i.prev}</div>
          </NPanel>
        ))}
    </div>
  );
}

function RoiPanel({ d }: { d: AnalyticsData }) {
  if (!d.roi) return null;
  const r = d.roi;
  return (
    <NPanel title="Cost vs Collection" right={<span className="nchip">{d.rangeLabel}</span>}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[9px] uppercase text-violet-300/60">Collected</div>
          <div className="text-sm font-bold tabular-nums" style={{ color: NEON.green }}>{formatInrClient(r.collected)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-violet-300/60">Call cost</div>
          <div className="text-sm font-bold tabular-nums" style={{ color: NEON.amber }}>₹{r.cost.toFixed(0)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-violet-300/60">Net</div>
          <div className="text-sm font-bold tabular-nums" style={{ color: r.net >= 0 ? NEON.cyan : NEON.red }}>{formatInrClient(r.net)}</div>
        </div>
      </div>
      <div className="mt-2 rounded-lg border border-violet-400/15 bg-violet-950/40 px-2 py-1.5 text-center text-[11px] text-violet-100">
        {r.ratio === null ? "Abhi koi call cost record nahi hai." : <>Har <b>₹1</b> kharch par <b style={{ color: NEON.green }}>₹{r.ratio}</b> wapas aaya</>}
      </div>
    </NPanel>
  );
}

function LivePanel({ calls }: { calls: LiveCall[] }) {
  return (
    <NPanel
      title="Live Calls"
      right={
        <span className="nchip">
          <span className="live-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full" /> {calls.length} abhi chal rahi
        </span>
      }
    >
      {calls.length === 0 ? (
        <Empty text="Abhi koi call live nahi hai." />
      ) : (
        <ul className="space-y-2">
          {calls.map((c) => (
            <li key={c.id}>
              <Link href={`/calls/${c.id}`} className="block rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-2 transition hover:border-cyan-400/50">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-semibold text-violet-50">{c.customer}</span>
                  <span className="shrink-0 tabular-nums text-cyan-300">
                    {Math.floor(c.seconds / 60)}:{String(c.seconds % 60).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[9px] text-violet-300/70">
                  <span>{c.status === "RINGING" ? "● Ringing" : "● In conversation"}</span>
                  <span>{c.mode}</span>
                  {c.campaign && <span>· {c.campaign.name}</span>}
                </div>
                {c.lines.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-l-2 border-violet-400/30 pl-2 text-[10px] leading-snug">
                    {c.lines.map((l, i) => (
                      <div key={i} className={l.speaker === "AI" ? "text-violet-200" : "text-emerald-200"}>
                        <b>{l.speaker === "AI" ? "AI" : l.speaker === "CUSTOMER" ? "Customer" : "System"}:</b> {l.text}
                      </div>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </NPanel>
  );
}

function DrillModal({ drill, onClose }: { drill: { query: string; title: string } | null; onClose: () => void }) {
  const [rows, setRows] = useState<DrillCall[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!drill) return;
    let alive = true;
    setRows(null);
    setErr(null);
    api
      .get<{ calls: DrillCall[] }>(`/api/analytics/calls?${drill.query}`)
      .then((r) => alive && setRows(r.calls))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Load nahi hua."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [drill, onClose]);
  if (!drill) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={drill.title}>
      <div className="npanel max-h-[80vh] w-full max-w-2xl overflow-hidden !p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-violet-400/20 px-4 py-3">
          <h3 className="npanel-title">{drill.title}</h3>
          <button onClick={onClose} className="rounded p-1 text-violet-200 hover:bg-violet-500/20" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[calc(80vh-3.5rem)] overflow-y-auto p-3">
          {err && <div className="text-xs text-red-300">{err}</div>}
          {!rows && !err && <div className="py-8 text-center text-xs text-violet-200/60">Loading…</div>}
          {rows && rows.length === 0 && <Empty text="Is slot me koi call nahi mili." />}
          {rows && rows.length > 0 && (
            <ul className="space-y-1.5">
              {rows.map((c) => {
                const st = STATUS_STYLE[c.status] ?? { color: NEON.slate, label: c.status };
                return (
                  <li key={c.id}>
                    <Link href={`/calls/${c.id}`} className="flex items-center gap-3 rounded-lg border border-violet-400/10 bg-violet-950/30 px-3 py-2 text-[11px] hover:border-violet-400/40">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-violet-50">{c.customer.name}</div>
                        <div className="truncate text-[10px] text-violet-300/70">{c.summary || c.customer.phoneNumber}</div>
                      </div>
                      <span style={{ color: st.color }} className="shrink-0 text-[10px]">● {st.label}</span>
                      <span className="shrink-0 text-[10px] text-violet-300/60">{timeAgo(c.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, tone = NEON.violet }: { name: string; tone?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${tone}, #4c1d95)` }}>
      {initials || <UserIcon size={11} />}
    </span>
  );
}

function TrackerPanel({ d }: { d: AnalyticsData }) {
  return (
    <NPanel title="Agent Productivity Tracker" right={<span className="nchip">{d.rangeLabel}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-violet-300/60">
              <th className="pb-1 font-medium">Agent</th>
              <th className="pb-1 text-right font-medium">Calls</th>
              <th className="pb-1 text-right font-medium">Tasks</th>
              <th className="pb-1 text-right font-medium">Collected</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-violet-400/10">
              <td className="py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `linear-gradient(135deg, ${NEON.cyan}, #4c1d95)` }}>
                    <Bot size={12} className="text-white" />
                  </span>
                  <div>
                    <div className="font-semibold text-violet-50">AI Voice Agent</div>
                    <div className="text-[9px] text-violet-300/60">{d.ai.avgConfidence}% confidence</div>
                  </div>
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums text-violet-100">{nf(d.ai.callsHandled)}</td>
              <td className="py-1.5 text-right text-violet-300/50">—</td>
              <td className="py-1.5 text-right text-violet-300/50">—</td>
            </tr>
            {d.agents.map((a, i) => (
              <tr key={a.id} className="border-t border-violet-400/10">
                <td className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Avatar name={a.name} tone={i === 0 && a.collected > 0 ? NEON.amber : NEON.violet} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-violet-50">{a.name}</div>
                      <div className="text-[9px] text-violet-300/60">{a.role.toLowerCase()}</div>
                    </div>
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-violet-100">{a.callsInitiated}</td>
                <td className="py-1.5 text-right tabular-nums text-violet-100">{a.tasksResolved}</td>
                <td className="py-1.5 text-right tabular-nums text-violet-100">
                  <span className="inline-flex items-center gap-1">
                    {formatInrClient(a.collected)}
                    {i < 3 && a.collected > 0 && <Trophy size={11} style={{ color: i === 0 ? NEON.amber : i === 1 ? "#cbd5e1" : "#d97706" }} />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NPanel>
  );
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  COMPLETED: { color: NEON.green, label: "Completed" },
  CONNECTED: { color: NEON.cyan, label: "Live" },
  NO_ANSWER: { color: NEON.amber, label: "No answer" },
  BUSY: { color: NEON.amber, label: "Busy" },
  FAILED: { color: NEON.red, label: "Failed" },
  AI_UNCERTAIN: { color: NEON.pink, label: "Review" },
  CALLBACK_REQUESTED: { color: NEON.violet, label: "Callback" },
  WRONG_NUMBER: { color: NEON.red, label: "Wrong no." },
  QUEUED: { color: NEON.slate, label: "Queued" },
  RINGING: { color: NEON.cyan, label: "Ringing" },
};

function TimelinePanel({ d, limit = 6 }: { d: AnalyticsData; limit?: number }) {
  const rows = d.timeline.slice(0, limit);
  return (
    <NPanel title="Customer Interaction Timeline" className="flex-1">
      {rows.length === 0 ? (
        <Empty text="Abhi koi call interaction nahi." />
      ) : (
        <ol className="space-y-2">
          {rows.map((c) => {
            const st = STATUS_STYLE[c.status] ?? { color: NEON.slate, label: c.status };
            const missed = c.status === "NO_ANSWER" || c.status === "BUSY" || c.status === "FAILED";
            return (
              <li key={c.id}>
                <Link href={`/calls/${c.id}`} className="flex gap-2 rounded-lg border border-violet-400/10 bg-violet-950/30 p-2 transition hover:border-violet-400/40">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `${st.color}22`, color: st.color }}>
                    {missed ? <PhoneMissed size={12} /> : <Phone size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-violet-50">{c.customer}</span>
                      <span className="shrink-0 text-[9px] text-violet-300/60">{timeAgo(c.createdAt)}</span>
                    </div>
                    <div className="line-clamp-2 text-[10px] leading-snug text-violet-200/75">{c.summary || "Summary available nahi."}</div>
                    <div className="mt-0.5 flex gap-2 text-[9px]">
                      <span style={{ color: st.color }}>● {st.label}</span>
                      {c.duration != null && <span className="text-violet-300/60">{c.duration}s</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </NPanel>
  );
}

function TrendsPanel({ d }: { d: AnalyticsData }) {
  const t = d.trends;
  return (
    <NPanel title="Performance Trend Graphs">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 text-[10px] font-medium text-violet-200">Monthly Call Volume Trend</div>
          <BarChart
            labels={t.monthly.labels}
            series={[
              { name: "Total", color: NEON.violet, values: t.monthly.total },
              { name: "Connected", color: NEON.cyan, values: t.monthly.connected },
            ]}
          />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium text-violet-200">Agent Efficiency Trends (weekly)</div>
          <BarChart
            labels={t.efficiency.labels}
            series={[
              { name: "Connect %", color: NEON.indigo, values: t.efficiency.connectRate },
              { name: "Promise %", color: NEON.pink, values: t.efficiency.promiseRate },
            ]}
            yFormat={(v) => `${Math.round(v)}%`}
            unit="%"
            maxLabels={4}
          />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium text-violet-200">System Load Forecast</div>
          <LineAreaChart
            height={130}
            labels={t.forecast.labels}
            maxLabels={5}
            series={[
              { name: "Calls (actual)", color: NEON.violet, values: [...t.forecast.actual, ...new Array<null>(6).fill(null)] },
              { name: "Planned follow-ups", color: NEON.cyan, dashed: true, values: [...new Array<null>(6).fill(null), ...t.forecast.planned] },
            ]}
          />
          {t.forecast.overdueBacklog > 0 && <div className="text-[9px] text-amber-300/80">+{t.forecast.overdueBacklog} overdue follow-ups aaj ke load me joda gaya.</div>}
        </div>
      </div>
    </NPanel>
  );
}

function CustomersView({ d }: { d: AnalyticsData }) {
  const c = d.customers;
  const [sort, setSort] = useState<"amount" | "risk">("risk");
  if (!c) return <Empty text="Customer financial data sirf owner/admin dekh sakte hain." />;
  const langMax = Math.max(1, ...c.languages.map((l) => l.count));
  const rows = [...c.topOutstanding].sort((a, b) => (sort === "risk" ? b.risk.score - a.risk.score || b.outstanding - a.outstanding : b.outstanding - a.outstanding));
  const high = c.topOutstanding.filter((r) => r.risk.level === "HIGH").length;
  const stats = [
    { label: "Total customers", value: nf(c.total), color: NEON.violet },
    { label: "With outstanding", value: nf(c.withOutstanding), color: NEON.amber },
    { label: "Total outstanding", value: formatInrClient(c.outstandingTotal), color: NEON.pink },
    { label: "High-risk (top 25)", value: nf(high), color: NEON.red },
  ];
  const levelColor = { LOW: NEON.green, MEDIUM: NEON.amber, HIGH: NEON.red } as const;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <NPanel key={s.label} title={s.label}>
            <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>
              {s.value}
            </div>
          </NPanel>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.8fr_1fr]">
        <NPanel
          title="Outstanding Customers & Payment Risk"
          right={
            <div className="flex overflow-hidden rounded-md border border-violet-400/30 text-[10px]">
              {(["risk", "amount"] as const).map((m) => (
                <button key={m} onClick={() => setSort(m)} className={`px-2 py-0.5 ${sort === m ? "bg-violet-600 text-white" : "text-violet-200"}`}>
                  {m === "risk" ? "Risk" : "Amount"}
                </button>
              ))}
            </div>
          }
        >
          {rows.length === 0 ? (
            <Empty text="Kisi customer ka outstanding nahi hai." />
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wide text-violet-300/60">
                  <th className="pb-1 font-medium">Customer</th>
                  <th className="pb-1 text-right font-medium">Outstanding</th>
                  <th className="pb-1 text-right font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-violet-400/10 align-top">
                    <td className="py-1.5">
                      <Link href={`/customers/${r.id}`} className="font-semibold text-violet-50 hover:underline">
                        {r.name}
                      </Link>
                      {r.doNotCall && <span className="ml-1.5 rounded bg-red-500/20 px-1 text-[9px] text-red-300">DNC</span>}
                      <div className="text-[9px] text-violet-300/60">{r.risk.reasons.length ? r.risk.reasons.join(" · ") : r.phone}</div>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-pink-300">{formatInrClient(r.outstanding)}</td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: levelColor[r.risk.level], background: `${levelColor[r.risk.level]}22` }} title={`Score ${r.risk.score}/100`}>
                        {r.risk.level} · {r.risk.score}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 text-[9px] text-violet-300/50">Risk = toote promises, phone na uthana, payment ko kitne din hue aur balance ka size — ek simple heuristic, prediction nahi.</div>
        </NPanel>
        <NPanel title="Preferred Language">
          <div className="space-y-2">
            {c.languages.map((l) => (
              <div key={l.language}>
                <div className="flex justify-between text-[10px] text-violet-100">
                  <span className="capitalize">{l.language}</span>
                  <span className="tabular-nums">{l.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-violet-400/15">
                  <div className="h-full rounded-full" style={{ width: `${(l.count / langMax) * 100}%`, background: `linear-gradient(90deg, ${NEON.violet}, ${NEON.pink})` }} />
                </div>
              </div>
            ))}
          </div>
        </NPanel>
      </div>
    </div>
  );
}

function ReportsView({ d, query }: { d: AnalyticsData; query: string }) {
  const money = d.viewer.scope === "all";
  const items = [
    { type: "calls", title: "Call log", desc: `Saari calls — status, intent, promise, summary (${d.rangeLabel.toLowerCase()}).`, count: d.totals.total, show: true },
    { type: "collections", title: "Cash collections", desc: `Receipt-wise collection with staff name (${d.rangeLabel.toLowerCase()}).`, count: d.collected.count, show: money },
  ].filter((i) => i.show);
  const btn = "nbtn nbtn-on inline-flex items-center gap-1.5";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((it) => (
        <NPanel key={it.type} title={it.title}>
          <p className="mb-3 text-[11px] text-violet-200/75">{it.desc}</p>
          <div className="mb-3 text-2xl font-bold tabular-nums text-white">{nf(it.count)}</div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/analytics/export?type=${it.type}&format=xlsx&${query}`} className={btn}>
              <FileSpreadsheet size={12} /> Excel
            </a>
            <a href={`/api/analytics/export?type=${it.type}&format=csv&${query}`} className="nbtn inline-flex items-center gap-1.5">
              <Download size={12} /> CSV
            </a>
          </div>
        </NPanel>
      ))}
      <NPanel title="Management summary (PDF)">
        <p className="mb-3 text-[11px] text-violet-200/75">KPIs, call outcomes, staff performance{money ? " aur top outstanding customers (risk ke saath)" : ""} — ek page ka PDF.</p>
        <a href={`/api/analytics/export?type=summary&format=pdf&${query}`} className={btn}>
          <FileText size={12} /> PDF download
        </a>
      </NPanel>
      <NPanel title="Print this page">
        <p className="mb-3 text-[11px] text-violet-200/75">Poora dashboard print karo ya browser ke print dialog se PDF me save karo.</p>
        <button className="nbtn inline-flex items-center gap-1.5" onClick={() => window.print()}>
          <Printer size={12} /> Print
        </button>
      </NPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const STORE_KEY = "analytics-view-v1";
const TAB_KEYS: Tab[] = ["overview", "campaigns", "analytics", "agents", "customers", "reports"];

function todayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<RangeKey>("24h");
  const [from, setFrom] = useState(todayStr(-6));
  const [to, setTo] = useState(todayStr());
  const [compare, setCompare] = useState(false);
  const [restored, setRestored] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<LiveCall[]>([]);
  const [drillState, setDrillState] = useState<{ query: string; title: string } | null>(null);

  // Saved view: URL params win (shareable link), then the last view this browser used.
  useEffect(() => {
    try {
      const url = new URLSearchParams(window.location.search);
      let saved: Record<string, string> = {};
      try {
        saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
      } catch {
        saved = {};
      }
      const pick = (k: string) => url.get(k) ?? saved[k] ?? null;
      const t = pick("tab");
      if (t && (TAB_KEYS as string[]).includes(t)) setTab(t as Tab);
      const r = pick("range");
      if (r === "24h" || r === "7d" || r === "30d" || r === "custom") setRange(r);
      const f = pick("from");
      const tt = pick("to");
      if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) setFrom(f);
      if (tt && /^\d{4}-\d{2}-\d{2}$/.test(tt)) setTo(tt);
      if (pick("compare") === "1") setCompare(true);
    } finally {
      setRestored(true);
    }
  }, []);

  const rangeQuery = useMemo(
    () => (range === "custom" ? `range=custom&from=${from}&to=${to}` : `range=${range}`),
    [range, from, to]
  );
  const fullQuery = `${rangeQuery}${compare ? "&compare=1" : ""}`;

  useEffect(() => {
    if (!restored) return;
    const view = { tab, range, from, to, compare: compare ? "1" : "0" };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(view));
    } catch {
      /* private mode etc. — the page works without it */
    }
    try {
      const qs = new URLSearchParams({ tab, range, ...(range === "custom" ? { from, to } : {}), ...(compare ? { compare: "1" } : {}) });
      window.history.replaceState(null, "", `${window.location.pathname}?${qs.toString()}`);
    } catch {
      /* ignore */
    }
  }, [restored, tab, range, from, to, compare]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api.get<AnalyticsData>(`/api/analytics?${fullQuery}`);
        setData(res);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analytics load nahi ho paya.");
      } finally {
        setLoading(false);
      }
    },
    [fullQuery]
  );

  useEffect(() => {
    if (!restored) return;
    if (range === "custom" && to < from) return; // wait for a valid window
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(true), 30_000);
    return () => clearInterval(t);
  }, [load, restored, range, from, to]);

  // Live calls refresh much faster than the rest of the page (and only while the tab is visible).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api.get<{ calls: LiveCall[] }>("/api/live-calls");
        if (alive) setLive(r.calls);
      } catch {
        /* keep last list */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const drill: DrillOpen = useCallback((query, title) => setDrillState({ query, title }), []);
  const closeDrill = useCallback(() => setDrillState(null), []);

  const staffView = data?.viewer.scope === "self";
  const tabs = TABS.filter((t) => !(staffView && t.key === "customers"));
  const activeTab: Tab = staffView && tab === "customers" ? "overview" : tab;

  function changeRange(r: RangeKey) {
    setRange(r);
  }

  return (
    <div className="neon-page -m-4 min-h-[calc(100vh-4rem)] p-3 sm:p-5 lg:-m-6 lg:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="ntabs" aria-label="Analytics sections">
          {tabs.map((t) => (
            <button key={t.key} className={`ntab ${activeTab === t.key ? "ntab-on" : ""}`} onClick={() => setTab(t.key)} aria-current={activeTab === t.key ? "page" : undefined}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-violet-200/80">
          {data && (
            <span className="nchip" title="TEST mode me calls simulate hoti hain">
              <Activity size={11} className="mr-1 inline" />
              {data.live.mode}
            </span>
          )}
          <RangeSelect value={range} onChange={changeRange} />
          {range === "custom" && (
            <span className="flex items-center gap-1">
              <input type="date" className="nselect" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" />
              <span>→</span>
              <input type="date" className="nselect" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" />
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1" title="Pichhle same-length period se compare karo">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare
          </label>
          {data && <span className="hidden lg:inline">Updated {timeAgo(data.generatedAt)}</span>}
          <button className="nbtn inline-flex items-center gap-1" onClick={() => load()} aria-label="Refresh">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <a className="nbtn inline-flex items-center gap-1" href={`/api/analytics/export?type=calls&format=xlsx&${rangeQuery}`}>
            <Download size={11} /> Excel
          </a>
        </div>
      </div>

      {range === "custom" && to < from && <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">“To” date “From” se pehle nahi ho sakti.</div>}
      {error && <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      {data && <AlertsStrip alerts={data.alerts} />}
      {data && <KpiStrip d={data} />}

      {!data ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="npanel h-48 animate-pulse" />
          ))}
        </div>
      ) : activeTab === "overview" ? (
        <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.15fr)]">
          {/* Left column */}
          <div className="flex flex-col gap-3">
            <RealTimePanel d={data} range={range} setRange={changeRange} drill={drill} />
            <div className="grid grid-cols-2 gap-3">
              <WaitPanel d={data} drill={drill} />
              <FcrPanel d={data} drill={drill} />
            </div>
            <HeatPanel d={data} drill={drill} />
            <FlowPanel d={data} />
          </div>
          {/* Middle + right */}
          <div className="flex flex-col gap-3">
            <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <GaugeRow d={data} />
                {live.length > 0 && <LivePanel calls={live} />}
                <CampaignPanel d={data} />
                <MapPanel d={data} />
              </div>
              <div className="flex flex-col gap-3">
                <TrackerPanel d={data} />
                <RoiPanel d={data} />
                <TimelinePanel d={data} />
              </div>
            </div>
            <TrendsPanel d={data} />
          </div>
        </div>
      ) : activeTab === "campaigns" ? (
        <div className="space-y-3">
          <CampaignPanel d={data} big />
          <div className="grid gap-3 lg:grid-cols-2">
            <FlowPanel d={data} />
            <MapPanel d={data} />
          </div>
        </div>
      ) : activeTab === "analytics" ? (
        <div className="space-y-3">
          <GaugeRow d={data} />
          <div className="grid gap-3 lg:grid-cols-2">
            <RealTimePanel d={data} range={range} setRange={changeRange} drill={drill} />
            <HeatPanel d={data} drill={drill} />
            <WaitPanel d={data} drill={drill} />
            <FcrPanel d={data} drill={drill} />
          </div>
          <RoiPanel d={data} />
          <TrendsPanel d={data} />
        </div>
      ) : activeTab === "agents" ? (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <TrackerPanel d={data} />
            <LivePanel calls={live} />
            {!staffView && (
              <NPanel title="Weekly Collections (₹)">
                <BarChart labels={data.trends.efficiency.labels} series={[{ name: "Collected", color: NEON.green, values: data.trends.efficiency.collected }]} yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))} height={150} />
              </NPanel>
            )}
          </div>
          <TimelinePanel d={data} limit={12} />
        </div>
      ) : activeTab === "customers" ? (
        <CustomersView d={data} />
      ) : (
        <ReportsView d={data} query={rangeQuery} />
      )}

      <DrillModal drill={drillState} onClose={closeDrill} />
    </div>
  );
}
