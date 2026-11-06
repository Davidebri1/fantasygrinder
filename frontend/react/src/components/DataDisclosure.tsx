/**
 * Disclosure surfaces for data honesty.
 *
 * Two banners, both of them unconditional when they appear:
 *
 *  - `SampleDataBanner` — the roster on screen is a bundled sample because
 *    the live feed could not be reached. Loud, amber, unmissable.
 *  - `EstimateNotice` — projections, salaries and ownership are modelled
 *    estimates. Quiet, persistent, attached to every surface that shows them.
 */
import { AlertTriangle, Info } from "lucide-react";

import { ESTIMATE_NOTICE, SAMPLE_NOTICE } from "@/lib/data-provenance";

export function SampleDataBanner({ className = "" }: { className?: string }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-2 border px-3.5 py-2.5 text-xs ${className}`}
      style={{
        borderColor: "var(--warn)",
        background: "var(--warn-wash)",
        color: "var(--warn)",
      }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="leading-relaxed">
        <strong className="font-semibold">Sample roster.</strong>{" "}
        {SAMPLE_NOTICE.replace(/^Sample roster — /, "")}
      </span>
    </div>
  );
}

export function EstimateNotice({
  className = "",
  mode = "estimate",
}: {
  className?: string;
  /** "estimate" = ESPN pool, modelled numbers; "dk" = a real DraftKings slate. */
  mode?: "estimate" | "dk";
}) {
  const text =
    mode === "dk"
      ? "Salaries and projections on this slate are DraftKings' own published numbers. Ownership is modelled."
      : ESTIMATE_NOTICE;
  return (
    <p
      className={`flex items-start gap-2 text-[11px] leading-relaxed text-ink-subtle ${className}`}
    >
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
