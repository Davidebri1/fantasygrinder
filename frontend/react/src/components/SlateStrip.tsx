/**
 * Slate strip — the games on tonight's board.
 *
 * Reads like a schedule board: tip time on top, the two teams underneath.
 * It is the first thing you check before building anything, so it sits
 * directly under the slate header.
 *
 * The teams are shown as crests, not as abbreviations, because a crest is
 * the fastest way to recognise a team. Clicking a game narrows the player
 * pool to that game.
 */
import { cn } from "@/lib/utils";
import { TeamCrest } from "@/components/TeamCrest";

export interface SlateGame {
  id: string;
  label: string;
  startTime: string | null;
  state: string;
  detail: string;
}

function tipTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function SlateStrip({
  games,
  sport = "nba",
  onGameClick,
}: {
  games: SlateGame[];
  sport?: "nba" | "nfl" | "mma" | "golf";
  /** Clicking a game narrows the pool to the players in it. */
  onGameClick?: (game: SlateGame) => void;
}) {
  if (games.length === 0) {
    return (
      <p className="label-quiet px-1 py-3">
        No games are scheduled right now. The optimizer will use the last
        slate it pulled.
      </p>
    );
  }
  return (
    <div className="well overflow-hidden">
      <div className="flex gap-0 overflow-x-auto">
        {games.map((g) => {
          // Team sports label the fixture "AWY @ HOM"; MMA labels the bout
          // "Fighter A vs Fighter B". Only the first has an away and a home.
          const parts = g.label.split("@").map((s) => s.trim());
          const isFixture = parts.length === 2 && parts[0] && parts[1];
          const live = g.state === "in";
          const final = g.state === "post";
          const clickable = !!onGameClick && isFixture;
          return (
            <button
              key={g.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onGameClick?.(g)}
              className={cn(
                "min-w-[128px] flex-1 px-3 py-2.5 border-r border-line last:border-r-0 text-left transition-colors",
                clickable && "hover:bg-surface-3 cursor-pointer",
                !clickable && "cursor-default",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "label-quiet",
                    live && "text-good",
                    final && "text-ink-subtle",
                  )}
                >
                  {live ? "Live" : final ? "Final" : tipTime(g.startTime)}
                </span>
                {live && <span className="w-1.5 h-1.5 rounded-full bg-good live-dot" />}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                {isFixture ? (
                  <>
                    <TeamCrest
                      sport={sport}
                      abbr={parts[0]}
                      size={20}
                      showFallbackText={false}
                    />
                    <span className="font-condensed font-semibold text-ink">
                      {parts[0]}
                    </span>
                    <span className="text-ink-subtle text-xs">at</span>
                    <TeamCrest
                      sport={sport}
                      abbr={parts[1]}
                      size={20}
                      showFallbackText={false}
                    />
                    <span className="font-condensed font-semibold text-ink">
                      {parts[1]}
                    </span>
                  </>
                ) : (
                  <span className="font-condensed font-semibold text-ink truncate">
                    {g.label}
                  </span>
                )}
              </div>
              {g.detail && !live && !final && !g.startTime && (
                <div className="label-quiet mt-0.5 truncate">{g.detail}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
