"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  History,
  HandCoins,
  FlaskConical,
  Mic2,
  Wallet,
  Settings as SettingsIcon,
  Bell,
  LogOut,
  Menu,
  Receipt,
  Banknote,
  PhoneCall,
  BarChart3,
  Megaphone,
} from "lucide-react";
import { ThemeSwitcher } from "./ThemeSwitcher";
import clsx from "clsx";
import { api } from "@/lib/apiClient";
import { AlertTriangle } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/calls/new", label: "Make a Call", icon: PhoneCall },
  { href: "/orders", label: "Orders & Billing", icon: Receipt },
  { href: "/cash-collections", label: "Cash Collection", icon: Banknote },
  { href: "/calls", label: "Call History", icon: History },
  { href: "/promises", label: "Promise-to-Pay", icon: HandCoins },
  { href: "/language-lab", label: "Language Lab", icon: FlaskConical },
  { href: "/voice-config", label: "Voice Config", icon: Mic2 },
  { href: "/usage", label: "Usage / Cost", icon: Wallet },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "STAFF";
}

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function AppShell({
  user,
  businessName,
  children,
}: {
  user: CurrentUser;
  businessName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [mode, setMode] = useState<"TEST" | "PRODUCTION" | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ settings: { mode: "TEST" | "PRODUCTION" } }>("/api/settings")
      .then((d) => {
        if (!cancelled) setMode(d.settings.mode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.get<{ notifications: NotificationRow[] }>("/api/notifications?unreadOnly=true");
        if (!cancelled) setNotifications(data.notifications);
      } catch {
        // notification polling is best-effort
      }
    }
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function markRead(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.patch("/api/notifications", { id });
    } catch {
      // ignore
    }
  }

  async function handleLogout() {
    await api.post("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-[var(--panel-border)] bg-[var(--bg-elevated)] transform transition-transform lg:translate-x-0 lg:static",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center gap-2 px-5 border-b border-[var(--panel-border)]">
          <div className="w-2 h-2 rounded-full live-dot" />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight truncate" title={businessName}>
              {businessName}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-faint)]">AI Calling Console</div>
          </div>
        </div>
        <nav className="p-3 space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[color:var(--gold)]/10 text-[color:var(--gold-bright)] border border-[color:var(--gold)]/30"
                    : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-white/[0.04] border border-transparent"
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-[var(--panel-border)]">
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-xs font-semibold">{user.name}</div>
              <div className="text-[10px] text-[var(--text-faint)]">{user.role}</div>
            </div>
            <button onClick={handleLogout} title="Logout" aria-label="Logout" className="text-[var(--text-dim)] hover:text-[var(--red)] p-2">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-[var(--panel-border)] bg-[var(--bg-elevated)]/70 backdrop-blur sticky top-0 z-10 flex items-center justify-between px-4 lg:px-6">
          <button className="lg:hidden p-2 text-[var(--text-dim)]" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="hidden lg:block gold-rule w-24" />
          <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <div className="relative">
            <button
              className="relative p-2 rounded-lg hover:bg-white/[0.05] text-[var(--text-dim)]"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label={`Notifications${notifications.length > 0 ? ` (${notifications.length} unread)` : ""}`}
            >
              <Bell size={18} />
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-[var(--red)] text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                  {notifications.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 panel z-20 max-h-96 overflow-auto">
                <div className="panel-body space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                    AI Call Reports
                  </div>
                  {notifications.length === 0 && (
                    <div className="text-xs text-[var(--text-faint)]">Koi naya notification nahi hai.</div>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id} className="border border-[var(--panel-border)] rounded-lg p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold">{n.title}</div>
                        <button
                          onClick={() => markRead(n.id)}
                          className="text-[10px] text-[var(--text-faint)] hover:text-[var(--gold-bright)]"
                        >
                          mark read
                        </button>
                      </div>
                      <pre className="whitespace-pre-wrap text-[11px] text-[var(--text-dim)] mt-1 font-sans">
                        {n.body}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
        </header>
        {mode && (
          <div
            role="status"
            className={clsx(
              "px-4 lg:px-6 py-1.5 text-[11px] font-medium flex items-center gap-1.5 border-b",
              mode === "PRODUCTION"
                ? "bg-red-500/10 text-red-300 border-[color:var(--red)]/30"
                : "bg-white/[0.02] text-[var(--text-faint)] border-[var(--panel-border)]"
            )}
          >
            {mode === "PRODUCTION" ? (
              <>
                <AlertTriangle size={11} className="shrink-0" />
                PRODUCTION MODE ACTIVE — real customers ko calls ja rahi hain.
              </>
            ) : (
              <>TEST MODE — koi real call nahi ja rahi, sab simulated hai.</>
            )}
          </div>
        )}
        <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
