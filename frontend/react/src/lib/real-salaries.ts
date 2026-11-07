/**
 * Salary provenance.
 *
 * A salary field holds a real published DraftKings price, or it holds
 * nothing. A modelled price never sits in that field — it lives in its own
 * field (salary_estimate) and is shown in its own column, which the user
 * can hide with one click.
 *
 * A placeholder is a placeholder: "Pending", not a number pretending to be
 * a price. The solver already refuses any player whose salary is not a real
 * positive number, so a pool without prices produces no lineups rather than
 * lineups built on a guess.
 */
import type { Player } from "@/types";

/** True when this salary is a real published DraftKings price. */
export function salaryIsReal(player: Player): boolean {
  return player.salary_source === "dk" && player.salary > 0;
}

/**
 * Display text for a salary cell. A real price shows bare; anything else
 * shows as Pending, because there is no price to show.
 */
export function salaryDisplay(player: Player): { text: string; real: boolean } {
  if (salaryIsReal(player)) {
    return {
      text: "$" + Math.round(player.salary).toLocaleString("en-US"),
      real: true,
    };
  }
  return { text: "Pending", real: false };
}

/**
 * The modelled price, for its own column. It is never a price the user can
 * enter and it never reaches the solver.
 */
export function salaryEstimateDisplay(player: Player): {
  text: string;
  present: boolean;
} {
  if (salaryIsReal(player)) return { text: "—", present: false };
  const est = player.salary_estimate;
  if (est === undefined || est === null || est <= 0) {
    return { text: "—", present: false };
  }
  return {
    text: "$" + Math.round(est).toLocaleString("en-US"),
    present: true,
  };
}
