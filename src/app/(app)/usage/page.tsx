"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { api, ApiError, formatInrClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface UsageResponse {
  totalEstimatedCost: number;
  totalLogs: number;
  todayEstimatedCost: number;
  byProvider: { provider: string; estimatedCost: number; durationSeconds: number; unitsUsed: number; count: number }[];
}

export default function UsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    api
      .get<UsageResponse>("/api/usage")
      .then(setData)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Usage data load nahi hua."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const maxCost = data ? Math.max(1, ...data.byProvider.map((p) => p.estimatedCost)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Wallet size={20} className="text-[color:var(--gold-bright)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Usage &amp; Cost</h1>
          <p className="text-sm text-[var(--text-dim)]">AI calling estimated cost — provider-wise breakdown.</p>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Total Estimated Cost" value={data ? formatInrClient(data.totalEstimatedCost) : "—"} tone="gold" />
        <StatCard label="Today's Estimated Cost" value={data ? formatInrClient(data.todayEstimatedCost) : "—"} tone="green" />
        <StatCard label="Total Usage Log Entries" value={data?.totalLogs ?? "—"} tone="neutral" />
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading title="By Provider" subtitle="Estimated rates — not vendor invoices. Configure real rates as vendors are onboarded." />
          <div className="space-y-4">
            {loading && !data && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
            {data?.byProvider.map((p) => (
              <div key={p.provider}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{p.provider}</span>
                  <span>{formatInrClient(p.estimatedCost)}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--overlay-2)] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, (p.estimatedCost / maxCost) * 100)}%`,
                      background: "linear-gradient(90deg, var(--gold), var(--green))",
                    }}
                  />
                </div>
                <div className="text-[10px] text-[var(--text-faint)] mt-1">{p.count} usage entries</div>
              </div>
            ))}
            {data?.byProvider.length === 0 && <div className="text-xs text-[var(--text-faint)]">Abhi tak koi usage record nahi hai.</div>}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
