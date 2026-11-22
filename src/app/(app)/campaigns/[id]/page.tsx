"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Pause, PhoneCall, Play, CheckCheck, Trash2 } from "lucide-react";
import { api, ApiError, formatInrClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
interface Detail {
  campaign: { id: string; name: string; description: string | null; status: Status; startDate: string | null; endDate: string | null; createdBy: string };
  stats: { members: number; called: number; reached: number; promised: number; promisedAmount: number; fulfilled: number; broken: number; collected: number; progress: number; successRate: number };
  members: {
    customerId: string;
    name: string;
    phone: string;
    outstanding: number;
    doNotCall: boolean;
    calls: number;
    lastCallId: string | null;
    promisedAmount: number | null;
    state: "PENDING" | "NO_ANSWER" | "REACHED" | "PROMISED" | "PAID" | "BROKEN";
  }[];
}

const STATE_LABEL: Record<Detail["members"][number]["state"], { label: string; tone: string }> = {
  PENDING: { label: "Call baaki", tone: "neutral" },
  NO_ANSWER: { label: "Phone nahi utha", tone: "yellow" },
  REACHED: { label: "Baat hui", tone: "gold" },
  PROMISED: { label: "Promise mila", tone: "green" },
  PAID: { label: "Payment mila", tone: "green" },
  BROKEN: { label: "Promise toota", tone: "red" },
};

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, me] = await Promise.all([api.get<Detail>(`/api/campaigns/${id}`), api.get<{ user: { role: string } }>("/api/auth/me")]);
      setData(d);
      setRole(me.user.role);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Campaign load nahi hua.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canManage = role === "OWNER" || role === "ADMIN";

  async function setStatus(status: Status) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/campaigns/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update nahi hua.");
    } finally {
      setBusy(false);
    }
  }

  async function callNext() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ done: boolean; message?: string; customer?: { name: string }; call?: { id: string } }>(`/api/campaigns/${id}/call-next`, { mode: "TEST" });
      setNotice(r.done ? r.message ?? "Sabhi ko call ho chuki." : `${r.customer?.name} ko TEST call ki gayi.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Call nahi lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Ye campaign delete karna hai? Calls ki history bachi rahegi.")) return;
    setBusy(true);
    try {
      await api.delete(`/api/campaigns/${id}`);
      router.push("/campaigns");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete nahi hua.");
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        {error ? <ErrorBanner message={error} /> : <Skeleton className="h-40" />}
        <Link href="/campaigns" className="btn-secondary inline-flex text-sm">Wapas</Link>
      </div>
    );
  }
  const { campaign: c, stats: s } = data;

  return (
    <div className="space-y-5">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)]">
        <ArrowLeft size={14} /> Campaigns
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Megaphone size={20} className="mt-1 text-[color:var(--gold-bright)]" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              {c.name} <Badge value={c.status} tone={c.status === "ACTIVE" ? "green" : c.status === "PAUSED" ? "yellow" : c.status === "COMPLETED" ? "gold" : "neutral"} />
            </h1>
            {c.description && <p className="text-sm text-[var(--text-dim)]">{c.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && c.status !== "ACTIVE" && c.status !== "COMPLETED" && (
            <button className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={() => setStatus("ACTIVE")}>
              <Play size={14} /> Start
            </button>
          )}
          {canManage && c.status === "ACTIVE" && (
            <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={() => setStatus("PAUSED")}>
              <Pause size={14} /> Pause
            </button>
          )}
          {canManage && c.status !== "COMPLETED" && (
            <button className="btn-secondary inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={() => setStatus("COMPLETED")}>
              <CheckCheck size={14} /> Complete
            </button>
          )}
          {canManage && c.status !== "ACTIVE" && (
            <button className="btn-danger inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={remove}>
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && <div className="rounded-lg border border-[var(--green)]/40 bg-[var(--green)]/10 px-3 py-2 text-sm text-[var(--green-bright)]">{notice}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Members" value={s.members} tone="neutral" />
        <StatCard label="Called" value={`${s.called} (${s.progress}%)`} tone="gold" />
        <StatCard label="Reached" value={s.reached} tone="green" />
        <StatCard label="Promised" value={`${s.promised} · ${formatInrClient(s.promisedAmount)}`} tone="green" />
        <StatCard label="Collected" value={formatInrClient(s.collected)} tone="green" hint={`Success ${s.successRate}% · ${s.broken} toote`} />
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Members"
            subtitle="Ek click = agle uncalled member ko ek TEST call. Real (PRODUCTION) calls Settings me mode switch ke baad hi lagti hain."
            right={
              c.status === "ACTIVE" ? (
                <button className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={busy} onClick={callNext}>
                  <PhoneCall size={14} /> Next call
                </button>
              ) : (
                <span className="text-xs text-[var(--text-faint)]">Calls ke liye campaign Start karo</span>
              )
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2 text-right">Outstanding</th>
                  <th className="pb-2 text-right">Calls</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.customerId} className="border-t border-[var(--panel-border)]">
                    <td className="py-2">
                      <Link href={`/customers/${m.customerId}`} className="font-medium hover:underline">{m.name}</Link>
                      <div className="text-xs text-[var(--text-dim)]">{m.phone}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatInrClient(m.outstanding)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {m.lastCallId ? <Link href={`/calls/${m.lastCallId}`} className="hover:underline">{m.calls}</Link> : 0}
                    </td>
                    <td className="py-2">
                      <Badge value={m.state} label={STATE_LABEL[m.state].label} tone={STATE_LABEL[m.state].tone} />
                      {m.promisedAmount !== null && <span className="ml-2 text-xs text-[var(--text-dim)]">{formatInrClient(m.promisedAmount)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.members.length === 0 && <p className="py-4 text-sm text-[var(--text-dim)]">Is campaign me abhi koi member nahi hai.</p>}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
