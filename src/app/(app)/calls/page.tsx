"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, formatInrClient, formatDateTimeClient, formatDateClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { SkeletonRows } from "@/components/ui/Skeleton";

interface CallRow {
  id: string;
  status: string;
  mode: string;
  createdAt: string;
  promisedAmount: string | null;
  promisedDate: string | null;
  confidence: number | null;
  customer: { id: string; name: string; phoneNumber: string };
}

const STATUS_OPTIONS = [
  "",
  "QUEUED",
  "RINGING",
  "CONNECTED",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "COMPLETED",
  "AI_UNCERTAIN",
  "CALLBACK_REQUESTED",
  "WRONG_NUMBER",
];

export default function CallHistoryPage() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function load(targetPage: number, append: boolean) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("page", String(targetPage));
      const data = await api.get<{ calls: CallRow[]; hasMore: boolean }>(`/api/calls?${qs.toString()}`);
      setCalls((prev) => (append ? [...prev, ...data.calls] : data.calls));
      setHasMore(data.hasMore);
      setPage(targetPage);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Calls load nahi ho paye.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Call History</h1>
        <p className="text-sm text-[var(--text-dim)]">Har AI call ka record — status, promise, confidence.</p>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={() => load(1, false)} />}

      <Panel>
        <PanelBody>
          <PanelHeading
            title="All Calls"
            right={
              <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s || "All statuses"}
                  </option>
                ))}
              </Select>
            }
          />
          <div className="table-wrap">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Promise</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={6} cols={6} />
                ) : (
                  <>
                    {calls.map((c) => (
                      <tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/calls/${c.id}`)}>
                        <td>{formatDateTimeClient(c.createdAt)}</td>
                        <td className="font-medium">{c.customer.name}</td>
                        <td>
                          <Badge value={c.mode} />
                        </td>
                        <td>
                          <Badge value={c.status} />
                        </td>
                        <td className="text-[var(--text-dim)]">
                          {c.promisedAmount ? `${formatInrClient(c.promisedAmount)} · ${formatDateClient(c.promisedDate)}` : "-"}
                        </td>
                        <td className="text-[var(--text-dim)]">{c.confidence !== null ? `${Math.round(c.confidence * 100)}%` : "-"}</td>
                      </tr>
                    ))}
                    {calls.length === 0 && !loadError && (
                      <tr>
                        <td colSpan={6} className="text-center text-[var(--text-faint)] py-8">
                          Koi call record nahi mila.
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          {!loading && hasMore && (
            <div className="flex justify-center mt-3">
              <button className="btn-secondary text-sm" onClick={() => load(page + 1, true)} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
