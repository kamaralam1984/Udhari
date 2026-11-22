"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError, formatInrClient, formatDateTimeClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { SkeletonRows } from "@/components/ui/Skeleton";

interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  outstandingAmount: string;
}

interface CollectionRow {
  id: string;
  receiptNumber: string;
  amount: string;
  collectedAt: string;
  note: string | null;
  customer: { name: string; phoneNumber: string };
  order: { orderNumber: string } | null;
  collectedBy: { name: string };
}

export default function CashCollectionsPage() {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ collections: CollectionRow[] }>("/api/cash-collections");
      setRows(data.collections);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Payments load nahi ho paye.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    api
      .get<{ customers: Customer[] }>("/api/customers")
      .then((d) => setCustomers(d.customers))
      .catch(() => {});
  }, []);

  async function recordPayment() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/cash-collections", {
        customerId,
        amount: parseFloat(amount || "0"),
        note: note || undefined,
      });
      setShowForm(false);
      setCustomerId("");
      setAmount("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment record nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Cash Collection</h1>
          <p className="text-sm text-[var(--text-dim)]">Customer se mila cash payment record karein.</p>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> Record Payment
        </button>
      </div>

      {showForm && (
        <Panel glow>
          <PanelBody>
            <PanelHeading title="Naya cash payment" subtitle="Kisi bhi outstanding customer se general (on-account) payment record karein." />
            <div className="grid sm:grid-cols-3 gap-3">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Customer chunein…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — Outstanding {formatInrClient(c.outstandingAmount)}
                  </option>
                ))}
              </Select>
              <input
                className="field-input"
                type="number"
                placeholder="Amount ₹"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <input className="field-input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {selectedCustomer && (
              <div className="text-xs text-[var(--text-dim)] mt-2">
                Current outstanding: {formatInrClient(selectedCustomer.outstandingAmount)}
              </div>
            )}
            {error && <div className="text-xs text-[var(--danger-text)] mt-3">{error}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-primary text-sm" disabled={saving || !customerId || !amount} onClick={recordPayment}>
                {saving ? "Saving…" : "Record Payment"}
              </button>
              <button className="btn-secondary text-sm" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </PanelBody>
        </Panel>
      )}

      {loadError && <ErrorBanner message={loadError} onRetry={() => load()} />}

      <Panel>
        <PanelBody>
          <div className="table-wrap">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Customer</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Collected By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonRows rows={6} cols={6} />}
                {!loading && rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.receiptNumber}</td>
                    <td>{r.customer.name}</td>
                    <td className="text-[var(--text-dim)]">{r.order?.orderNumber || "-"}</td>
                    <td>{formatInrClient(r.amount)}</td>
                    <td className="text-[var(--text-dim)]">{r.collectedBy.name}</td>
                    <td className="text-[var(--text-faint)]">{formatDateTimeClient(r.collectedAt)}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-[var(--text-faint)] py-8">
                      Abhi tak koi payment record nahi hui.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
