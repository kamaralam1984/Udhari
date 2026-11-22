"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PhoneCall, ShieldOff, ShieldCheck, Receipt } from "lucide-react";
import { api, ApiError, formatInrClient, formatDateClient, formatDateTimeClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface CustomerDetail {
  id: string;
  name: string;
  phoneNumber: string;
  whatsappNumber: string | null;
  address: string | null;
  outstandingAmount: string;
  preferredLanguage: string;
  doNotCall: boolean;
  doNotCallReason: string | null;
  lastPaymentDate: string | null;
  lastPromiseDate: string | null;
  lastPromiseAmount: string | null;
  notes: string | null;
  calls: { id: string; status: string; mode: string; createdAt: string; summary: string | null }[];
  promises: {
    id: string;
    promisedAmount: string;
    promisedDate: string;
    remainingAmount: string | null;
    remainingDueDate: string | null;
    status: string;
  }[];
  staffTasks: { id: string; type: string; status: string; title: string }[];
  orders: { id: string; orderNumber: string; totalAmount: string; paidAmount: string; status: string; orderDate: string }[];
  cashCollections: { id: string; receiptNumber: string; amount: string; collectedAt: string }[];
  reminderLogs: { id: string; channel: string; kind: string; status: string; createdAt: string }[];
  followUps: { id: string; scheduledDate: string; reason: string; status: string; attemptCount: number; maxAttempts: number }[];
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [togglingDnc, setTogglingDnc] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ customer: CustomerDetail }>(`/api/customers/${id}`);
      setCustomer(data.customer);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Customer detail load nahi hua.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startCall() {
    setStarting(true);
    setError(null);
    try {
      const res = await api.post<{ call: { id: string } }>("/api/calls", { customerId: id, mode: "TEST" });
      router.push(`/calls/${res.call.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Call start nahi ho payi.");
    } finally {
      setStarting(false);
    }
  }

  async function toggleDoNotCall() {
    if (!customer) return;
    const next = !customer.doNotCall;
    const reason = next ? window.prompt("Reason (optional):") ?? undefined : undefined;
    setTogglingDnc(true);
    setError(null);
    try {
      await api.post(`/api/customers/${id}/do-not-call`, { doNotCall: next, reason });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Status update nahi ho paya.");
    } finally {
      setTogglingDnc(false);
    }
  }

  if (loading && !customer) {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Panel key={i}>
              <PanelBody>
                <Skeleton className="h-3 w-24 mb-2" />
                <Skeleton className="h-7 w-32" />
              </PanelBody>
            </Panel>
          ))}
        </div>
      </div>
    );
  }

  if (loadError && !customer) {
    return <ErrorBanner message={loadError} onRetry={() => load()} />;
  }

  if (!customer) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{customer.name}</h1>
          <p className="text-sm text-[var(--text-dim)]">
            {customer.phoneNumber} · <span className="capitalize">{customer.preferredLanguage}</span>
            {customer.address ? ` · ${customer.address}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/orders?customerId=${customer.id}`} className="btn-secondary flex items-center gap-2 text-sm">
            <Receipt size={16} /> New Order
          </Link>
          <button className="btn-secondary flex items-center gap-2 text-sm" disabled={togglingDnc} onClick={toggleDoNotCall}>
            {customer.doNotCall ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
            {togglingDnc ? "Updating…" : customer.doNotCall ? "Allow calls again" : "Mark Do-Not-Call"}
          </button>
          <button className="btn-primary flex items-center gap-2 text-sm" disabled={customer.doNotCall || starting} onClick={startCall}>
            <PhoneCall size={16} />
            {starting ? "Starting…" : "Start Test Call"}
          </button>
        </div>
      </div>

      {customer.doNotCall && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          DO_NOT_CALL active{customer.doNotCallReason ? `: ${customer.doNotCallReason}` : ""}. Automated calls blocked hain jab tak staff isse hatata nahi.
        </div>
      )}
      {error && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>}

      <div className="grid md:grid-cols-3 gap-4">
        <Panel>
          <PanelBody>
            <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide">Outstanding</div>
            <div className="text-2xl font-bold text-[color:var(--gold-bright)] mt-1">{formatInrClient(customer.outstandingAmount)}</div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide">Last Promise</div>
            <div className="text-lg font-semibold mt-1">
              {customer.lastPromiseAmount ? formatInrClient(customer.lastPromiseAmount) : "-"}
            </div>
            <div className="text-xs text-[var(--text-faint)]">{formatDateClient(customer.lastPromiseDate)}</div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide">Last Payment</div>
            <div className="text-lg font-semibold mt-1">{formatDateClient(customer.lastPaymentDate)}</div>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading title="Recent Calls" />
          <div className="table-wrap">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {customer.calls.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/calls/${c.id}`)}>
                    <td>{formatDateTimeClient(c.createdAt)}</td>
                    <td>
                      <Badge value={c.mode} />
                    </td>
                    <td>
                      <Badge value={c.status} />
                    </td>
                    <td className="text-[var(--text-dim)] max-w-xs truncate">{c.summary || "-"}</td>
                  </tr>
                ))}
                {customer.calls.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-[var(--text-faint)] py-6">
                      Abhi tak koi call nahi hui.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PanelBody>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel>
          <PanelBody>
            <PanelHeading title="Promises" />
            <div className="space-y-2">
              {customer.promises.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                  <span>
                    {formatInrClient(p.promisedAmount)} on {formatDateClient(p.promisedDate)}
                    {p.remainingAmount && (
                      <span className="block text-xs text-[color:var(--yellow-bright)]">
                        + baaki {formatInrClient(p.remainingAmount)}
                        {p.remainingDueDate ? ` by ${formatDateClient(p.remainingDueDate)}` : ""}
                      </span>
                    )}
                  </span>
                  <Badge value={p.status} />
                </div>
              ))}
              {customer.promises.length === 0 && <div className="text-xs text-[var(--text-faint)]">Koi promise nahi hai.</div>}
            </div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <PanelHeading title="Staff Tasks" />
            <div className="space-y-2">
              {customer.staffTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                  <span>{t.title}</span>
                  <Badge value={t.status} />
                </div>
              ))}
              {customer.staffTasks.length === 0 && <div className="text-xs text-[var(--text-faint)]">Koi open task nahi hai.</div>}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel>
          <PanelBody>
            <PanelHeading title="Orders" />
            <div className="space-y-2">
              {customer.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2 hover:text-[color:var(--gold-bright)]"
                >
                  <span>
                    {o.orderNumber} · {formatInrClient(o.totalAmount)}
                  </span>
                  <Badge value={o.status} />
                </Link>
              ))}
              {customer.orders.length === 0 && <div className="text-xs text-[var(--text-faint)]">Koi order nahi hai.</div>}
            </div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <PanelHeading title="Cash Payments" />
            <div className="space-y-2">
              {customer.cashCollections.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                  <span>{c.receiptNumber}</span>
                  <span className="text-[var(--text-dim)]">
                    {formatInrClient(c.amount)} · {formatDateClient(c.collectedAt)}
                  </span>
                </div>
              ))}
              {customer.cashCollections.length === 0 && <div className="text-xs text-[var(--text-faint)]">Koi payment nahi hui.</div>}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading title="WhatsApp / SMS History" subtitle="Bills, reminders aur payment receipts jo customer ko bheje gaye." />
          <div className="space-y-2">
            {customer.reminderLogs.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                <span>
                  <Badge value={r.channel} label={r.channel} /> <span className="ml-1">{r.kind.replaceAll("_", " ")}</span>
                </span>
                <span className="text-[var(--text-dim)] flex items-center gap-2">
                  {formatDateTimeClient(r.createdAt)}
                  <Badge value={r.status} />
                </span>
              </div>
            ))}
            {customer.reminderLogs.length === 0 && <div className="text-xs text-[var(--text-faint)]">Abhi tak koi message nahi bheja gaya.</div>}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Follow-up History"
            subtitle="Scheduled follow-ups aur unke attempts — scheduler yahi list use karta hai."
          />
          <div className="space-y-2">
            {customer.followUps.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                <span>
                  {f.reason} <span className="text-[var(--text-faint)]">· due {formatDateClient(f.scheduledDate)}</span>
                </span>
                <span className="text-[var(--text-dim)] flex items-center gap-2">
                  {f.attemptCount}/{f.maxAttempts} attempts
                  <Badge value={f.status} />
                </span>
              </div>
            ))}
            {customer.followUps.length === 0 && <div className="text-xs text-[var(--text-faint)]">Koi follow-up scheduled nahi hai.</div>}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
