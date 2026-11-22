"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PhoneCall,
  PhoneMissed,
  HandCoins,
  ShieldAlert,
  HelpCircle,
  Wallet,
  CheckCircle2,
  Landmark,
  CalendarClock,
  AlertOctagon,
  Banknote,
} from "lucide-react";
import { api, ApiError, formatInrClient, formatDateClient } from "@/lib/apiClient";
import { StatCard } from "@/components/ui/StatCard";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { DashboardTrends } from "@/components/analytics/DashboardTrends";

interface Summary {
  todaysCalls: number;
  connected: number;
  noAnswer: number;
  promisesCaptured: number;
  verificationRequired: number;
  aiUncertain: number;
  estimatedCallCostToday: number;
  totalOutstanding: number;
  todaysDueCount: number;
  overdueCount: number;
  todaysCashCollected: number;
  promisesBrokenOpen: number;
}

interface StaffCollectionRow {
  userId: string;
  userName: string;
  totalAmount: number;
  count: number;
}

interface StaffTaskRow {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  customer: { id: string; name: string };
  call: { id: string } | null;
  createdAt: string;
}

interface FollowUpRow {
  id: string;
  scheduledDate: string;
  reason: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  customer: { id: string; name: string; phoneNumber: string; outstandingAmount: string };
  order: { orderNumber: string } | null;
}

interface BrokenPromiseRow {
  id: string;
  promisedAmount: string;
  promisedDate: string;
  status: string;
  customer: { id: string; name: string; phoneNumber: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<StaffTaskRow[]>([]);
  const [staffCollections, setStaffCollections] = useState<StaffCollectionRow[] | null>(null);
  const [overdueFollowUps, setOverdueFollowUps] = useState<FollowUpRow[]>([]);
  const [brokenPromises, setBrokenPromises] = useState<BrokenPromiseRow[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingOverdue, setLoadingOverdue] = useState(true);
  const [loadingBrokenPromises, setLoadingBrokenPromises] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadTasks() {
    const data = await api.get<{ tasks: StaffTaskRow[] }>("/api/staff-tasks?status=OPEN");
    setTasks(data.tasks);
  }

  async function loadOverdue() {
    const data = await api.get<{ followUps: FollowUpRow[] }>("/api/follow-ups?status=PENDING");
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    setOverdueFollowUps(data.followUps.filter((f) => new Date(f.scheduledDate) < todayStart));
  }

  async function loadBrokenPromises() {
    const data = await api.get<{ promises: BrokenPromiseRow[] }>("/api/promises?status=BROKEN");
    setBrokenPromises(data.promises);
  }

  function loadCore() {
    setLoadError(null);

    api
      .get<Summary>("/api/dashboard/summary")
      .then(setSummary)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Dashboard summary load nahi hui."));

    setLoadingTasks(true);
    loadTasks()
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Staff tasks load nahi hue."))
      .finally(() => setLoadingTasks(false));

    setLoadingOverdue(true);
    loadOverdue()
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Overdue customers load nahi hue."))
      .finally(() => setLoadingOverdue(false));

    setLoadingBrokenPromises(true);
    loadBrokenPromises()
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Broken promises load nahi hue."))
      .finally(() => setLoadingBrokenPromises(false));

    // owner/admin-only endpoint — a STAFF session gets a 403, which we treat
    // as "don't show this panel" rather than surfacing an error.
    api
      .get<{ staffCollections: StaffCollectionRow[] }>("/api/dashboard/staff-collections")
      .then((d) => setStaffCollections(d.staffCollections))
      .catch(() => {});
  }

  useEffect(() => {
    loadCore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolveTask(id: string) {
    setResolvingId(id);
    try {
      await api.patch(`/api/staff-tasks/${id}`, { status: "RESOLVED" });
      await loadTasks();
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">AI Call Dashboard</h1>
          <p className="text-sm text-[var(--text-dim)]">Aaj ka collection-call overview.</p>
        </div>
        <Link href="/customers" className="btn-primary text-sm">
          + Start a call
        </Link>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={loadCore} />}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Outstanding"
          value={summary ? formatInrClient(summary.totalOutstanding) : "—"}
          icon={<Landmark size={16} />}
          tone="gold"
          hint="Across all customers"
        />
        <StatCard label="Due Today" value={summary?.todaysDueCount ?? "—"} icon={<CalendarClock size={16} />} tone="yellow" />
        <StatCard label="Overdue" value={summary?.overdueCount ?? "—"} icon={<AlertOctagon size={16} />} tone="red" />
        <StatCard
          label="Cash Collected Today"
          value={summary ? formatInrClient(summary.todaysCashCollected) : "—"}
          icon={<Banknote size={16} />}
          tone="green"
        />
        <StatCard label="Today's Calls" value={summary?.todaysCalls ?? "—"} icon={<PhoneCall size={16} />} tone="gold" />
        <StatCard label="Connected" value={summary?.connected ?? "—"} icon={<PhoneCall size={16} />} tone="green" />
        <StatCard label="No Answer" value={summary?.noAnswer ?? "—"} icon={<PhoneMissed size={16} />} tone="neutral" />
        <StatCard label="Promises Captured" value={summary?.promisesCaptured ?? "—"} icon={<HandCoins size={16} />} tone="green" />
        <StatCard
          label="Broken Promises"
          value={summary?.promisesBrokenOpen ?? "—"}
          icon={<AlertOctagon size={16} />}
          tone="red"
          hint="Promised date passed, unpaid"
        />
        <StatCard
          label="Verification Required"
          value={summary?.verificationRequired ?? "—"}
          icon={<ShieldAlert size={16} />}
          tone="gold"
          hint="Payment claims awaiting staff check"
        />
        <StatCard label="AI Uncertain" value={summary?.aiUncertain ?? "—"} icon={<HelpCircle size={16} />} tone="red" />
        <StatCard
          label="Estimated Call Cost"
          value={summary ? formatInrClient(summary.estimatedCallCostToday) : "—"}
          icon={<Wallet size={16} />}
          tone="gold"
          hint="Today, across all providers"
        />
      </div>

      <DashboardTrends />

      {staffCollections && staffCollections.length > 0 && (
        <Panel>
          <PanelBody>
            <PanelHeading title="Staff-wise Cash Collection" subtitle="Aaj kis staff ne kitna cash collect kiya." />
            <div className="space-y-2">
              {staffCollections.map((s) => (
                <div key={s.userId} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                  <span>
                    {s.userName} <span className="text-[var(--text-faint)]">· {s.count} payment(s)</span>
                  </span>
                  <span className="font-semibold text-[color:var(--gold-bright)]">{formatInrClient(s.totalAmount)}</span>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Panel warn={overdueFollowUps.length > 0}>
          <PanelBody>
            <PanelHeading title="Overdue Customers" subtitle="Promised/due date nikal chuki, abhi tak follow-up pending hai." />
            <div className="space-y-2">
              {loadingOverdue && (
                <>
                  <Skeleton className="h-5" />
                  <Skeleton className="h-5" />
                  <Skeleton className="h-5" />
                </>
              )}
              {!loadingOverdue &&
                overdueFollowUps.map((f) => (
                <Link
                  key={f.id}
                  href={`/customers/${f.customer.id}`}
                  className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2 hover:text-[color:var(--yellow-bright)]"
                >
                  <span>
                    {f.customer.name}
                    {f.order && <span className="text-[var(--text-faint)]"> · {f.order.orderNumber}</span>}
                  </span>
                  <span className="text-[var(--text-dim)]">
                    Due {formatDateClient(f.scheduledDate)} · {f.attemptCount}/{f.maxAttempts} attempts
                  </span>
                </Link>
              ))}
              {!loadingOverdue && overdueFollowUps.length === 0 && (
                <div className="text-xs text-[var(--text-faint)]">Koi overdue customer nahi hai — sab time par hai.</div>
              )}
            </div>
          </PanelBody>
        </Panel>

        <Panel warn={brokenPromises.length > 0}>
          <PanelBody>
            <PanelHeading title="Broken Promises" subtitle="Promise ki gayi date nikal gayi aur payment nahi mila." />
            <div className="space-y-2">
              {loadingBrokenPromises && (
                <>
                  <Skeleton className="h-5" />
                  <Skeleton className="h-5" />
                  <Skeleton className="h-5" />
                </>
              )}
              {!loadingBrokenPromises &&
                brokenPromises.map((p) => (
                  <Link
                    key={p.id}
                    href={`/customers/${p.customer.id}`}
                    className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2 hover:text-[color:var(--yellow-bright)]"
                  >
                    <span>{p.customer.name}</span>
                    <span className="text-[var(--text-dim)]">
                      {formatInrClient(p.promisedAmount)} · {formatDateClient(p.promisedDate)}
                    </span>
                  </Link>
                ))}
              {!loadingBrokenPromises && brokenPromises.length === 0 && (
                <div className="text-xs text-[var(--text-faint)]">Koi broken promise nahi hai.</div>
              )}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel warn={tasks.length > 0}>
        <PanelBody>
          <PanelHeading
            title="Open Staff Tasks"
            subtitle="Payment verification, AI-uncertain reviews, callbacks aur wrong-number checks — sab yahan."
          />
          <div className="space-y-2">
            {loadingTasks && (
              <>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </>
            )}
            {!loadingTasks &&
              tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-3 border border-[var(--panel-border)] rounded-lg p-3 cursor-pointer hover:bg-white/[0.02]"
                onClick={() => (t.call ? router.push(`/calls/${t.call.id}`) : router.push(`/customers/${t.customer.id}`))}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge value={t.type} label={t.type.replaceAll("_", " ")} />
                    <span className="text-sm font-medium">{t.title}</span>
                  </div>
                  <p className="text-xs text-[var(--text-faint)] mt-1 max-w-2xl">{t.description}</p>
                </div>
                <button
                  className="btn-secondary text-xs flex items-center gap-1 shrink-0"
                  disabled={resolvingId === t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    resolveTask(t.id);
                  }}
                >
                  <CheckCircle2 size={13} /> Resolve
                </button>
              </div>
            ))}
            {!loadingTasks && tasks.length === 0 && (
              <div className="text-xs text-[var(--text-faint)]">Koi open task nahi hai — sab clear hai.</div>
            )}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Kaise shuru karein"
            subtitle="TEST MODE mein kisi bhi real customer ko call nahi jaati — sirf simulate hoti hai."
          />
          <ol className="text-sm text-[var(--text-dim)] space-y-2 list-decimal list-inside">
            <li>
              <Link href="/customers" className="text-[color:var(--gold-bright)] hover:underline">
                Customers
              </Link>{" "}
              me se koi customer chunein.
            </li>
            <li>Unke detail page se &quot;Start Test Call&quot; dabayein.</li>
            <li>Customer ka jawab type karein — AI turant samajh kar jawab dega.</li>
            <li>
              Call complete hone par{" "}
              <Link href="/promises" className="text-[color:var(--gold-bright)] hover:underline">
                Promise-to-Pay
              </Link>{" "}
              aur owner notification apne aap ban jayenge.
            </li>
          </ol>
        </PanelBody>
      </Panel>
    </div>
  );
}
