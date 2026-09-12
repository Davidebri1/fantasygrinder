/**
 * Lineup results panel — renders the array of `Lineup` returned by the
 * optimizer. Sticky header, scrollable body, per-lineup export.
 */
import { Lineup } from "@/types";
import { cn, fmtDecimal, fmtMoney } from "@/lib/utils";
import { PlayerAvatar } from "./PlayerAvatar";

interface Props {
  lineups: Lineup[];
  sport?: "nba" | "mma" | "golf";
}

export function LineupResultsPanel({ lineups, sport = "nba" }: Props) {
  if (lineups.length === 0) {
    return (
      <div className="bg-white rounded-md border border-slate-200 p-12 text-center text-ink-subtle">
        No lineups yet. Click <strong>Generate Lineups</strong> to run the optimizer.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {lineups.map((lineup) => (
        <article key={lineup.unique_key} className="bg-white rounded-md border border-slate-200 shadow-soft">
          <header className="px-4 py-2.5 flex justify-between items-center bg-slate-50 border-b border-slate-200 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-mono text-ink-subtle">#{lineup.rank}</span>
              <span className="font-medium">{lineup.strategy}</span>
              {lineup.solver_backend === "ortools" && (
                <span className="px-2 py-0.5 bg-accent/10 text-accent rounded text-xs">CP-SAT</span>
              )}
            </div>
            <div className="flex gap-4 tabular-nums">
              <Stat label="Salary" value={fmtMoney(lineup.total_salary)} />
              <Stat label="Proj" value={fmtDecimal(lineup.total_projection)} highlight />
              <Stat label="Ceiling" value={fmtDecimal(lineup.total_ceiling)} />
            </div>
          </header>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 p-4 text-sm">
            {lineup.assignments.map((a) => (
              <div key={a.player_id} className="flex items-center gap-2 min-w-0">
                <PlayerAvatar
                  playerId={a.player_id}
                  name={a.player_name}
                  sport={sport}
                  size={28}
                />
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0",
                    a.score_multiplier >= 1.5
                      ? "bg-purple-100 text-purple-900"
                      : "bg-slate-100 text-ink-muted",
                  )}
                >
                  {a.slot}
                </span>
                <span className="truncate">{a.player_name}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <span className={cn("flex flex-col items-end leading-tight", highlight && "text-brand")}>
      <span className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
