"use client";

import { useEffect, useState } from "react";
import { Mic2, ShieldCheck, ShieldAlert } from "lucide-react";
import { api, ApiError } from "@/lib/apiClient";
import { Panel, PanelBody, PanelHeading } from "@/components/ui/Panel";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";

interface SettingsResponse {
  providers: { telephony: string; stt: string; llm: string; tts: string; customVoice: string; whatsapp: string; sms: string };
  customVoiceConsentOnFile: boolean;
}

const PROVIDER_ROWS: { key: keyof SettingsResponse["providers"]; label: string; envVar: string; desc: string }[] = [
  { key: "telephony", label: "Telephony Provider", envVar: "TELEPHONY_PROVIDER", desc: "Places/receives the outbound call." },
  { key: "stt", label: "Speech-to-Text Provider", envVar: "STT_PROVIDER", desc: "Converts customer audio to text." },
  { key: "llm", label: "LLM Provider", envVar: "LLM_PROVIDER", desc: "Optional free-text phrasing seam (call logic itself is rule-based)." },
  { key: "tts", label: "Text-to-Speech Provider", envVar: "TTS_PROVIDER", desc: "Converts AI text replies to speech." },
  { key: "customVoice", label: "Custom Voice Provider", envVar: "CUSTOM_VOICE_PROVIDER", desc: "Optional — client's own cloned voice." },
  { key: "whatsapp", label: "WhatsApp Provider", envVar: "WHATSAPP_PROVIDER", desc: "Bill/reminder/receipt messages to customers, AI-call reports to owner." },
  { key: "sms", label: "SMS Provider", envVar: "SMS_PROVIDER", desc: "SMS reminders to customers." },
];

export default function VoiceConfigPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    api
      .get<SettingsResponse>("/api/settings")
      .then(setData)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Provider config load nahi ho paya."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Mic2 size={20} className="text-[color:var(--gold-bright)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Voice Configuration</h1>
          <p className="text-sm text-[var(--text-dim)]">
            Har vendor ek env variable se chuna jaata hai — code me kabhi hardcode nahi hota. API keys yahan kabhi nahi dikhaye jaate.
          </p>
        </div>
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      <Panel>
        <PanelBody>
          <PanelHeading title="Active Providers" subtitle="Vendor badalne ke liye .env me *_PROVIDER value change karein aur restart karein." />
          <div className="space-y-3">
            {PROVIDER_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between border-b border-[var(--panel-border)] pb-3">
                <div>
                  <div className="text-sm font-medium">{row.label}</div>
                  <div className="text-xs text-[var(--text-faint)]">{row.desc}</div>
                </div>
                <div className="text-right">
                  {loading ? (
                    <Skeleton className="h-5 w-16 ml-auto" />
                  ) : (
                    <div className="chip">{data?.providers[row.key] ?? "…"}</div>
                  )}
                  <div className="text-[10px] text-[var(--text-faint)] mt-1">{row.envVar}</div>
                </div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <PanelHeading title="Custom / Client Voice" subtitle="Sirf tab available hai jab provider technically support kare AUR consent file par ho." />
          <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--panel-border)] bg-[var(--overlay-1)]">
            {loading ? (
              <>
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </>
            ) : data?.customVoiceConsentOnFile ? (
              <>
                <ShieldCheck className="text-[color:var(--green-bright)]" size={20} />
                <div>
                  <div className="text-sm font-medium">Consent on file</div>
                  <div className="text-xs text-[var(--text-faint)]">Custom voice synthesis is permitted for this deployment.</div>
                </div>
              </>
            ) : (
              <>
                <ShieldAlert className="text-[color:var(--yellow-bright)]" size={20} />
                <div>
                  <div className="text-sm font-medium">Consent not on file</div>
                  <div className="text-xs text-[var(--text-faint)]">
                    Custom voice is disabled until CUSTOM_VOICE_CONSENT_ON_FILE=true is set after obtaining explicit client consent.
                  </div>
                </div>
              </>
            )}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
