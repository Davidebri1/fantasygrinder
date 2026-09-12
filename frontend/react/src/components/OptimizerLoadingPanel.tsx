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
    <div className="bg-white border border-slate-200 rounded-md shadow-soft p-8 flex flex-col items-center">
      <Loader2 className="w-10 h-10 text-brand spin" />
      <div className="mt-3 text-sm font-medium text-ink">{message}</div>
      {typeof progress === "number" && (
        <div className="mt-3 w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}
