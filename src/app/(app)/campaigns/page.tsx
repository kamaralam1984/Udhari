"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { api, ApiError, formatInrClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface Stats {
  members: number;
  called: number;
  reached: number;
  promised: number;
  promisedAmount: number;
  fulfilled: number;
  broken: number;
  collected: number;
  progress: number;
  successRate: number;
}
interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  startDate: string | null;
  endDate: string | null;
  createdBy: string;
  stats: Stats;
}
interface CustomerLite {
  id: string;
  name: string;
  phoneNumber: string;
  outstandingAmount: string;
  doNotCall: boolean;
}

const TONE: Record<CampaignRow["status"], string> = { DRAFT: "neutral", ACTIVE: "green", PAUSED: "yellow", COMPLETED: "gold" };

export default function CampaignsPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [role, setRole] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const [c, me] = await Promise.all([
        api.get<{ campaigns: CampaignRow[] }>("/api/campaigns"),
        api.get<{ user: { role: string } }>("/api/auth/me"),
      ]);
      setRows(c.campaigns);
      setRole(me.user.role);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Campaigns load nahi ho paye.");
    }
  }
  useEffect(() => {
    load();
  }, []);

  const canManage = role === "OWNER" || role === "ADMIN";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={20} className="text-[color:var(--gold-bright)]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Campaigns</h1>
            <p className="text-sm text-[var(--text-dim)]">Customers ka ek batch banao (jaise “Diwali recovery”) aur uski progress alag track karo.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/analytics?tab=campaigns" className="btn-secondary text-sm">
            Analytics me dekho
          </Link>
          {canManage && (
            <button className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => setShowForm((v) => !v)}>
              <Plus size={14} /> Naya campaign
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {showForm && canManage && (
        <NewCampaignForm
          onDone={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {!rows ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : rows.length === 0 ? (
        <Panel>
          <PanelBody>
            <p className="text-sm text-[var(--text-dim)]">Abhi koi campaign nahi hai. {canManage ? "“Naya campaign” se pehla banao." : "Owner/admin campaign bana sakte hain."}</p>
          </PanelBody>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
              <Panel className="h-full transition hover:border-[color:var(--gold)]/60">
                <PanelBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{c.name}</h2>
                      {c.description && <p className="line-clamp-2 text-xs text-[var(--text-dim)]">{c.description}</p>}
                    </div>
                    <Badge value={c.status} tone={TONE[c.status]} />
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--overlay-3)]">
                    <div className="h-full rounded-full bg-[color:var(--gold-bright)]" style={{ width: `${c.stats.progress}%` }} />
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                    <Cell label="Members" value={c.stats.members} />
                    <Cell label="Called" value={`${c.stats.called}`} />
                    <Cell label="Promised" value={c.stats.promised} />
                    <Cell label="Collected" value={formatInrClient(c.stats.collected)} />
                  </div>
                </PanelBody>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NewCampaignForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [minOutstanding, setMinOutstanding] = useState("0");
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "pick") return;
    const t = setTimeout(() => {
      api
        .get<{ customers: CustomerLite[] }>(`/api/customers?q=${encodeURIComponent(q)}`)
        .then((r) => setCustomers(r.customers.filter((c) => !c.doNotCall)))
        .catch(() => setCustomers([]));
    }, 250);
    return () => clearTimeout(t);
  }, [mode, q]);

  const pickedCount = useMemo(() => picked.size, [picked]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/campaigns", {
        name,
        description: description || undefined,
        startDate: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
        endDate: endDate ? new Date(`${endDate}T23:59:59`).toISOString() : undefined,
        ...(mode === "all"
          ? { includeAllOutstanding: true, minOutstanding: parseFloat(minOutstanding || "0") }
          : { customerIds: [...picked] }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Campaign save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <PanelBody>
        <PanelHeading title="Naya campaign" subtitle="Do-Not-Call customers apne aap hat jate hain." />
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-[var(--text-dim)]">Naam</label>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali recovery drive" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-[var(--text-dim)]">Note (optional)</label>
            <input className="field-input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-dim)]">Start date</label>
            <input type="date" className="field-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-dim)]">End date</label>
            <input type="date" className="field-input" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> Sabhi outstanding customers
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "pick"} onChange={() => setMode("pick")} /> Customers khud chuno
          </label>
        </div>

        {mode === "all" ? (
          <div className="mt-3 max-w-xs">
            <label className="mb-1 block text-xs text-[var(--text-dim)]">Sirf wo jinka outstanding is ₹ se zyada ho</label>
            <input type="number" className="field-input" value={minOutstanding} onChange={(e) => setMinOutstanding(e.target.value)} />
          </div>
        ) : (
          <div className="mt-3">
            <input className="field-input mb-2" placeholder="Naam ya phone se dhundo…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[var(--panel-border)] p-2">
              {customers.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[var(--overlay-2)]">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-[var(--text-dim)]">{formatInrClient(c.outstandingAmount)}</span>
                </label>
              ))}
              {customers.length === 0 && <p className="p-2 text-xs text-[var(--text-dim)]">Koi customer nahi mila.</p>}
            </div>
            <p className="mt-1 text-xs text-[var(--text-dim)]">{pickedCount} chune gaye</p>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button className="btn-primary text-sm" disabled={saving || name.trim().length < 2 || (mode === "pick" && pickedCount === 0)} onClick={submit}>
            {saving ? "Saving…" : "Campaign banao"}
          </button>
        </div>
      </PanelBody>
    </Panel>
  );
}
