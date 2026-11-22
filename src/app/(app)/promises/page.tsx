"use client";

import { useEffect, useState } from "react";
import { api, ApiError, formatInrClient, formatDateClient, formatDateTimeClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { SkeletonRows } from "@/components/ui/Skeleton";

interface PromiseRow {
  id: string;
  promisedAmount: string;
  promisedDate: string;
  remainingAmount: string | null;
  remainingDueDate: string | null;
  paymentIntent: string;
  confidence: number;
  status: string;
  confirmedByCustomer: boolean;
  createdAt: string;
  customer: { id: string; name: string; phoneNumber: string };
}

const STATUSES = ["", "ACTIVE", "FULFILLED", "BROKEN", "SUPERSEDED", "CANCELLED"];

export default function PromisesPage() {
  const [rows, setRows] = useState<PromiseRow[]>([]);
  const [status, setStatus] = useState("ACTIVE");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  async function load(nextPage: number, append: boolean) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("page", String(nextPage));
      const data = await api.get<{ promises: PromiseRow[]; hasMore: boolean }>(`/api/promises?${qs.toString()}`);
      setRows((prev) => (append ? [...prev, ...data.promises] : data.promises));
      setHasMore(data.hasMore);
      setPage(nextPage);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Promises load nahi ho paye.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function setPromiseStatus(id: string, next: string) {
    setBusyId(id);
    try {
      await api.patch(`/api/promises/${id}`, { status: next });
      await load(1, false);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Promise-to-Pay</h1>
        <p className="text-sm text-[var(--text-dim)]">AI ke through customers se mile payment promises.</p>
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Promises"
            right={
              <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s || "All statuses"}
                  </option>
                ))}
              </Select>
            }
          />
          {loadError && (
            <div className="mb-4">
              <ErrorBanner message={loadError} onRetry={() => load(1, false)} />
            </div>
          )}
          <div className="table-wrap">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Promised Date</th>
                  <th>Remaining Balance</th>
                  <th>Intent</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonRows rows={6} cols={9} />}
                {!loading && rows.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.customer.name}</td>
                    <td>{formatInrClient(p.promisedAmount)}</td>
                    <td>{formatDateClient(p.promisedDate)}</td>
                    <td className="text-[var(--text-dim)]">
                      {p.remainingAmount ? (
                        <>
                          {formatInrClient(p.remainingAmount)}
                          {p.remainingDueDate ? ` by ${formatDateClient(p.remainingDueDate)}` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge value={p.paymentIntent} />
                    </td>
                    <td className="text-[var(--text-dim)]">{Math.round(p.confidence * 100)}%</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td className="text-[var(--text-faint)]">{formatDateTimeClient(p.createdAt)}</td>
                    <td>
                      {p.status === "ACTIVE" && (
                        <div className="flex gap-1">
                          <button
                            disabled={busyId === p.id}
                            className="btn-secondary text-xs py-1 px-2"
                            onClick={() => setPromiseStatus(p.id, "FULFILLED")}
                          >
                            Fulfilled
                          </button>
                          <button
                            disabled={busyId === p.id}
                            className="btn-danger text-xs py-1 px-2"
                            onClick={() => setPromiseStatus(p.id, "BROKEN")}
                          >
                            Broken
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-[var(--text-faint)] py-8">
                      {loadError ? "—" : "Koi promise nahi mila."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="flex justify-center mt-3">
              <button className="btn-secondary text-sm" disabled={loadingMore} onClick={() => load(page + 1, true)}>
                {loadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
