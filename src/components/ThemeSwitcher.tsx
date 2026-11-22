"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type ThemeName = "dark" | "light";

const OPTIONS: { key: ThemeName; label: string; Icon: typeof Moon }[] = [
  { key: "dark", label: "Dark mode", Icon: Moon },
  { key: "light", label: "Light mode", Icon: Sun },
];

function apply(t: ThemeName) {
  if (t === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

/**
 * Dark / Light toggle. The first visit follows the OS setting; after that the
 * explicit choice wins. It is applied before first paint by the inline script
 * in layout.tsx, so there is no flash. localStorage is only a per-browser
 * convenience — everything works without it.
 */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function choose(t: ThemeName) {
    setTheme(t);
    apply(t);
    try {
      window.localStorage.setItem("theme", t);
    } catch {
      /* storage blocked — the choice just will not persist */
    }
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[var(--panel-border)] p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          title={label}
          aria-label={label}
          aria-pressed={theme === key}
          onClick={() => choose(key)}
          className={`rounded-md p-1.5 transition ${theme === key ? "bg-[var(--gold)]/25 text-[var(--gold-bright)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
