"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, AlertTriangle, Send } from "lucide-react";
import { api, ApiError } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  whatsappNumber: string | null;
}

interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
  skippedNoOwnerNumber: number;
}

interface AppSettings {
  mode: "TEST" | "PRODUCTION";
  businessName: string;
  businessTagline: string | null;
  businessPhone: string | null;
  minGapHoursBetweenCalls: number;
  maxAttemptsPerDay: number;
  maxAttemptsPerPromise: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  minGapHoursBetweenReminders: number;
  daysBeforeDueForFirstReminder: number;
  daysOverdueBeforeAiCall: number;
  reminderChannelsEnabled: string;
  minOutstandingForAiCall: string;
  alertMinSuccessRate: number;
  alertMaxBrokenPromises: number;
  dailyCostLimit: string;
  dailyReportEnabled: boolean;
  dailyReportHour: number;
  useBestCallTime: boolean;
  bestCallMaxDeferHours: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);

  async function load() {
    const data = await api.get<{ settings: AppSettings }>("/api/settings");
    setSettings(data.settings);
  }

  async function loadMe() {
    const data = await api.get<{ user: MeResponse }>("/api/auth/me");
    setMe(data.user);
  }

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([load(), loadMe()]);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Settings load nahi ho paye.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveWhatsappNumber(v: string) {
    setSaving(true);
    try {
      const data = await api.patch<{ user: MeResponse }>("/api/auth/me", { whatsappNumber: v || null });
      setMe(data.user);
    } finally {
      setSaving(false);
    }
  }

  async function dispatchNow() {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const data = await api.post<{ result: DispatchResult }>("/api/notifications/dispatch");
      setDispatchResult(data.result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Dispatch nahi ho paya.");
    } finally {
      setDispatching(false);
    }
  }

  async function save(patch: Partial<Record<keyof AppSettings, string | number | boolean | null>>) {
    setSaving(true);
    setError(null);
    try {
      const data = await api.patch<{ settings: AppSettings }>("/api/settings", patch);
      setSettings(data.settings);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <SettingsIcon size={20} className="text-[color:var(--gold-bright)]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-[var(--text-dim)]">Call mode, anti-spam limits, aur quiet hours.</p>
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <Panel key={i}>
            <PanelBody>
              <Skeleton className="h-4 w-40 mb-4" />
              <div className="grid sm:grid-cols-2 gap-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            </PanelBody>
          </Panel>
        ))}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <SettingsIcon size={20} className="text-[color:var(--gold-bright)]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-[var(--text-dim)]">Call mode, anti-spam limits, aur quiet hours.</p>
          </div>
        </div>
        <ErrorBanner message={loadError || "Settings load nahi ho paye."} onRetry={loadAll} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <SettingsIcon size={20} className="text-[color:var(--gold-bright)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-[var(--text-dim)]">Call mode, anti-spam limits, aur quiet hours.</p>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={loadAll} />}

      <Panel glow>
        <PanelBody>
          <PanelHeading
            title="Business Branding"
            subtitle="Yeh naam login page, sidebar, AI call greeting, aur order bills/receipts me use hota hai."
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label="Business name" value={settings.businessName} onSave={(v) => save({ businessName: v })} />
            <TextField
              label="Tagline (optional)"
              value={settings.businessTagline || ""}
              onSave={(v) => save({ businessTagline: v || null })}
            />
            <TextField
              label="Business phone (shown on login page + printed on bills)"
              value={settings.businessPhone || ""}
              onSave={(v) => save({ businessPhone: v || null })}
            />
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="WhatsApp / Notifications"
            subtitle="AI call reports aapke WhatsApp number par bhejne ke liye number set karein, ya pending messages abhi bhej dein."
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label="Your WhatsApp number"
              value={me?.whatsappNumber || ""}
              onSave={(v) => saveWhatsappNumber(v)}
            />
            <div>
              <label className="text-xs text-[var(--text-dim)] block mb-1">Pending WhatsApp/SMS notifications</label>
              <button className="btn-secondary flex items-center gap-2 text-sm" disabled={dispatching} onClick={dispatchNow}>
                <Send size={14} /> {dispatching ? "Sending…" : "Send Pending Now"}
              </button>
            </div>
          </div>
          {dispatchResult && (
            <div className="mt-3 text-xs text-[var(--text-dim)]">
              Attempted: {dispatchResult.attempted} · Sent: {dispatchResult.sent} · Failed: {dispatchResult.failed}
              {dispatchResult.skippedNoOwnerNumber > 0 && (
                <span className="text-[color:var(--yellow-bright)]">
                  {" "}
                  · {dispatchResult.skippedNoOwnerNumber} skipped (set your WhatsApp number above first)
                </span>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      <Panel glow={settings.mode === "PRODUCTION"} warn={settings.mode === "PRODUCTION"}>
        <PanelBody>
          <PanelHeading title="Call Mode" subtitle="PRODUCTION real customers ko call karta hai — sirf owner activate kar sakta hai." />
          <div className="flex items-center gap-3">
            <button
              className={settings.mode === "TEST" ? "btn-primary text-sm" : "btn-secondary text-sm"}
              onClick={() => save({ mode: "TEST" })}
              disabled={saving}
            >
              TEST MODE
            </button>
            <button
              className={settings.mode === "PRODUCTION" ? "btn-danger text-sm" : "btn-secondary text-sm"}
              onClick={() => {
                if (window.confirm("PRODUCTION mode activate karna hai? Isse real customers ko calls ja sakti hain.")) {
                  save({ mode: "PRODUCTION" });
                }
              }}
              disabled={saving}
            >
              PRODUCTION MODE
            </button>
          </div>
          {settings.mode === "PRODUCTION" && (
            <div className="mt-3 flex items-start gap-2 text-xs text-[color:var(--yellow-bright)] bg-[color:var(--yellow)]/10 border border-[color:var(--yellow)]/30 rounded-lg p-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              PRODUCTION mode is active. Real telephony calls require a configured (non-mock) TELEPHONY_PROVIDER.
            </div>
          )}
          {error && <div className="text-xs text-[var(--danger-text)] mt-3">{error}</div>}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading title="Anti-Spam / Safety" subtitle="Har production call in limits se guzarta hai." />
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField
              label="Minimum gap between calls (hours)"
              value={settings.minGapHoursBetweenCalls}
              onSave={(v) => save({ minGapHoursBetweenCalls: v })}
            />
            <NumberField label="Max attempts per day" value={settings.maxAttemptsPerDay} onSave={(v) => save({ maxAttemptsPerDay: v })} />
            <NumberField
              label="Max attempts per promise/follow-up"
              value={settings.maxAttemptsPerPromise}
              onSave={(v) => save({ maxAttemptsPerPromise: v })}
            />
            <NumberField label="Quiet hours start (24h)" value={settings.quietHoursStart} onSave={(v) => save({ quietHoursStart: v })} />
            <NumberField label="Quiet hours end (24h)" value={settings.quietHoursEnd} onSave={(v) => save({ quietHoursEnd: v })} />
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Follow-up Automation"
            subtitle="Har 15 min me scheduler chalta hai — due-date ke hisaab se WhatsApp/SMS reminder ya AI call khud trigger karta hai."
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField
              label="Minimum gap between reminders (hours)"
              value={settings.minGapHoursBetweenReminders}
              onSave={(v) => save({ minGapHoursBetweenReminders: v })}
            />
            <NumberField
              label="Days before due date — first reminder"
              value={settings.daysBeforeDueForFirstReminder}
              onSave={(v) => save({ daysBeforeDueForFirstReminder: v })}
            />
            <NumberField
              label="Days overdue before escalating to AI call"
              value={settings.daysOverdueBeforeAiCall}
              onSave={(v) => save({ daysOverdueBeforeAiCall: v })}
            />
            <TextField
              label="Enabled reminder channels (whatsapp,sms)"
              value={settings.reminderChannelsEnabled}
              onSave={(v) => save({ reminderChannelsEnabled: v })}
            />
            <NumberField
              label="Min outstanding (₹) for AI call — below this, WhatsApp/SMS only"
              value={Number(settings.minOutstandingForAiCall)}
              onSave={(v) => save({ minOutstandingForAiCall: v })}
            />
            <div className="sm:col-span-2 rounded-lg border border-[var(--panel-border)] p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.useBestCallTime} onChange={(e) => save({ useBestCallTime: e.target.checked })} />
                <span className="font-medium">Best time to call (smart timing)</span>
              </label>
              <p className="mt-1 text-xs text-[var(--text-dim)]">
                ON hone par scheduler AI call tab tak rok leta hai jab tak customers ke phone uthane ka achha ghanta na aa jaye (pichhle 60 din ke pick-up data se). Kam history (30 se kam calls) ho ya ghanta theek ho to call turant lagti hai. Quiet hours me kabhi nahi.
              </p>
              <div className="mt-2 max-w-xs">
                <NumberField
                  label="Zyada se zyada kitne ghante rukna (1-72)"
                  value={settings.bestCallMaxDeferHours}
                  onSave={(v) => save({ bestCallMaxDeferHours: v })}
                />
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading
            title="Alerts & Daily Report"
            subtitle="Limit paar hone par owner ko dashboard bell + WhatsApp par alert jata hai (har alert 6 ghante me ek baar). 0 = band."
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField
              label="Alert agar call success rate is % se neeche (24h)"
              value={settings.alertMinSuccessRate}
              onSave={(v) => save({ alertMinSuccessRate: v })}
            />
            <NumberField
              label="Alert agar open broken promises itne ho jayein"
              value={settings.alertMaxBrokenPromises}
              onSave={(v) => save({ alertMaxBrokenPromises: v })}
            />
            <NumberField
              label="Daily call cost limit (₹)"
              value={Number(settings.dailyCostLimit)}
              onSave={(v) => save({ dailyCostLimit: v })}
            />
            <NumberField
              label="Daily report bhejne ka time (24h, is ghante ke baad)"
              value={settings.dailyReportHour}
              onSave={(v) => save({ dailyReportHour: v })}
            />
            <label className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
              <input
                type="checkbox"
                checked={settings.dailyReportEnabled}
                onChange={(e) => save({ dailyReportEnabled: e.target.checked })}
              />
              Roz raat ko daily report owner ko bhejo
            </label>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <div>
      <label className="text-xs text-[var(--text-dim)] block mb-1">{label}</label>
      <div className="flex gap-2">
        <input className="field-input" type="number" value={local} onChange={(e) => setLocal(e.target.value)} />
        <button className="btn-secondary text-xs" onClick={() => onSave(parseInt(local, 10))}>
          Save
        </button>
      </div>
    </div>
  );
}

function TextField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div>
      <label className="text-xs text-[var(--text-dim)] block mb-1">{label}</label>
      <div className="flex gap-2">
        <input className="field-input" type="text" value={local} onChange={(e) => setLocal(e.target.value)} />
        <button className="btn-secondary text-xs" onClick={() => onSave(local.trim())}>
          Save
        </button>
      </div>
    </div>
  );
}
