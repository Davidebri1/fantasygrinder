/**
 * Pool filters.
 *
 * One filter narrows the player pool: a player, a team, a game or a
 * position. The filter is held here rather than in the table so the screen
 * can own it, keep it across a re-render of the pool, and show it as a
 * chip that can be dismissed.
 */
import { useCallback, useMemo, useState } from "react";

import type { Player } from "@/types";

export interface PoolFilter {
  kind: "all" | "player" | "team" | "game" | "position";
  /** Player id, team abbreviation, correlation group key, or position. */
  id?: string;
  /** Human label shown on the chip, e.g. "BOS" or "BOS@NE". */
  label: string;
}

/** The filter that shows the whole pool. */
export const ALL_FILTER: PoolFilter = { kind: "all", label: "All players" };

/**
 * The leading "AWY@HOM" token out of a game string.
 *
 * NBA and NFL players carry "BOS@MIA 7:00pm ET" in `game_info`; the game
 * key is the first token. MMA and golf carry a card or tournament name
 * there, and the same rule gives the card or tournament name.
 */
export function gameKeyOf(player: Player): string {
  const info = (player.game_info ?? "").trim();
  const token = info.split(/\s+/)[0] ?? "";
  return token || (player.correlation_group ?? "");
}

function same(a: string | undefined | null, b: string): boolean {
  return (a ?? "").trim().toUpperCase() === b.trim().toUpperCase();
}

/** Does this player satisfy the filter? */
export function matchesFilter(player: Player, filter: PoolFilter): boolean {
  if (filter.kind === "all") return true;
  const id = filter.id ?? "";
  if (!id) return true;

  switch (filter.kind) {
    case "player":
      return player.id === id;
    case "team":
      return same(player.team, id);
    case "game":
      return (
        same(player.correlation_group, id) || same(gameKeyOf(player), id)
      );
    case "position": {
      const positions = [
        ...(player.roster_positions ?? []),
        ...(player.positions ?? []),
      ];
      return positions.some((p) => same(p, id));
    }
    default:
      return true;
  }
}

export interface PoolFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function usePlayerFilters(players: Player[]): {
  filter: PoolFilter;
  setFilter: (f: PoolFilter) => void;
  clear: () => void;
  filtered: Player[];
  chips: PoolFilterChip[];
  /**
   * The same three things under the names the optimizer screen reads.
   * Aliases, not a second API — they point at the same functions.
   */
  clearFilter: () => void;
  filteredPlayers: Player[];
  filterChips: PoolFilterChip[];
} {
  const [filter, setFilter] = useState<PoolFilter>(ALL_FILTER);

  const clear = useCallback(() => setFilter(ALL_FILTER), []);

  const filtered = useMemo(
    () => players.filter((p) => matchesFilter(p, filter)),
    [players, filter],
  );

  const chips = useMemo(() => {
    if (filter.kind === "all") return [];
    return [
      {
        key: `${filter.kind}:${filter.id ?? filter.label}`,
        label: filter.label,
        onRemove: clear,
      },
    ];
  }, [filter, clear]);

  return {
    filter,
    setFilter,
    clear,
    filtered,
    chips,
    clearFilter: clear,
    filteredPlayers: filtered,
    filterChips: chips,
  };
}
