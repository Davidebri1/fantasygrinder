/**
 * Position families.
 *
 * A position badge is coloured by family, not by decoration, so the shape of
 * a lineup can be read at a glance: are the receivers and the quarterback
 * from the same game? Is the roster all frontcourt? Colour is the fastest
 * signal in a dense table.
 */

export type PositionFamily = "guard" | "wing" | "big" | "quarterback" | "runner" | "receiver" | "tight" | "defense" | "fighter" | "golfer" | "unknown";

const NBA_FAMILY: Record<string, PositionFamily> = {
  PG: "guard",
  SG: "guard",
  SF: "wing",
  PF: "wing",
  C: "big",
};

const NFL_FAMILY: Record<string, PositionFamily> = {
  QB: "quarterback",
  RB: "runner",
  WR: "receiver",
  TE: "tight",
  DST: "defense",
};

export const FAMILY_COLOR: Record<PositionFamily, string> = {
  guard: "#4c8dff",
  wing: "#3ed598",
  big: "#f5b942",
  quarterback: "#ff6a4d",
  runner: "#3ed598",
  receiver: "#4c8dff",
  tight: "#f5b942",
  defense: "#8fb8ff",
  fighter: "#ff6a4d",
  golfer: "#f0c64b",
  unknown: "#9ba7b9",
};

export function positionFamily(
  sport: "nba" | "nfl" | "mma" | "golf",
  position: string | undefined | null,
): PositionFamily {
  const p = (position ?? "").trim().toUpperCase();
  if (!p) return "unknown";
  if (sport === "nba") return NBA_FAMILY[p] ?? "unknown";
  if (sport === "nfl") return NFL_FAMILY[p] ?? "unknown";
  if (sport === "mma") return "fighter";
  return "golfer";
}

/** The short badge text for a player, e.g. "SG" or "QB". */
export function positionLabel(
  sport: "nba" | "nfl" | "mma" | "golf",
  positions: string[] | undefined | null,
): string {
  if (!positions || positions.length === 0) return "";
  if (sport === "mma") return "";
  if (sport === "golf") return "";
  return positions[0].trim().toUpperCase();
}
