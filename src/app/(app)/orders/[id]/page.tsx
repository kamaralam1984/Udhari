"use client";

import { useEffect, useState, use as usePromise } from "react";
import { Printer, HandCoins, MessageCircle } from "lucide-react";
import { api, ApiError, formatInrClient, formatDateClient, formatDateTimeClient } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface Branding {
  businessName: string;
  businessTagline: string | null;
  businessPhone: string | null;
}

interface OrderItem {
  id: string;
  itemName: string;
  quantity: string;
  unit: string | null;
  rate: string;
  amount: string;
}

interface CashCollectionRow {
  id: string;
  receiptNumber: string;
  amount: string;
  collectedAt: string;
  collectedBy: { name: string };
  note: string | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  promisedPaymentDate: string | null;
  notes: string | null;
  customer: { id: string; name: string; phoneNumber: string; address: string | null };
  items: OrderItem[];
  cashCollections: CashCollectionRow[];
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sendingBill, setSendingBill] = useState(false);
  const [billSent, setBillSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ order: OrderDetail }>(`/api/orders/${id}`);
      setOrder(data.order);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Order load nahi ho paya.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    api.get<Branding>("/api/branding").then(setBranding).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function recordPayment() {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/cash-collections", {
        customerId: order.customer.id,
        orderId: order.id,
        amount: parseFloat(payAmount || "0"),
      });
      setPaying(false);
      setPayAmount("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Payment record nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  async function sendBill() {
    if (!order) return;
    setSendingBill(true);
    setError(null);
    try {
      await api.post(`/api/orders/${order.id}/send-bill`);
      setBillSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Bill WhatsApp par nahi bheja ja saka.");
    } finally {
      setSendingBill(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    if (!window.confirm(`Order ${order.orderNumber} cancel karna hai? Iska outstanding credit reverse ho jayega.`)) return;
    setCancelling(true);
    try {
      await api.post(`/api/orders/${order.id}/cancel`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cancel nahi ho paya.");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-7 w-48" />
        <Panel>
          <PanelBody className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  if (loadError || !order) {
    return <ErrorBanner message={loadError ?? "Order nahi mila."} onRetry={() => load()} />;
  }

  const credit = Number(order.totalAmount) - Number(order.paidAmount);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{order.orderNumber}</h1>
          <p className="text-sm text-[var(--text-dim)]">
            {order.customer.name} · {order.customer.phoneNumber}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => window.print()}>
            <Printer size={16} /> Print Receipt
          </button>
          <button className="btn-secondary flex items-center gap-2 text-sm" disabled={sendingBill} onClick={sendBill}>
            <MessageCircle size={16} /> {sendingBill ? "Sending…" : billSent ? "Bill Sent ✓" : "Send Bill via WhatsApp"}
          </button>
          {order.status !== "CANCELLED" && (
            <button className="btn-danger text-sm" disabled={cancelling} onClick={cancelOrder}>
              {cancelling ? "Cancelling…" : "Cancel Order"}
            </button>
          )}
          {order.status === "OPEN" && (
            <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setPaying((v) => !v)}>
              <HandCoins size={16} /> Record Cash Payment
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-xs text-[var(--danger-text)] bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>}

      {paying && (
        <Panel glow>
          <PanelBody>
            <PanelHeading title="Cash payment record karein" />
            <div className="flex gap-3">
              <input
                className="field-input max-w-48"
                type="number"
                placeholder="Amount ₹"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <button className="btn-primary text-sm" disabled={saving} onClick={recordPayment}>
                {saving ? "Saving…" : "Record Payment"}
              </button>
            </div>
          </PanelBody>
        </Panel>
      )}

      <div id="receipt-print" className="print:block">
        <Panel>
          <PanelBody>
            {branding && (
              <div className="text-center mb-4 pb-4 border-b border-[var(--panel-border)]">
                <div className="text-lg font-bold tracking-tight">{branding.businessName}</div>
                {branding.businessTagline && (
                  <div className="text-xs text-[var(--text-dim)] mt-0.5">{branding.businessTagline}</div>
                )}
                {branding.businessPhone && (
                  <div className="text-xs text-[var(--text-faint)] mt-0.5">Ph: {branding.businessPhone}</div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <PanelHeading title="Bill / Receipt" subtitle={formatDateClient(order.orderDate)} />
              <Badge value={order.status} />
            </div>
            <div className="text-sm mb-4">
              <div className="font-medium">{order.customer.name}</div>
              <div className="text-[var(--text-dim)]">{order.customer.phoneNumber}</div>
              {order.customer.address && <div className="text-[var(--text-dim)]">{order.customer.address}</div>}
            </div>
            <div className="table-wrap">
              <table className="machine-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.itemName}</td>
                      <td>{it.quantity}</td>
                      <td>{it.unit || "-"}</td>
                      <td>{formatInrClient(it.rate)}</td>
                      <td>{formatInrClient(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mt-4 border-t border-[var(--panel-border)] pt-4">
              <Info label="Total" value={formatInrClient(order.totalAmount)} />
              <Info label="Paid" value={formatInrClient(order.paidAmount)} />
              <Info label="Credit (Udhar)" value={formatInrClient(credit)} />
            </div>
            {order.promisedPaymentDate && (
              <div className="text-xs text-[var(--text-dim)] mt-3">
                Promised payment date: {formatDateClient(order.promisedPaymentDate)}
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelBody>
          <PanelHeading title="Payment History" />
          <div className="space-y-2">
            {order.cashCollections.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm border-b border-[var(--panel-border)] pb-2">
                <span>
                  {c.receiptNumber} · {formatInrClient(c.amount)} · {c.collectedBy.name}
                </span>
                <span className="text-[var(--text-faint)]">{formatDateTimeClient(c.collectedAt)}</span>
              </div>
            ))}
            {order.cashCollections.length === 0 && (
              <div className="text-xs text-[var(--text-faint)]">Abhi tak koi payment record nahi hui.</div>
            )}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-dim)] uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}
