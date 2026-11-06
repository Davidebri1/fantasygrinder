/**
 * Salary provenance.
 *
 * Every player in the pool carries a salary, and every salary carries its
 * source. A DraftKings import brings real published prices. Until then, the
 * pool runs on estimates from a published formula (projection -> price) so the
 * optimizer has a cap to balance -- and the UI tags those "(est.)" at every
 * site. The field is never blank, and never silent about where it came from.
 */
import type { Player } from "@/types";

/** True when this salary is a real published DraftKings price. */
export function salaryIsReal(player: Player): boolean {
  return player.salary_source === "dk";
}

/**
 * Display text for a salary cell: the number plus its honest tag.
 * Real prices say nothing extra; estimates say "(est.)".
 */
export function salaryDisplay(player: Player): { text: string; estimate: boolean } {
  const text = "$" + Math.round(player.salary).toLocaleString("en-US");
  return { text, estimate: !salaryIsReal(player) };
}
