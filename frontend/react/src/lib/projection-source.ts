/**
 * Where a projection number came from, in plain words.
 *
 * One place, so the pool table and the export can never disagree about
 * whose number this is.
 */
import type { Player } from "@/types";

/**
 * A hand-edited number is always the customer's own. Otherwise it is
 * whoever published it.
 */
export function projectionSourceText(p: Player): string {
  if (p.user_projection != null) return "My projection (edited)";
  switch (p.projection_source) {
    case "dk":
      return "DraftKings projection";
    case "rotowire":
      return "Rotowire projection";
    case "mine":
      return "My projection";
    default:
      return "Season-average (est.)";
  }
}
