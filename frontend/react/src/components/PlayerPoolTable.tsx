/**
 * Player pool table — TanStack Table, sortable, clickable rows, and
 * lock / like / exclude on every player.
 *
 * Every sport gets the same identity columns. A DFS player has to be able
 * to see who a player is, what position he plays, who he is playing
 * against and when, without switching tabs — so the columns are not left
 * to one sport and dropped for the others. MMA shows the bout and the
 * fighter across from it; golf shows the tee time and the tournament.
 */
import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Heart,
  Lock,
  Unlock,
} from "lucide-react";

import { Player, type Sport } from "@/types";
import { useAppStore } from "@/store";
import { salaryEstimateDisplay, salaryIsReal } from "@/lib/real-salaries";
import { projectionSourceText } from "@/lib/projection-source";
import { cn, fmtMoney, fmtDecimal } from "@/lib/utils";
import type { PoolFilter } from "@/hooks/usePlayerFilters";
import { PlayerChip } from "./PlayerChip";
import { PositionBadge, positionBadgeFor } from "./PlayerDrawer";
import { TeamCrest } from "./TeamCrest";

interface Props {
  sport: Sport;
  players: Player[];
  /** Open a player. The whole row is the trigger. */
  onRowClick?: (player: Player) => void;
  /** Open a player by id. Called as well as `onRowClick` when both are given. */
  onPlayerClick?: (playerId: string) => void;
  /** Narrow the pool by team, position or game. */
  onFilterChange?: (filter: PoolFilter) => void;
  /** The filter currently applied, so the matching rows can be marked. */
  filter?: PoolFilter;
}

const ch = createColumnHelper<Player>();

/** Columns whose values are numbers — right-aligned, tabular figures. */
const NUMERIC_COLUMNS = new Set(["salary", "salary_estimate", "projection"]);

/** The text a position column sorts and displays on. */
function positionText(p: Player): string {
  return positionBadgeFor(p)?.label ?? "";
}

/** The word this sport uses for the thing a player is part of. */
function contestText(p: Player): string {
  return (p.game_info ?? "").trim();
}

export function PlayerPoolTable({
  sport,
  players,
  onRowClick,
  onPlayerClick,
  onFilterChange,
  filter,
}: Props) {
  const updatePlayer = useAppStore((s) => s.updatePlayer);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "projection", desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // The estimated-salary column appears when there is something to show in
  // it, and the user can hide it again with one click.
  const hasEstimates = useMemo(
    () => players.some((p) => salaryEstimateDisplay(p).present),
    [players],
  );
  const showEstimates = columnVisibility.salary_estimate ?? hasEstimates;

  const openable = !!onRowClick || !!onPlayerClick;
  const activate = (player: Player) => {
    onRowClick?.(player);
    onPlayerClick?.(player.id);
  };

  const columns = useMemo(() => {
    const base: ColumnDef<Player, unknown>[] = [];

    // ── Who this is ───────────────────────────────────────────────────
    base.push(
      ch.accessor((r: Player) => r.name, {
        id: "player",
        header: "Player",
        cell: ({ row }) => <PlayerChip player={row.original} size="sm" />,
      }) as ColumnDef<Player, unknown>,
    );

    // ── Position, for every sport ─────────────────────────────────────
    base.push(
      ch.accessor((r: Player) => positionText(r), {
        id: "pos",
        header: "Pos",
        cell: ({ row }) => {
          const badge = positionBadgeFor(row.original);
          if (!badge) return <span className="text-ink-subtle">—</span>;
          return <PositionBadge label={badge.label} family={badge.family} />;
        },
      }) as ColumnDef<Player, unknown>,
    );

    if (sport === "mma") {
      // A fighter has no team. The card and the bout are what he belongs
      // to, and the fighter across from him is his opponent.
      base.push(
        ch.accessor((r: Player) => r.bout ?? "", {
          id: "bout",
          header: "Bout",
        }) as ColumnDef<Player, unknown>,
        ch.accessor((r: Player) => r.opponent ?? "", {
          id: "opponent",
          header: "Opponent",
          cell: ({ row }) => (
            <span className="truncate">
              {row.original.opponent || "—"}
            </span>
          ),
        }) as ColumnDef<Player, unknown>,
        ch.accessor((r: Player) => contestText(r), {
          id: "card",
          header: "Card",
        }) as ColumnDef<Player, unknown>,
      );
    } else if (sport === "golf") {
      base.push(
        ch.accessor((r: Player) => r.tee_time ?? r.game_time ?? "", {
          id: "tee",
          header: "Tee time",
          cell: ({ row }) => {
            const p = row.original;
            const tee = p.tee_time?.trim();
            const start = p.game_time?.trim();
            const value = tee || start;
            if (!value) return <span className="text-ink-subtle">—</span>;
            const d = new Date(value);
            const text = Number.isNaN(d.getTime())
              ? value
              : d.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
            return (
              <span title={tee ? "Tee time" : "Tournament start"}>{text}</span>
            );
          },
        }) as ColumnDef<Player, unknown>,
        ch.accessor((r: Player) => contestText(r), {
          id: "tournament",
          header: "Tournament",
        }) as ColumnDef<Player, unknown>,
      );
    } else {
      // NBA and NFL: the team, the team across from it, and the game.
      base.push(
        ch.accessor((r: Player) => r.team ?? "", {
          id: "team",
          header: "Team",
          cell: ({ row }) => {
            const p = row.original;
            const team = p.team;
            if (!team) return <span className="text-ink-subtle">—</span>;
            const active =
              filter?.kind === "team" &&
              filter.id?.toUpperCase() === team.toUpperCase();
            const body = (
              <>
                <TeamCrest sport={sport} abbr={team} size={18} />
                <span>{team}</span>
              </>
            );
            if (!onFilterChange) {
              return (
                <span className="inline-flex items-center gap-1.5">{body}</span>
              );
            }
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterChange({
                    kind: "team",
                    id: team,
                    label: team,
                  });
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-1 px-1 -mx-1 transition-colors",
                  active
                    ? "bg-brand-wash text-brand-bright"
                    : "hover:bg-surface-3",
                )}
              >
                {body}
              </button>
            );
          },
        }) as ColumnDef<Player, unknown>,
        ch.accessor((r: Player) => r.opponent ?? "", {
          id: "opponent",
          header: "Opp",
          cell: ({ row }) => {
            const p = row.original;
            if (!p.opponent) return <span className="text-ink-subtle">—</span>;
            return (
              <span className="inline-flex items-center gap-1.5">
                <TeamCrest sport={sport} abbr={p.opponent} size={18} />
                <span>{p.opponent}</span>
              </span>
            );
          },
        }) as ColumnDef<Player, unknown>,
        ch.accessor((r: Player) => contestText(r), {
          id: "game",
          header: "Game",
        }) as ColumnDef<Player, unknown>,
      );
    }

    // ── The numbers ───────────────────────────────────────────────────
    base.push(
      ch.accessor("salary", {
        id: "salary",
        header: "Salary",
        cell: (i) => {
          const p = i.row.original;
          if (!salaryIsReal(p)) {
            return <span className="text-ink-subtle">Pending</span>;
          }
          return <span className="tabular-nums">{fmtMoney(p.salary)}</span>;
        },
      }) as ColumnDef<Player, unknown>,
    );
    // The modelled price, in its own column. It is not a price: it never
    // reaches the solver and never appears on a lineup.
    base.push(
      ch.accessor((r: Player) => r.salary_estimate ?? 0, {
        id: "salary_estimate",
        header: "Est. salary",
        cell: (i) => {
          const d = salaryEstimateDisplay(i.row.original);
          if (!d.present) return <span className="text-ink-subtle">—</span>;
          return <span className="tabular-nums text-ink-muted">{d.text}</span>;
        },
      }) as ColumnDef<Player, unknown>,
    );
    base.push(
      ch.accessor("projection", {
        id: "projection",
        header: "Proj (est.)",
        cell: (i) => (
          <span className="tabular-nums">{fmtDecimal(i.getValue<number>())}</span>
        ),
      }) as ColumnDef<Player, unknown>,
      ch.accessor(projectionSourceText, {
        id: "projection_source",
        header: "Projection source",
        cell: ({ row }) => (
          <span className="text-xs text-ink-muted">
            {projectionSourceText(row.original)}
          </span>
        ),
      }) as ColumnDef<Player, unknown>,
    );

    // ── The three decisions ───────────────────────────────────────────
    base.push(
      ch.display({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex gap-1 items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <ActionBtn
                active={!!p.is_locked}
                onClick={() => updatePlayer(sport, p.id, { is_locked: !p.is_locked })}
                title={p.is_locked ? "Unlock" : "Lock"}
              >
                {p.is_locked ? (
                  <Lock className="w-3.5 h-3.5" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
              </ActionBtn>
              <ActionBtn
                active={!!p.is_liked}
                onClick={() => updatePlayer(sport, p.id, { is_liked: !p.is_liked })}
                title="Like (15% boost)"
              >
                <Heart className={cn("w-3.5 h-3.5", p.is_liked && "fill-current")} />
              </ActionBtn>
              <ActionBtn
                active={!!p.is_excluded}
                onClick={() =>
                  updatePlayer(sport, p.id, { is_excluded: !p.is_excluded })
                }
                title="Exclude"
              >
                <Ban className="w-3.5 h-3.5" />
              </ActionBtn>
            </div>
          );
        },
      }) as ColumnDef<Player, unknown>,
    );
    return base;
  }, [sport, updatePlayer, onFilterChange, filter, players]);

  const table = useReactTable({
    data: players,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (players.length === 0) {
    return (
      <div className="bg-surface-1 rounded-2 border border-line p-12 text-center text-ink-subtle">
        No players loaded yet. The live slate fills this table automatically — or
        import a roster file with the <strong>Import CSV</strong> button.
      </div>
    );
  }

  return (
    <div className="well overflow-x-auto">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="label-quiet">{players.length} players</span>
        <button
          type="button"
          onClick={() =>
            setColumnVisibility((v) => ({
              ...v,
              salary_estimate: !showEstimates,
            }))
          }
          className="label-quiet hover:text-ink transition-colors"
        >
          {showEstimates ? "Hide estimated salaries" : "Show estimated salaries"}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-surface-2 border-b border-line">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const numeric = NUMERIC_COLUMNS.has(h.column.id);
                return (
                  <th
                    key={h.id}
                    className={cn(
                      "label font-normal px-3 py-2 group",
                      numeric ? "text-right" : "text-left",
                    )}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={h.column.getToggleSortingHandler()}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-1 px-1 -mx-1 transition-colors",
                        "hover:text-ink focus-visible:text-ink",
                        numeric && "flex-row-reverse",
                        sorted && "text-ink font-medium",
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {sorted === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "group border-t border-line",
                row.original.is_excluded && "opacity-40 line-through",
                row.original.is_locked && "bg-warn/10",
                row.original.is_liked && "bg-good-wash",
                openable && "cursor-pointer hover:bg-surface-2/60",
              )}
              tabIndex={openable ? 0 : undefined}
              onClick={openable ? () => activate(row.original) : undefined}
              onKeyDown={
                openable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activate(row.original);
                      }
                    }
                  : undefined
              }
            >
              {row.getVisibleCells().map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    "px-3 py-2",
                    NUMERIC_COLUMNS.has(c.column.id) && "text-right",
                  )}
                >
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        // The row is the trigger. These buttons are not.
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "px-1.5 py-1 rounded-1 transition-colors",
        active
          ? "bg-brand text-white hover:bg-brand-deep"
          : "text-ink-subtle hover:bg-surface-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
