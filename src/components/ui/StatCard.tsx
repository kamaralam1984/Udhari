import type { ReactNode } from "react";
import { Panel, PanelBody } from "./Panel";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "gold",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "gold" | "green" | "yellow" | "red" | "neutral";
}) {
  const toneColor =
    tone === "green"
      ? "var(--green-bright)"
      : tone === "yellow"
        ? "var(--yellow-bright)"
        : tone === "red"
          ? "var(--red)"
          : tone === "gold"
            ? "var(--gold-bright)"
            : "var(--text)";

  return (
    <Panel>
      <PanelBody>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">{label}</span>
          {icon && (
            <span className="opacity-80" style={{ color: toneColor }}>
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: toneColor }}>
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-[var(--text-faint)]">{hint}</div>}
      </PanelBody>
    </Panel>
  );
}
