"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/apiClient";
import { Panel, PanelBody } from "@/components/ui/Panel";

function useBranding() {
  const [businessName, setBusinessName] = useState("Your Business");
  const [businessTagline, setBusinessTagline] = useState<string | null>(null);
  const [businessPhone, setBusinessPhone] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ businessName: string; businessTagline: string | null; businessPhone: string | null }>("/api/branding")
      .then((data) => {
        setBusinessName(data.businessName);
        setBusinessTagline(data.businessTagline);
        setBusinessPhone(data.businessPhone);
      })
      .catch(() => {});
  }, []);
  return { businessName, businessTagline, businessPhone };
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { businessName, businessTagline, businessPhone } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      router.push(params.get("next") || "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login fail hua, dobara koshish karein.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center border border-[var(--gold)]/40 mb-3">
            <span className="live-dot" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">{businessName}</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">{businessTagline || "AI Voice Calling Console"}</p>
          {businessPhone && <p className="text-xs text-[var(--text-faint)] mt-0.5">{businessPhone}</p>}
        </div>

        <Panel glow>
          <PanelBody>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-[var(--text-dim)] block mb-1">Email</label>
                <input
                  type="email"
                  required
                  className="field-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@yourbusiness.com"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] block mb-1">Password</label>
                <input
                  type="password"
                  required
                  className="field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {error && <div className="text-xs text-[var(--danger-text)] bg-red-500/10 border border-red-500/30 rounded-lg p-2">{error}</div>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </PanelBody>
        </Panel>
        <p className="text-center text-[10px] text-[var(--text-faint)] mt-4">
          Owner/Admin/Staff access only. Contact the owner if you need an account.
        </p>
      </div>
    </div>
  );
}
