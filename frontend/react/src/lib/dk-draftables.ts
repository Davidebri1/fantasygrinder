/**
 * DraftKings "draftables" JSON import — the format a DraftKings export
 * (draftables endpoint) produces.
 *
 * The blob carries real DraftKings salaries and the DraftKings projection
 * (draftStatAttributes id 90, "FPPG"), so imported players show
 * "DraftKings projection" as their projection source instead of the
 * app's season-average estimate.
 */
import type { Player, Sport } from "@/types";

interface DraftStatAttribute {
  id: number;
  value: string;
}

interface DraftablesCompetition {
  name?: string;
  startTime?: string;
}

interface DraftableEntry {
  draftableId?: number;
  displayName?: string;
  position?: string;
  salary?: number;
  status?: string;
  isDisabled?: boolean;
  playerImage160?: string;
  teamAbbreviation?: string;
  competition?: DraftablesCompetition;
  draftStatAttributes?: DraftStatAttribute[];
}

interface DraftablesBlob {
  draftables?: DraftableEntry[];
}

/** The FPPG attribute id in draftStatAttributes — DraftKings' own projection. */
const FPPG_ATTRIBUTE_ID = 90;

/** "JAX @ BAL" → the away and home team abbreviations. */
function parseMatchup(
  name: string | undefined,
): { away: string; home: string } | null {
  if (!name) return null;
  const [away, home] = name.split("@").map((s) => s.trim().toUpperCase());
  if (!away || !home) return null;
  return { away, home };
}

/** The FPPG number, or 0 when DraftKings has none ("-" or missing). */
function fppg(attrs: DraftStatAttribute[] | undefined): number {
  const attr = attrs?.find((a) => a.id === FPPG_ATTRIBUTE_ID);
  if (!attr) return 0;
  const n = Number(attr.value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a DraftKings draftables JSON blob into the app's Player shape.
 * Throws with a plain-language message when nothing usable is in the file.
 */
export function parseDraftables(json: string, sport: Sport): Player[] {
  let blob: DraftablesBlob;
  try {
    blob = JSON.parse(json) as DraftablesBlob;
  } catch {
    throw new Error("That file is not valid DraftKings JSON.");
  }

  const players: Player[] = [];
  for (const entry of blob.draftables ?? []) {
    if (!entry || entry.isDisabled) continue;
    if (!entry.displayName || !entry.draftableId) continue;

    const matchup = parseMatchup(entry.competition?.name);
    const team = entry.teamAbbreviation?.toUpperCase();
    // In "AWAY @ HOME" the away side plays the home side and the other way round.
    const opponent = matchup
      ? team === matchup.away
        ? matchup.home
        : matchup.away
      : undefined;

    players.push({
      // Unique per entry: a Showdown slate lists the same player twice
      // (normal and flex price), each with its own draftableId.
      id: `dk-${entry.draftableId}`,
      name: entry.displayName,
      sport,
      salary: typeof entry.salary === "number" ? entry.salary : 0,
      projection: fppg(entry.draftStatAttributes),
      projection_source: "dk",
      team,
      opponent,
      game_info: entry.competition?.name,
      game_time: entry.competition?.startTime ?? null,
      positions: entry.position ? [entry.position] : undefined,
      roster_positions: entry.position ? [entry.position, "UTIL"] : ["UTIL"],
      injury_status:
        entry.status && entry.status !== "None" ? entry.status : null,
      photo_url: entry.playerImage160 || null,
    });
  }

  if (players.length === 0) {
    throw new Error(
      "No players found in that file. It needs to be a DraftKings JSON export (the file starts with a draftables list).",
    );
  }
  return players;
}
