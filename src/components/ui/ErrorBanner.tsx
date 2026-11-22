import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Shown wherever a page's data fetch fails, instead of silently falling back
 * to an empty state — lets the user tell "nothing here" apart from "load
 * failed" and gives them a way to retry without a full page refresh.
 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--red)]/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} className="shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-xs font-medium text-red-200 hover:text-red-100 shrink-0"
          aria-label="Retry loading"
        >
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}
