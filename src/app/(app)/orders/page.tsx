"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError, formatInrClient, formatDateClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { SkeletonRows } from "@/components/ui/Skeleton";

interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
}

interface OrderItem {
  id: string;
  itemName: string;
  quantity: string;
  unit: string | null;
  rate: string;
  amount: string;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  customer: Customer;
  items: OrderItem[];
}

interface ItemDraft {
  itemName: string;
  quantity: string;
  unit: string;
  rate: string;
}

const EMPTY_ITEM: ItemDraft = { itemName: "", quantity: "1", unit: "", rate: "" };

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner />
    </Suspense>
  );
}

function OrdersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCustomerId = searchParams.get("customerId") || "";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(!!preselectedCustomerId);
  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [paidNow, setPaidNow] = useState("");
  const [promisedPaymentDate, setPromisedPaymentDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ orders: OrderRow[] }>("/api/orders");
      setOrders(data.orders);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Orders load nahi ho paye.");
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

  const total = items.reduce((sum, it) => sum + (parseFloat(it.quantity || "0") * parseFloat(it.rate || "0") || 0), 0);

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function createOrder() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/orders", {
        customerId,
        items: items
          .filter((it) => it.itemName.trim())
          .map((it) => ({
            itemName: it.itemName,
            quantity: parseFloat(it.quantity || "0"),
            unit: it.unit || undefined,
            rate: parseFloat(it.rate || "0"),
          })),
        paidNow: paidNow ? parseFloat(paidNow) : undefined,
        promisedPaymentDate: promisedPaymentDate ? new Date(promisedPaymentDate).toISOString() : undefined,
      });
      setShowForm(false);
      setCustomerId("");
      setItems([{ ...EMPTY_ITEM }]);
      setPaidNow("");
      setPromisedPaymentDate("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Order save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Orders & Billing</h1>
          <p className="text-sm text-[var(--text-dim)]">Udhar par maal bikri — item, rate, aur bill.</p>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New Order
        </button>
      </div>

      {showForm && (
        <Panel glow>
          <PanelBody>
            <PanelHeading title="Naya order banayein" />
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Customer chunein…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.phoneNumber}
                  </option>
                ))}
              </Select>
              <input
                className="field-input"
                type="date"
                placeholder="Promised payment date (optional)"
                value={promisedPaymentDate}
                onChange={(e) => setPromisedPaymentDate(e.target.value)}
              />
            </div>

            <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2">Items</div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="field-input col-span-4"
                    placeholder="Item (e.g. Cement)"
                    value={it.itemName}
                    onChange={(e) => updateItem(idx, { itemName: e.target.value })}
                  />
                  <input
                    className="field-input col-span-2"
                    type="number"
                    placeholder="Qty"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                  />
                  <input
                    className="field-input col-span-2"
                    placeholder="Unit (bag/truck)"
                    value={it.unit}
                    onChange={(e) => updateItem(idx, { unit: e.target.value })}
                  />
                  <input
                    className="field-input col-span-2"
                    type="number"
                    placeholder="Rate ₹"
                    value={it.rate}
                    onChange={(e) => updateItem(idx, { rate: e.target.value })}
                  />
                  <div className="col-span-1 text-xs text-[var(--text-dim)] text-right">
                    {formatInrClient((parseFloat(it.quantity || "0") * parseFloat(it.rate || "0")) || 0)}
                  </div>
                  <button
                    className="col-span-1 text-[var(--text-faint)] hover:text-[var(--red)] p-1"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                    aria-label={`Remove item ${idx + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button className="btn-secondary text-xs mt-2" onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}>
              + Add item
            </button>

            <div className="flex items-center justify-between mt-4 border-t border-[var(--panel-border)] pt-4">
              <div className="text-sm">
                Total: <span className="font-bold text-[color:var(--gold-bright)]">{formatInrClient(total)}</span>
              </div>
              <input
                className="field-input max-w-48"
                type="number"
                placeholder="Paid now (₹, optional)"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
              />
            </div>

            {error && <div className="text-xs text-red-300 mt-3">{error}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-primary text-sm" disabled={saving || !customerId} onClick={createOrder}>
                {saving ? "Saving…" : "Save Order"}
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
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Credit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonRows rows={6} cols={7} />}
                {!loading && orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => router.push(`/orders/${o.id}`)}>
                    <td className="font-medium">{o.orderNumber}</td>
                    <td>{o.customer.name}</td>
                    <td className="text-[var(--text-dim)]">{formatDateClient(o.orderDate)}</td>
                    <td>{formatInrClient(o.totalAmount)}</td>
                    <td className="text-[var(--text-dim)]">{formatInrClient(o.paidAmount)}</td>
                    <td>{formatInrClient(Number(o.totalAmount) - Number(o.paidAmount))}</td>
                    <td>
                      <Badge value={o.status} />
                    </td>
                  </tr>
                ))}
                {!loading && orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-[var(--text-faint)] py-8">
                      Koi order nahi hai.
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
