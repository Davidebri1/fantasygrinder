/**
 * Team identity — the crest and the colour behind it.
 *
 * The crest is the real logo, pulled from ESPN's CDN, because a team mark is
 * information: it tells you who you are looking at faster than three letters
 * can. ESPN does not always have a file under the abbreviation the feed
 * gives us, so every crest falls back to a monogram on the team's own
 * colour. The fallback is never a grey box.
 */

/**
 * The abbreviations ESPN actually uses in its NBA feeds, with the older
 * three-letter forms kept as aliases. ESPN calls the Knicks "NY", the
 * Pelicans "NO", the Spurs "SA", the Jazz "UTAH" and the Warriors "GS",
 * and its logo CDN is filed under those same names — get this wrong and
 * every crest for those teams silently falls back to a monogram.
 */
const NBA_COLORS: Record<string, string> = {
  ATL: "#e03a3e",
  BOS: "#007a33",
  BKN: "#c8102e",
  CHA: "#1d1160",
  CHI: "#000000",
  CLE: "#860038",
  DAL: "#00538c",
  DEN: "#0e2240",
  DET: "#1d42ba",
  GS: "#1d428a",
  GSW: "#1d428a",
  HOU: "#ce1141",
  IND: "#002d62",
  LAC: "#0089c6",
  LAL: "#552583",
  MEM: "#5d76a9",
  MIA: "#98002e",
  MIL: "#00471b",
  MIN: "#0c2340",
  NO: "#0c2340",
  NOP: "#0c2340",
  NY: "#006bb6",
  NYK: "#006bb6",
  OKC: "#007ac1",
  ORL: "#0077c0",
  PHI: "#006bb6",
  PHX: "#1d1160",
  POR: "#e03a3e",
  SAC: "#5a2d81",
  SA: "#c4ced4",
  SAS: "#c4ced4",
  TOR: "#ce1141",
  UTAH: "#002b5c",
  UTA: "#002b5c",
  WAS: "#002b5c",
  WSH: "#002b5c",
};

const NFL_COLORS: Record<string, string> = {
  ARI: "#97233f",
  ATL: "#a71930",
  BAL: "#241773",
  BUF: "#00338d",
  CAR: "#0085ca",
  CHI: "#0b162a",
  CIN: "#fb4f14",
  CLE: "#311d00",
  DAL: "#003594",
  DEN: "#fb4f14",
  DET: "#0076b6",
  GB: "#203731",
  HOU: "#03202f",
  IND: "#002c5f",
  JAX: "#006778",
  KC: "#e31837",
  LV: "#000000",
  LAC: "#0080c6",
  LAR: "#003594",
  MIA: "#008997",
  MIN: "#4f2683",
  NE: "#002244",
  NO: "#d3bc8d",
  NYG: "#0b2265",
  NYJ: "#125740",
  PHI: "#004c54",
  PIT: "#ffb612",
  SEA: "#002244",
  SF: "#aa0000",
  TB: "#d50a0a",
  TEN: "#0c2340",
  WAS: "#5a1414",
  WSH: "#5a1414",
};

const COLORS: Record<string, Record<string, string>> = {
  nba: NBA_COLORS,
  nfl: NFL_COLORS,
};

/** ESPN's team logo CDN. The abbreviation matches the one the feed uses. */
export function crestUrl(
  sport: "nba" | "nfl" | "mma" | "golf",
  abbr: string | undefined | null,
): string | null {
  if (!abbr) return null;
  const key = abbr.trim().toUpperCase();
  if (sport !== "nba" && sport !== "nfl") return null;
  if (!COLORS[sport][key]) return null;
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${key.toLowerCase()}.png`;
}

/** The team's own colour, used behind the monogram fallback. */
export function teamColor(
  sport: "nba" | "nfl" | "mma" | "golf",
  abbr: string | undefined | null,
): string {
  if (!abbr) return "#4c8dff";
  const key = abbr.trim().toUpperCase();
  const table = COLORS[sport];
  if (table && table[key]) return table[key];
  // Fall back to hashing the abbreviation so the monogram is still in the
  // team's family rather than a flat grey.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 44%, 42%)`;
}
