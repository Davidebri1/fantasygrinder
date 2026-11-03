/**
 * Exposure report — how the portfolio is actually distributed.
 *
 * Every DFS decision is an exposure decision: a lineup that leans on one
 * player is a bet, and a portfolio that leans on him 90% of the time is a
 * different product. This is the readout that makes that visible, broken
 * out the way a DFS player reads it — all players first, then one column
 * per roster slot, because "how often does my tight end show up" is the
 * question that actually changes a lineup.
 *
 * Every row is a way in: click a player to open his sheet, click a team to
 * narrow the pool to that team.
 */
import { useMemo, useState } from "react";
import { cn, fmtDecimal } from "@/lib/utils";
import { PlayerAvatar } from "./PlayerAvatar";
import { PositionBadge, positionBadgeFor } from "./PlayerDrawer";
import { TeamCrest } from "./TeamCrest";
import { slotBuckets } from "@/optimizer/sports";
import type { Lineup, Player } from "@/types";

type Mode = "players" | "teams";

interface Exposure {
  /** Player id → share of the portfolio that contains them. */
  byPlayer: Map<string, number>;
  /** Team → share of the portfolio that contains them. */
  byTeam: Map<string, number>;
  /** Player id → the slot labels they occupied. */
  slotsByPlayer: Map<string, Set<string>>;
}

export function computeExposure(
  lineups: Lineup[],
  byId: Map<string, Player>,
): Exposure {
  const playerCount = new Map<string, number>();
  const teamCount = new Map<string, number>();
  const slotsByPlayer = new Map<string, Set<string>>();
  const total = lineups.length;

  for (const lineup of lineups) {
    const teamsHere = new Set<string>();
    for (const a of lineup.assignments) {
      playerCount.set(a.player_id, (playerCount.get(a.player_id) ?? 0) + 1);
      let slots = slotsByPlayer.get(a.player_id);
      if (!slots) {
        slots = new Set<string>();
        slotsByPlayer.set(a.player_id, slots);
      }
      slots.add(a.slot);
      const p = byId.get(a.player_id);
      if (p?.team) teamsHere.add(p.team);
    }
    for (const t of teamsHere) {
      teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
    }
  }

  const byPlayer = new Map<string, number>();
  for (const [id, n] of playerCount) {
    byPlayer.set(id, total > 0 ? (n / total) * 100 : 0);
  }
  const byTeam = new Map<string, number>();
  for (const [t, n] of teamCount) {
    byTeam.set(t, total > 0 ? (n / total) * 100 : 0);
  }
  return { byPlayer, byTeam, slotsByPlayer };
}

export function ExposureReport({
  lineups,
  players,
  slots,
  onPlayerClick,
  onTeamClick,
}: {
  lineups: Lineup[];
  players: Player[];
  slots: { label: string; accepts: string[] | null }[];
  /** Open a player. */
  onPlayerClick?: (playerId: string) => void;
  /** Narrow the pool to a team. */
  onTeamClick?: (abbr: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("players");
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const exposure = useMemo(
    () => computeExposure(lineups, byId),
    [lineups, byId],
  );

  const buckets = useMemo(() => slotBuckets(slots), [slots]);

  // The sport the crests belong to. Every player on a screen is from the
  // same sport, so the roster's first player names it.
  const sport = players[0]?.sport ?? "nba";

  if (lineups.length === 0) {
    return null;
  }

  // For the player view each column is the players who filled that slot.
  const columnEntries = (slot: string | null): { id: string; label: string; pct: number }[] => {
    if (mode === "teams") {
      return [...exposure.byTeam.entries()]
        .map(([id, pct]) => ({ id, label: id, pct }))
        .sort((a, b) => b.pct - a.pct);
    }
    const rows: { id: string; label: string; pct: number }[] = [];
    for (const [id, pct] of exposure.byPlayer) {
      if (slot !== null) {
        const used = exposure.slotsByPlayer.get(id);
        if (!used || !used.has(slot)) continue;
      }
      const p = byId.get(id);
      rows.push({ id, label: p?.name ?? id, pct });
    }
    return rows.sort((a, b) => b.pct - a.pct);
  };

  const all = columnEntries(null);
  const columns: { slot: string | null; title: string; rows: typeof all }[] = [
    { slot: null, title: "All players", rows: all },
    ...buckets.map((b) => ({
      slot: b.slot,
      title: b.title,
      rows: columnEntries(b.slot),
    })),
  ];

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Exposure report</h2>
          <p className="label mt-1 max-w-[62ch]">
            The share of your portfolio that contains each player or team. Use
            it to find the picks doing too much work — and the spots where
            you are thin.
          </p>
        </div>
        <div className="flex gap-1 p-1 rounded-2 bg-inset border border-line">
          {(["players", "teams"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "px-3 h-7 text-sm rounded-1 transition-colors",
                mode === m
                  ? "bg-surface-1 text-ink font-medium shadow-1"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {m === "players" ? "By player" : "By team"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {columns.map((col) => (
          <div key={col.title ?? "all"} className="well p-3">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="label font-medium text-ink">{col.title}</h3>
              <span className="label-quiet num">{col.rows.length}</span>
            </div>
            {col.rows.length === 0 ? (
              <p className="label-quiet">No one.</p>
            ) : (
              <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {col.rows.slice(0, 40).map((row) => {
                  const p = byId.get(row.id);
                  const badge = p ? positionBadgeFor(p) : null;
                  const clickable =
                    mode === "players" ? !!onPlayerClick : !!onTeamClick;
                  const activate = () => {
                    if (mode === "players") onPlayerClick?.(row.id);
                    else onTeamClick?.(row.id);
                  };

                  // The name owns the line; the bar sits under it. Laying
                  // them out side by side squeezed the names down to
                  // initials, which is exactly the information a DFS
                  // player needs most.
                  const line = (
                    <>
                      {mode === "players" ? (
                        <>
                          <PlayerAvatar
                            playerId={row.id}
                            name={row.label}
                            sport={p?.sport ?? sport}
                            size={20}
                          />
                          {badge ? (
                            <PositionBadge
                              label={badge.label}
                              family={badge.family}
                              size={18}
                            />
                          ) : null}
                        </>
                      ) : (
                        <TeamCrest sport={sport} abbr={row.id} size={18} />
                      )}
                      <span className="truncate text-sm flex-1 min-w-0">
                        {row.label}
                      </span>
                      <span
                        className={cn(
                          "num text-xs shrink-0",
                          row.pct > 60 ? "text-action font-medium" : "text-ink-muted",
                        )}
                      >
                        {fmtDecimal(row.pct, 0)}%
                      </span>
                    </>
                  );

                  return (
                    <li key={row.id}>
                      {clickable ? (
                        <button
                          type="button"
                          onClick={activate}
                          className="w-full text-left rounded-1 px-1 -mx-1 hover:bg-surface-3 focus-visible:bg-surface-3 transition-colors"
                        >
                          <span className="flex items-center gap-2">{line}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">{line}</div>
                      )}
                      <div className="mt-1 h-1 rounded-full bg-surface-3 overflow-hidden">
                        <div
                          className={cn(
                            "block h-full rounded-full",
                            row.pct > 60 ? "bg-action" : "bg-brand",
                          )}
                          style={{ width: `${Math.min(100, row.pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
