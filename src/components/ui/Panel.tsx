import type { ReactNode } from "react";
import clsx from "clsx";

export function Panel({
  children,
  className,
  glow = false,
  warn = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  /** Swaps the animated top line to yellow — for panels needing attention (overdue, broken, pending review). */
  warn?: boolean;
}) {
  return <div className={clsx("panel", glow && "panel-glow", warn && "panel-warn", className)}>{children}</div>;
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("panel-body", className)}>{children}</div>;
}

export function PanelHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--text)] tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-[var(--text-dim)] mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
