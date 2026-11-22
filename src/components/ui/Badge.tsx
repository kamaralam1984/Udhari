import clsx from "clsx";

const STATUS_TONE: Record<string, string> = {
  QUEUED: "neutral",
  RINGING: "gold",
  CONNECTED: "green",
  NO_ANSWER: "neutral",
  BUSY: "neutral",
  FAILED: "red",
  COMPLETED: "green",
  AI_UNCERTAIN: "red",
  CALLBACK_REQUESTED: "yellow",
  WRONG_NUMBER: "red",
  ACTIVE: "gold",
  FULFILLED: "green",
  BROKEN: "red",
  SUPERSEDED: "neutral",
  CANCELLED: "neutral",
  OPEN: "gold",
  PAID: "green",
  IN_PROGRESS: "gold",
  RESOLVED: "green",
  PASS: "green",
  FAIL: "red",
  NEEDS_REVIEW: "yellow",
  UNREVIEWED: "neutral",
  TEST: "neutral",
  PRODUCTION: "red",
  WILL_PAY: "green",
  PARTIAL_PAY: "gold",
  CANNOT_PAY: "red",
  ALREADY_PAID: "gold",
  REFUSED: "red",
  UNCLEAR: "neutral",
  DO_NOT_CALL: "red",
};

const TONE_CLASSES: Record<string, string> = {
  gold: "border-[color:var(--gold)]/50 text-[color:var(--gold-bright)] bg-[color:var(--gold)]/10",
  green: "border-[color:var(--green)]/50 text-[color:var(--green-bright)] bg-[color:var(--green)]/10",
  yellow: "border-[color:var(--yellow)]/50 text-[color:var(--yellow-bright)] bg-[color:var(--yellow)]/10",
  red: "border-[color:var(--red)]/50 text-[var(--danger-text)] bg-red-500/10",
  neutral: "border-[color:var(--panel-border)] text-[color:var(--text-dim)] bg-[var(--overlay-2)]",
};

export function Badge({ value, label, tone: toneOverride }: { value: string; label?: string; tone?: string }) {
  const tone = toneOverride ?? STATUS_TONE[value] ?? "neutral";
  return <span className={clsx("chip", TONE_CLASSES[tone])}>{label ?? value.replaceAll("_", " ")}</span>;
}
