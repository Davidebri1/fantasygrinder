/**
 * Player pool table — TanStack Table, in-place editable projections,
 * lock/exclude toggles per row.
 *
 * Mirrors the Flutter ``NbaPlayerTable`` widget.
 */
import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Lock, Unlock, Heart, Ban } from "lucide-react";

import { Player } from "@/types";
import { useAppStore } from "@/store";
import { cn, fmtMoney, fmtDecimal } from "@/lib/utils";
import { PlayerAvatar } from "./PlayerAvatar";

interface Props {
  sport: "nba" | "mma" | "golf";
  players: Player[];
}

const ch = createColumnHelper<Player>();

export function PlayerPoolTable({ sport, players }: Props) {
  const updatePlayer = useAppStore((s) => s.updatePlayer);

  const columns = useMemo(() => {
    const base: ColumnDef<Player, unknown>[] = [
      ch.accessor("name", {
        id: "name",
        header: "Player",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <PlayerAvatar
              playerId={row.original.id}
              name={row.original.name}
              sport={sport}
              photoUrl={row.original.photo_url}
              size={32}
            />
            <span className="font-medium truncate">{row.original.name}</span>
          </div>
        ),
      }) as ColumnDef<Player, unknown>,
    ];
    if (sport === "nba") {
      base.push(
        ch.accessor((r: Player) => r.positions?.join("/") ?? "", {
          id: "pos",
          header: "Pos",
        }) as ColumnDef<Player, unknown>,
        ch.accessor("team", { id: "team", header: "Team" }) as ColumnDef<Player, unknown>,
        ch.accessor("opponent", { id: "opponent", header: "Opp" }) as ColumnDef<Player, unknown>,
        ch.accessor("game_info", {
          id: "game_info",
          header: "Game",
        }) as ColumnDef<Player, unknown>,
      );
    }
    if (sport === "mma") {
      base.push(
        ch.accessor("bout", { id: "bout", header: "Bout" }) as ColumnDef<Player, unknown>,
      );
    }
    base.push(
      ch.accessor("salary", {
        id: "salary",
        header: "Salary",
        cell: (i) => <span className="tabular-nums">{fmtMoney(i.getValue<number>())}</span>,
      }) as ColumnDef<Player, unknown>,
      ch.accessor("projection", {
        id: "projection",
        header: "Proj",
        cell: (i) => <span className="tabular-nums">{fmtDecimal(i.getValue<number>())}</span>,
      }) as ColumnDef<Player, unknown>,
      ch.accessor((r: Player) => r.projected_ownership ?? 0, {
        id: "ownership",
        header: "Own %",
        cell: (i) => (
          <span className="tabular-nums text-ink-muted">{fmtDecimal(i.getValue<number>())}</span>
        ),
      }) as ColumnDef<Player, unknown>,
      ch.display({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex gap-1 items-center justify-end">
              <ActionBtn
                active={!!p.is_locked}
                onClick={() => updatePlayer(sport, p.id, { is_locked: !p.is_locked })}
                title={p.is_locked ? "Unlock" : "Lock"}
              >
                {p.is_locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
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
                onClick={() => updatePlayer(sport, p.id, { is_excluded: !p.is_excluded })}
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
  }, [sport, updatePlayer]);

  const table = useReactTable({
    data: players,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (players.length === 0) {
    return (
      <div className="bg-white rounded-md border border-slate-200 p-12 text-center text-ink-subtle">
        No players loaded. Use the <strong>Import</strong> button to load a roster.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white rounded-md border border-slate-200 shadow-soft">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-ink-subtle tracking-wide">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="px-3 py-2 text-left font-medium">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "border-t border-slate-100",
                row.original.is_excluded && "opacity-40 line-through",
                row.original.is_locked && "bg-amber-50",
                row.original.is_liked && "bg-pink-50/40",
              )}
            >
              {row.getVisibleCells().map((c) => (
                <td key={c.id} className="px-3 py-2">
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
      onClick={onClick}
      className={cn(
        "px-1.5 py-1 rounded transition-colors",
        active
          ? "bg-brand text-white hover:bg-brand-700"
          : "text-ink-subtle hover:bg-slate-100 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
