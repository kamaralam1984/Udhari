"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
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
  outstandingAmount: string;
  lastPromiseDate: string | null;
  lastPromiseAmount: string | null;
  preferredLanguage: string;
  doNotCall: boolean;
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phoneNumber: "",
    whatsappNumber: "",
    address: "",
    outstandingAmount: "",
    preferredLanguage: "hinglish",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ customers: Customer[]; hasMore: boolean }>(
        `/api/customers?q=${encodeURIComponent(q)}&page=1`
      );
      setCustomers(data.customers);
      setHasMore(data.hasMore);
      setPage(1);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Customers load nahi ho paye.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const data = await api.get<{ customers: Customer[]; hasMore: boolean }>(
        `/api/customers?q=${encodeURIComponent(q)}&page=${nextPage}`
      );
      setCustomers((prev) => [...prev, ...data.customers]);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Aur customers load nahi ho paye.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function createCustomer() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/customers", {
        name: form.name,
        phoneNumber: form.phoneNumber,
        whatsappNumber: form.whatsappNumber || undefined,
        address: form.address || undefined,
        outstandingAmount: parseFloat(form.outstandingAmount || "0"),
        preferredLanguage: form.preferredLanguage,
      });
      setShowForm(false);
      setForm({ name: "", phoneNumber: "", whatsappNumber: "", address: "", outstandingAmount: "", preferredLanguage: "hinglish" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-[var(--text-dim)]">Credit customers aur unka outstanding.</p>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> Add Customer
        </button>
      </div>

      {showForm && (
        <Panel glow>
          <PanelBody>
            <PanelHeading title="Naya customer add karein" />
            <div className="grid sm:grid-cols-2 gap-3">
              <input className="field-input" placeholder="Naam" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input
                className="field-input"
                placeholder="Phone number"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              />
              <input
                className="field-input"
                placeholder="WhatsApp number (optional)"
                value={form.whatsappNumber}
                onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
              />
              <input
                className="field-input"
                placeholder="Address (optional)"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
              <input
                className="field-input"
                placeholder="Outstanding amount (₹)"
                type="number"
                value={form.outstandingAmount}
                onChange={(e) => setForm({ ...form, outstandingAmount: e.target.value })}
              />
              <Select
                value={form.preferredLanguage}
                onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })}
              >
                <option value="hinglish">Hinglish</option>
                <option value="hindi">Hindi</option>
                <option value="magahi">Magahi (Begusarai)</option>
                <option value="maithili">Maithili (Begusarai)</option>
                <option value="english">English</option>
                <option value="other">Other</option>
              </Select>
            </div>
            {error && <div className="text-xs text-[var(--danger-text)] mt-3">{error}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-primary text-sm" disabled={saving} onClick={createCustomer}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button className="btn-secondary text-sm" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelBody>
          <div className="flex items-center gap-2 mb-4">
            <Search size={16} className="text-[var(--text-faint)]" />
            <input
              className="field-input max-w-xs"
              placeholder="Naam ya phone number se search karein"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {loadError && (
            <div className="mb-4">
              <ErrorBanner message={loadError} onRetry={() => load()} />
            </div>
          )}
          <div className="table-wrap">
            <table className="machine-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Outstanding</th>
                  <th>Last Promise</th>
                  <th>Language</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={6} cols={6} />
                ) : (
                  <>
                    {customers.map((c) => (
                      <tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/customers/${c.id}`)}>
                        <td className="font-medium">{c.name}</td>
                        <td className="text-[var(--text-dim)]">{c.phoneNumber}</td>
                        <td>{formatInrClient(c.outstandingAmount)}</td>
                        <td className="text-[var(--text-dim)]">
                          {c.lastPromiseAmount ? `${formatInrClient(c.lastPromiseAmount)} · ${formatDateClient(c.lastPromiseDate)}` : "-"}
                        </td>
                        <td className="text-[var(--text-dim)] capitalize">{c.preferredLanguage}</td>
                        <td>{c.doNotCall ? <Badge value="DO_NOT_CALL" /> : <span className="text-[var(--text-faint)] text-xs">active</span>}</td>
                      </tr>
                    ))}
                    {customers.length === 0 && !loadError && (
                      <tr>
                        <td colSpan={6} className="text-center text-[var(--text-faint)] py-8">
                          Koi customer nahi mila.
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
              <button className="btn-secondary text-sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
