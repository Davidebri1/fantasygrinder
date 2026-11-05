/**
 * Smart Recommendations panel — "what should I enter?"
 *
 * Shown after the optimizer produces lineups. The user picks a contest
 * (cash / GPP / single entry, with entry fee, field size, and bankroll)
 * and the panel surfaces the recommended N lineups.
 *
 * This is the natural follow-up to "give me 20 lineups": "okay, which
 * ones should I actually play?" — and the right answer depends on the
 * user's contest profile.
 */
import { useMemo, useState } from "react";

import { Card } from "./Card";
import { buildContestPresets, recommendPicks, type ContestProfile } from "@/recommend";
import type { Lineup, Sport } from "@/types";
import { fmtDecimal, fmtMoney } from "@/lib/utils";
import { ROI_NOTICE } from "@/lib/data-provenance";

interface Props {
  sport: Sport;
  lineups: Lineup[];
}

export function RecommendationsPanel({ sport, lineups }: Props) {
  const presets = useMemo(() => buildContestPresets(sport), [sport]);
  const [active, setActive] = useState<ContestProfile>(presets[0]);
  const [maxEntries, setMaxEntries] = useState<number>(3);

  if (lineups.length === 0) {
    return (
      <Card className="p-5" title="Smart Recommendations">
        <p className="text-sm text-ink-muted">
          Generate lineups first — recommendations will tell you which of
          them to enter based on your contest.
        </p>
      </Card>
    );
  }

  const picks = useMemo(
    () => recommendPicks(lineups, active, maxEntries),
    [lineups, active, maxEntries],
  );

  const totalCost = picks.length * active.entryFee;
  const affordable = totalCost <= active.bankroll;
  const totalRoi = picks.reduce((s, p) => s + p.estimatedRoi, 0) / Math.max(picks.length, 1);

  return (
    <Card
      className="p-5"
      title="Smart Recommendations"
      actions={
        <span className="text-xs text-ink-subtle">
          Based on your contest, here's what to enter
        </span>
      }
    >
      {/* Contest selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {presets.map((p, idx) => {
          const key = `${p.type}-${p.entryFee}-${p.fieldSize}`;
          const isActive = active === p;
          return (
            <button
              key={key}
              onClick={() => {
                setActive(p);
                setMaxEntries(Math.max(1, Math.min(p.bankroll / p.entryFee, 3)));
              }}
              className={
                "text-left border rounded-2 px-3 py-2 text-xs " +
                (isActive
                  ? "border-brand bg-brand-wash text-ink"
                  : "border-line hover:border-line-strong text-ink-muted")
              }
            >
              <div className="label font-medium text-ink">
                {p.type === "gpp" ? "GPP" : p.type === "cash" ? "Cash" : "Single"}
              </div>
              <div className="text-sm text-ink font-medium">
                {fmtMoney(p.entryFee)} entry
              </div>
              <div className="text-[10px] text-ink-subtle">
                {p.fieldSize.toLocaleString()} entries
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom contest override */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
        <label className="block">
          <div className="text-ink-muted mb-1">Entry fee</div>
          <input
            type="number"
            value={active.entryFee}
            min={0}
            onChange={(e) =>
              setActive({ ...active, entryFee: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full bg-inset text-ink border border-line rounded-1 px-2 py-1.5 focus:border-brand"
          />
        </label>
        <label className="block">
          <div className="text-ink-muted mb-1">Field size</div>
          <input
            type="number"
            value={active.fieldSize}
            min={1}
            onChange={(e) =>
              setActive({ ...active, fieldSize: Math.max(1, Number(e.target.value) || 1) })
            }
            className="w-full bg-inset text-ink border border-line rounded-1 px-2 py-1.5 focus:border-brand"
          />
        </label>
        <label className="block">
          <div className="text-ink-muted mb-1">Bankroll</div>
          <input
            type="number"
            value={active.bankroll}
            min={0}
            onChange={(e) =>
              setActive({ ...active, bankroll: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-full bg-inset text-ink border border-line rounded-1 px-2 py-1.5 focus:border-brand"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Max entries</span>
          <input
            type="number"
            min={1}
            max={lineups.length}
            value={maxEntries}
            onChange={(e) =>
              setMaxEntries(Math.max(1, Math.min(lineups.length, Number(e.target.value) || 1)))
            }
            className="w-20 bg-inset text-ink border border-line rounded-1 px-2 py-1.5 focus:border-brand"
          />
        </label>
        <span
          className={
            "px-2 py-1 rounded-1 text-xs font-medium " +
            (affordable
              ? "bg-good-wash text-good"
              : "bg-danger-wash text-danger")
          }
        >
          Total: {fmtMoney(totalCost)}{" "}
          {affordable
            ? "fits in bankroll"
            : "— over bankroll, reduce entries"}
        </span>
        <span className="text-xs text-ink-subtle">
          Avg est. ROI (model):{" "}
          <strong className="text-ink">{(totalRoi * 100).toFixed(0)}%</strong>
        </span>
      </div>

      {/* Picks */}
      <div className="space-y-2">
        {picks.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No lineups fit your bankroll at this entry fee. Lower the fee or
            raise the bankroll.
          </p>
        ) : (
          picks.map((p, idx) => (
            <div
              key={p.lineup.unique_key}
              className="flex items-center gap-3 border border-line rounded-2 bg-surface-2 px-3 py-2"
            >
              <span className="text-xs text-ink-subtle font-mono w-6">
                {idx + 1}
              </span>
              <div className="flex-1">
                <div className="text-xs text-ink-muted">{p.reason}</div>
                <div className="text-sm text-ink">
                  <strong className="font-semibold">
                    {fmtMoney(p.lineup.total_salary)}
                  </strong>{" "}
                  salary (est.) · {fmtDecimal(p.lineup.total_projection)} proj
                  (est.) ·{" "}
                  <span
                    className={
                      p.estimatedRoi > 0 ? "text-good" : "text-danger"
                    }
                  >
                    {(p.estimatedRoi * 100).toFixed(0)}% est. ROI (model)
                  </span>{" "}
                  <span className="text-ink-subtle">
                    · {(p.estimatedCashRate * 100).toFixed(0)}% est. cash rate
                  </span>
                </div>
              </div>
              <button
                onClick={() => navigator.clipboard?.writeText(p.lineup.unique_key)}
                className="text-xs text-ink-subtle hover:text-ink"
                title="Copy lineup key"
              >
                copy
              </button>
            </div>
          ))
        )}
      </div>

      {picks.length > 0 && (
        <p className="text-[11px] text-ink-subtle mt-3 leading-relaxed">
          Recommendation scoring is intentionally simple: cash picks = highest
          projected floor; GPP picks = projection × uniqueness; single-entry =
          best projection. Adjust the inputs above to match your actual
          contest.
          <br />
          {ROI_NOTICE}
        </p>
      )}
    </Card>
  );
}
