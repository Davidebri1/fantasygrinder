/**
 * Single-lineup card (used in the ownership summary plus mini-cards).
 */
import { Lineup } from "@/types";
import { fmtMoney, fmtDecimal } from "@/lib/utils";
import { PlayerAvatar } from "./PlayerAvatar";

interface Props {
  lineup: Lineup;
  sport?: "nba" | "mma" | "golf";
  compact?: boolean;
}

export function LineupCard({ lineup, sport = "nba", compact = false }: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-soft text-sm">
      <header className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs tabular-nums">
        <span className="font-mono text-ink-subtle">#{lineup.rank}</span>
        <span className="flex gap-3">
          <span>{fmtMoney(lineup.total_salary)}</span>
          <span className="font-semibold text-brand">{fmtDecimal(lineup.total_projection)}</span>
        </span>
      </header>
      <ul className={`px-3 ${compact ? "py-1.5" : "py-2"} space-y-1.5`}>
        {lineup.assignments.map((a) => (
          <li key={a.player_id} className="flex items-center gap-1.5 text-xs">
            <span
              className={
                "px-1 rounded font-medium text-[10px] tracking-wide shrink-0 " +
                (a.score_multiplier >= 1.5
                  ? "bg-purple-100 text-purple-900"
                  : "bg-slate-100 text-ink-muted")
              }
            >
              {a.slot}
            </span>
            <PlayerAvatar
              playerId={a.player_id}
              name={a.player_name}
              sport={sport}
              size={20}
            />
            <span className="truncate">{a.player_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
