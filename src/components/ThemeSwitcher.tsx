"use client";

import { useEffect, useState } from "react";
import { Moon, Sparkles, Sun } from "lucide-react";

export type ThemeName = "classic" | "neon" | "light";

const OPTIONS: { key: ThemeName; label: string; Icon: typeof Moon }[] = [
  { key: "classic", label: "Classic (dark gold)", Icon: Moon },
  { key: "neon", label: "Neon (purple)", Icon: Sparkles },
  { key: "light", label: "Light", Icon: Sun },
];

function apply(t: ThemeName) {
  if (t === "classic") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/** Three-way theme toggle; the choice is a per-browser convenience (localStorage), applied before paint by the inline script in layout.tsx. */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>("classic");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("theme");
      if (saved === "neon" || saved === "light") setTheme(saved);
    } catch {
      /* storage blocked — stay on classic */
    }
  }, []);

  function choose(t: ThemeName) {
    setTheme(t);
    apply(t);
    try {
      window.localStorage.setItem("theme", t);
    } catch {
      /* ignore */
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
