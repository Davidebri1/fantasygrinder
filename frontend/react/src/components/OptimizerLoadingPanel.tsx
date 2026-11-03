/**
 * Compact loading panel with progress messaging.
 *
 * Mirrors Flutter ``OptimizerLoadingPanel``.
 */
import { Loader2 } from "lucide-react";

interface Props {
  message?: string;
  progress?: number; // 0..1
}

export function OptimizerLoadingPanel({ message = "Running optimizer…", progress }: Props) {
  return (
    <div className="bg-surface-1 border border-line rounded-2 shadow-2 p-8 flex flex-col items-center">
      <Loader2 className="w-10 h-10 text-brand animate-spin" />
      <div className="mt-3 text-sm font-medium text-ink">{message}</div>
      {typeof progress === "number" && (
        <div className="mt-3 w-64 h-2 bg-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full w-full bg-brand origin-left transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress * 100)) / 100})` }}
          />
        </div>
      )}
    </div>
  );
}
