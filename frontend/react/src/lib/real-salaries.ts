/**
 * Real-salary detection.
 *
 * DraftKings does not publish salaries anywhere public and neither does
 * ESPN, so a player only has a real salary when it came from a DraftKings
 * draftables import. Everything the app used to invent here is gone: no
 * real salary means the pool has none.
 */
import type { Player } from "@/types";

/**
 * Does this pool carry real salaries? True when any player was imported
 * from DraftKings or otherwise arrived with a nonzero salary.
 */
export function poolHasRealSalaries(players: Player[]): boolean {
  return players.some((p) => p.salary_source === "dk" || p.salary > 0);
}
