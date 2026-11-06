/**
 * Lineup card — one built lineup, shown the way a DFS player reads one.
 *
 * The header carries the four numbers that decide whether the lineup is
 * worth entering: rank, projected points, salary, and Roto Score. The table
 * below carries the reasoning — who is in it, against whom, for how much,
 * and how close each player is to the best available at his position.
 *
 * Roto Score is this app's own measure: a player's projected points against
 * the best projected points available at his position on this slate. 100
 * means he is the best of his position.
 *
 * Every name in the card is a way in: click a player to open his sheet,
 * click a crest to narrow the pool to that team.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Lock, Unlock } from "lucide-react";

import { cn, fmtDecimal, fmtMoney } from "@/lib/utils";
import { poolHasRealSalaries } from "@/lib/real-salaries";
import { PlayerChip } from "./PlayerChip";
import { TeamCrest } from "./TeamCrest";
import type { Lineup, Player, Sport } from "@/types";

export interface RotoContext {
  /** Best projected points available at each position label. */
  bestByPosition: Map<string, number>;
  /** Players in the pool, keyed by id. */
  byId: Map<string, Player>;
  /** The sport being built, for the crests. */
  sport?: Sport;
}

function playerRst(player: Player, ctx: RotoContext): number {
  const positions = player.roster_positions ?? player.positions ?? [];
  let best = 0;
  for (const pos of positions) {
    const v = ctx.bestByPosition.get(pos) ?? 0;
    if (v > best) best = v;
  }
  if (best <= 0) return 0;
  return (player.projection / best) * 100;
}

export function lineupRst(lineup: Lineup, ctx: RotoContext): number {
  let weighted = 0;
  let total = 0;
  for (const a of lineup.assignments) {
    const p = ctx.byId.get(a.player_id);
    if (!p) continue;
    const weight = p.projection;
    weighted += playerRst(p, ctx) * weight;
    total += weight;
  }
  if (total <= 0) return 0;
  return weighted / total;
}

/**
 * A readable text version of the lineup, for the clipboard.
 *
 * The point of copying a lineup is to paste it into a notes app or a
 * message, so it reads as sentences rather than as a table.
 */
export function lineupText(lineup: Lineup, ctx: RotoContext): string {
  // Salary only appears in the copy when the pool has real salaries.
  const hasRealSalaries = poolHasRealSalaries([...ctx.byId.values()]);
  const lines: string[] = [
    `Fantasy Grinder — Lineup #${lineup.rank}`,
    `Projected: ${fmtDecimal(lineup.total_projection)} points`,
    ...(hasRealSalaries ? [`Salary: ${fmtMoney(lineup.total_salary)}`] : []),
    `Roto Score: ${fmtDecimal(lineupRst(lineup, ctx))}%`,
    "",
  ];
  for (const a of lineup.assignments) {
    const p = ctx.byId.get(a.player_id);
    const opponent = p?.opponent ? ` vs ${p.opponent}` : "";
    const salary = p ? fmtMoney(p.salary) : "—";
    const points = p ? fmtDecimal(p.projection) : "—";
    const rst = p ? fmtDecimal(playerRst(p, ctx)) : "—";
    lines.push(
      hasRealSalaries
        ? `${a.slot} — ${a.player_name}${opponent} — ${salary} — ${points} points — Roto Score ${rst}%`
        : `${a.slot} — ${a.player_name}${opponent} — ${points} points — Roto Score ${rst}%`,
    );
  }
  return lines.join("\n");
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the manual path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function RotoLineupCard({
  lineup,
  ctx,
  index,
  exposure,
  onTeamClick,
  onOpponentClick,
  onPlayerClick,
  onCopyLineup,
  onLockLineup,
  locked,
  kept,
  onToggleKeep,
}: {
  lineup: Lineup;
  ctx: RotoContext;
  index: number;
  /** Percentage of the portfolio that contains this player, by id. */
  exposure: Map<string, number>;
  /** Narrow the pool to a team. */
  onTeamClick?: (abbr: string) => void;
  /** Narrow the pool to the team this player is playing against. */
  onOpponentClick?: (abbr: string) => void;
  /** Open a player. */
  onPlayerClick?: (playerId: string) => void;
  /** Override what "Copy lineup" does. */
  onCopyLineup?: (lineup: Lineup) => void;
  /** Lock this lineup. */
  onLockLineup?: (lineup: Lineup) => void;
  /** Whether this lineup is locked. */
  locked?: boolean;
  /**
   * The same toggle under the names the optimizer screen uses. Aliases, not
   * a second behaviour — one of the two pairs decides the button.
   */
  kept?: boolean;
  onToggleKeep?: (lineup: Lineup) => void;
}) {
  const rst = lineupRst(lineup, ctx);
  // Lock and keep are the same decision under two names.
  const isKept = locked ?? kept ?? false;
  const toggleKeep = onLockLineup ?? onToggleKeep;
  const keepWording = !onLockLineup && !!onToggleKeep;
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (onCopyLineup) {
      onCopyLineup(lineup);
      return;
    }
    const ok = await writeToClipboard(lineupText(lineup, ctx));
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  /**
   * How many players from this lineup share a team. This is the stack.
   */
  const stackCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of lineup.assignments) {
      const p = ctx.byId.get(a.player_id);
      if (!p?.team) continue;
      counts.set(p.team, (counts.get(p.team) ?? 0) + 1);
    }
    return counts;
  }, [lineup, ctx]);

  // The pool's salaries are real only when they came from a DraftKings
  // import. The context's byId map IS the pool, so this works wherever the
  // card renders — no extra prop to thread through.
  const hasRealSalaries = useMemo(
    () => poolHasRealSalaries([...ctx.byId.values()]),
    [ctx.byId],
  );

  const sport = ctx.sport ?? "nba";

  return (
    <article
      className="panel reveal overflow-hidden"
      // Cards arrive in rank order — the reveal order is the build order.
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <header className="flex items-stretch">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-chrome text-ink-on-dark">
          <span className="font-condensed text-lg font-bold leading-none">
            #{lineup.rank}
          </span>
        </div>
        <div
          className={cn(
            "flex-1 grid divide-x divide-line bg-surface-2",
            hasRealSalaries ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <HeaderStat label="Projected (est.)" value={fmtDecimal(lineup.total_projection)} />
          {hasRealSalaries && (
            <HeaderStat label="Salary" value={fmtMoney(lineup.total_salary)} />
          )}
          <HeaderStat label="Roto Score" value={`${fmtDecimal(rst)}%`} accent />
        </div>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-inset border-y border-line">
            <th className="label text-left font-normal px-3 py-1.5">Player</th>
            <th className="label text-left font-normal px-2 py-1.5">Team</th>
            <th className="label text-left font-normal px-2 py-1.5">Opp</th>
            {hasRealSalaries && (
              <th className="label text-right font-normal px-2 py-1.5">Salary</th>
            )}
            <th className="label text-right font-normal px-2 py-1.5">Pts (est.)</th>
            <th className="label text-right font-normal px-3 py-1.5">Roto Score</th>
            <th className="label text-right font-normal px-3 py-1.5">Exposure</th>
          </tr>
        </thead>
        <tbody>
          {lineup.assignments.map((a) => {
            const p = ctx.byId.get(a.player_id);
            const rstPct = p ? playerRst(p, ctx) : 0;
            const exp = exposure.get(a.player_id) ?? 0;
            return (
              <tr
                key={`${a.player_id}-${a.slot}`}
                className="border-b border-line last:border-b-0 hover:bg-surface-2/60"
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {p ? (
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="min-w-0"
                      >
                        <PlayerChip
                          player={p}
                          slot={a.slot}
                          size="sm"
                          onClick={
                            onPlayerClick
                              ? () => onPlayerClick(a.player_id)
                              : undefined
                          }
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPlayerClick?.(a.player_id)}
                        className="flex items-center gap-2 min-w-0 text-left"
                      >
                        <span className="truncate">{a.player_name}</span>
                        <span className="label-quiet shrink-0">{a.slot}</span>
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {p?.team ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-1 px-1 -mx-1",
                        onTeamClick &&
                          "cursor-pointer hover:bg-surface-3 transition-colors",
                      )}
                      role={onTeamClick ? "button" : undefined}
                      tabIndex={onTeamClick ? 0 : undefined}
                      onClick={(e) => {
                        if (!onTeamClick) return;
                        e.stopPropagation();
                        onTeamClick(p.team!);
                      }}
                      onKeyDown={(e) => {
                        if (!onTeamClick) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onTeamClick(p.team!);
                        }
                      }}
                    >
                      <TeamCrest sport={p.sport ?? sport} abbr={p.team} size={16} />
                      <span className="text-ink-muted">{p.team}</span>
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {p?.opponent ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-1 px-1 -mx-1",
                        onOpponentClick &&
                          "cursor-pointer hover:bg-surface-3 transition-colors",
                      )}
                      role={onOpponentClick ? "button" : undefined}
                      tabIndex={onOpponentClick ? 0 : undefined}
                      onClick={(e) => {
                        if (!onOpponentClick) return;
                        e.stopPropagation();
                        onOpponentClick(p.opponent!);
                      }}
                      onKeyDown={(e) => {
                        if (!onOpponentClick) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onOpponentClick(p.opponent!);
                        }
                      }}
                    >
                      <TeamCrest
                        sport={p.sport ?? sport}
                        abbr={p.opponent}
                        size={16}
                      />
                      <span className="text-ink-muted">{p.opponent}</span>
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                {hasRealSalaries && (
                  <td className="num px-2 py-1.5 text-right text-ink-muted">
                    {p ? fmtMoney(p.salary) : "—"}
                  </td>
                )}
                <td className="num px-2 py-1.5 text-right">
                  {p ? fmtDecimal(p.projection) : "—"}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <span className="num text-xs text-ink-muted w-10 text-right">
                      {fmtDecimal(rstPct)}%
                    </span>
                    <span className="h-1 w-12 rounded-full bg-surface-3 overflow-hidden hidden sm:block">
                      <span
                        className="block h-full rounded-full bg-brand"
                        style={{
                          width: `${Math.max(0, Math.min(100, rstPct))}%`,
                        }}
                      />
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span
                    className={cn(
                      "num text-xs",
                      exp > 60 ? "text-action" : "text-ink-subtle",
                    )}
                    title={`${fmtDecimal(exp)}% of the portfolio contains this player`}
                  >
                    {fmtDecimal(exp, 0)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {expanded ? (
        <div className="border-t border-line bg-inset/40 px-3 py-3">
          <h3 className="label font-medium text-ink mb-2">Matchup detail</h3>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="label-quiet text-left font-normal pb-1">Slot</th>
                <th className="label-quiet text-left font-normal pb-1">Player</th>
                <th className="label-quiet text-left font-normal pb-1">Opponent</th>
                <th className="label-quiet text-right font-normal pb-1">Projected</th>
                <th className="label-quiet text-right font-normal pb-1">Roto Score</th>
                <th className="label-quiet text-left font-normal pb-1 pl-3">Game</th>
                <th className="label-quiet text-left font-normal pb-1 pl-3">Stack</th>
              </tr>
            </thead>
            <tbody>
              {lineup.assignments.map((a) => {
                const p = ctx.byId.get(a.player_id);
                const game = p?.correlation_group || p?.game_info?.trim() || "—";
                const stack = p?.team
                  ? `${p.team} ${stackCounts.get(p.team) ?? 1}`
                  : "—";
                return (
                  <tr key={`detail-${a.player_id}-${a.slot}`}>
                    <td className="py-1 pr-2 text-ink-subtle">{a.slot}</td>
                    <td className="py-1 pr-2 truncate">{a.player_name}</td>
                    <td className="py-1 pr-2 text-ink-muted">
                      {p?.opponent ?? "—"}
                    </td>
                    <td className="num py-1 pr-2 text-right">
                      {p ? fmtDecimal(p.projection) : "—"}
                    </td>
                    <td className="num py-1 pr-2 text-right text-ink-muted">
                      {p ? `${fmtDecimal(playerRst(p, ctx))}%` : "—"}
                    </td>
                    <td className="py-1 pl-3 text-ink-muted truncate">{game}</td>
                    <td className="py-1 pl-3 text-ink-muted">{stack}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-2 border border-line-strong bg-surface-1 text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-good" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? "Copied" : "Copy lineup"}
        </button>

        <button
          type="button"
          onClick={() => toggleKeep?.(lineup)}
          disabled={!toggleKeep}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-2 border transition-colors",
            isKept
              ? "bg-warn-wash text-warn border-warn/40"
              : "border-line-strong bg-surface-1 text-ink-muted hover:bg-surface-3 hover:text-ink",
            !toggleKeep && "opacity-45 cursor-not-allowed",
          )}
        >
          {isKept ? (
            <Lock className="w-3.5 h-3.5" />
          ) : (
            <Unlock className="w-3.5 h-3.5" />
          )}
          {isKept
            ? keepWording
              ? "Lineup kept"
              : "Lineup locked"
            : keepWording
              ? "Keep lineup"
              : "Lock lineup"}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-2 border border-line-strong bg-surface-1 text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          Matchup detail
        </button>
      </footer>
    </article>
  );
}

function HeaderStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <div className="label-quiet">{label}</div>
      <div className={cn("num text-sm font-semibold", accent && "text-action")}>
        {value}
      </div>
    </div>
  );
}
