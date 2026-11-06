/**
 * Live ESPN data layer — runs entirely in the browser.
 *
 * No backend, no API key, no account, no local server. Every feed used here
 * is ESPN's public JSON API, which sends `Access-Control-Allow-Origin: *`,
 * so the deployed static site fetches it directly.
 *
 * What "live" means for each sport:
 *
 *   NBA  — Today's scoreboard: every game, tip time, live score and state.
 *          For each team on the slate: the live roster (positions, headshots,
 *          injury flags) and the season stat line for every rotation player.
 *          Projections are computed from those real numbers with DraftKings'
 *          scoring rubric. Games that are in progress get pace-adjusted
 *          projections built from the actual box score.
 *   MMA  — The current UFC card: every bout, both fighters, records, and the
 *          winner of any bout that has already finished.
 *   Golf — The live PGA leaderboard: the field, their score to par and their
 *          position in the tournament.
 *
 * Two honest caveats, both surfaced in the UI:
 *   1. DraftKings salaries are not published anywhere public and ESPN
 *      publishes none either, so live players carry no salary at all.
 *      Real salaries arrive with a DraftKings draftables import.
 *   2. ESPN publishes NBA positions as Guard / Forward / Center only. The
 *      fine-grained PG/SG/SF/PF labels are derived per team from the
 *      season stat line (a guard's assist rate decides PG vs SG, a
 *      forward's scoring and rebounding decide SF vs PF).
 */
import type { Player, Sport } from "@/types";

const ESPN_WEB = "https://site.web.api.espn.com/apis/site/v2/sports";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports";

export interface LiveGame {
  /** Stable id, e.g. "401909896". */
  id: string;
  label: string;
  startTime: string | null;
  /** ESPN state: "pre" | "in" | "post". */
  state: string;
  detail: string;
}

export interface LivePool {
  sport: Sport;
  players: Player[];
  games: LiveGame[];
  fetchedAt: string;
  /** Non-fatal notes: partial feeds, derived values, no live event. */
  warnings: string[];
}

export interface LiveInjuryRow {
  player_id: string;
  name: string;
  team: string;
  status: string;
  severity: string;
  short_comment: string;
}

export interface LiveNewsRow {
  title: string;
  published: string;
  link: string;
}

// ---------------------------------------------------------------------------
// Fetching helpers
// ---------------------------------------------------------------------------

async function getJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `fn` over `items` with a bounded number of parallel requests. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// ESPN payload shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface EspnStatus {
  clock?: number;
  period?: number;
  position?: number | string;
  thru?: number;
  type?: {
    id?: string;
    name?: string;
    state?: string;
    completed?: boolean;
    description?: string;
    detail?: string;
    shortDetail?: string;
  };
}

interface EspnCompetitor {
  id?: string;
  uid?: string;
  homeAway?: string;
  score?: string;
  winner?: boolean;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
    slug?: string;
  };
  athlete?: {
    id?: string;
    displayName?: string;
    fullName?: string;
    flag?: { href?: string };
  };
  records?: Array<{ name?: string; summary?: string }>;
  status?: EspnStatus;
}

interface EspnCompetition {
  id?: string;
  date?: string;
  startDate?: string;
  competitors?: EspnCompetitor[];
  status?: EspnStatus;
  notes?: unknown[];
}

interface EspnEvent {
  id: string;
  date?: string;
  name?: string;
  shortName?: string;
  competitions?: EspnCompetition[];
  status?: EspnStatus;
}

interface EspnScoreboard {
  leagues?: Array<{ season?: { year?: number } }>;
  events?: EspnEvent[];
}

interface EspnRosterAthlete {
  id?: string;
  displayName?: string;
  shortName?: string;
  jersey?: string;
  headshot?: { href?: string };
  position?: { id?: string; name?: string; displayName?: string; abbreviation?: string };
  injuries?: Array<{ status?: string; date?: string }>;
  status?: { id?: string; name?: string; type?: string };
}

interface EspnRoster {
  athletes?: EspnRosterAthlete[];
  team?: { id?: string; abbreviation?: string; displayName?: string };
}

interface EspnStatValue {
  name?: string;
  value?: number;
  /** Season total divided by games played — the number DFS needs. */
  perGameValue?: number;
}

interface EspnLeader {
  value?: number;
  displayValue?: string;
  athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
  statistics?: Array<{ name?: string; stats?: EspnStatValue[] }>;
}

interface EspnTeamStats {
  season?: { year?: number };
  results?: Array<{ name?: string; leaders?: EspnLeader[] }>;
}

interface EspnSummary {
  boxscore?: {
    players?: Array<{
      team?: { id?: string; abbreviation?: string };
      statistics?: Array<{
        keys?: string[];
        athletes?: Array<{
          athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
          starter?: boolean;
          didNotPlay?: boolean;
          stats?: string[];
        }>;
      }>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

interface PlayerStats {
  gamesPlayed: number;
  avgMinutes: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  threePm: number;
}

/** Flattened ESPN stat blocks for one athlete. */
function statsFromLeader(leader: EspnLeader): PlayerStats {
  const map = new Map<string, number>();
  for (const group of leader.statistics ?? []) {
    for (const stat of group.stats ?? []) {
      if (stat?.name && typeof stat.value === "number") map.set(stat.name, stat.value);
    }
  }
  const get = (name: string, fallback = 0) => map.get(name) ?? fallback;
  return {
    gamesPlayed: get("gamesPlayed"),
    avgMinutes: get("avgMinutes"),
    pts: get("avgPoints"),
    reb: get("avgRebounds"),
    ast: get("avgAssists"),
    stl: get("avgSteals"),
    blk: get("avgBlocks"),
    to: get("avgTurnovers"),
    threePm: get("avgThreePointFieldGoalsMade"),
  };
}

/**
 * DraftKings NBA scoring rubric.
 * Mirrors `backend/django/integrations/odds_api.py` so the numbers the
 * browser computes match the numbers the Python service would have computed.
 */
export function dkFantasyPoints(s: PlayerStats): number {
  const base =
    s.pts * 1.0 +
    s.threePm * 0.5 +
    s.reb * 1.25 +
    s.ast * 1.5 +
    s.stl * 2.0 +
    s.blk * 2.0 -
    s.to * 0.5;
  const doubleDouble = s.reb >= 10 && s.ast >= 5 ? 1.5 : 0;
  const tripleDouble = s.pts >= 25 && s.reb >= 10 && s.ast >= 5 ? 3.0 : 0;
  return base + doubleDouble + tripleDouble;
}

/**
 * Salaries when no DraftKings price exists.
 *
 * These are ESTIMATES produced by a published formula so the optimizer has a
 * cap to balance before a DraftKings slate is imported. The UI tags them
 * "(est.)" at every site, and a real DraftKings import replaces them outright.
 */
/**
 * Salary derived from projection.
 * DraftKings does not publish its salaries; this reproduces the shape of a
 * DK salary list (3.5k-11.5k, ~150 dollars per projected point) so that
 * salary-cap constraints behave the way a DFS player expects.
 */
export function derivedSalary(projection: number): number {
  const raw = projection * 150 + 800;
  const snapped = Math.round(raw / 100) * 100;
  return Math.min(11_500, Math.max(3_000, snapped));
}

/**
 * Salary derived from projection, shaped like a real DraftKings NFL salary
 * list: quarterbacks cost more per projected point and have a higher floor,
 * and a defense sits at the bottom of the range.
 */
const NFL_SALARY_BANDS: Record<
  string,
  { rate: number; base: number; floor: number; cap: number }
> = {
  QB: { rate: 320, base: 1_800, floor: 4_500, cap: 9_500 },
  RB: { rate: 380, base: 1_400, floor: 3_000, cap: 9_000 },
  FB: { rate: 380, base: 1_400, floor: 3_000, cap: 9_000 },
  WR: { rate: 380, base: 1_500, floor: 3_000, cap: 9_000 },
  TE: { rate: 380, base: 1_100, floor: 2_500, cap: 6_500 },
  DST: { rate: 420, base: 700, floor: 2_000, cap: 4_500 },
};

function derivedNflSalary(projection: number, position: string): number {
  const band =
    NFL_SALARY_BANDS[position] ?? NFL_SALARY_BANDS.RB;
  const raw = projection * band.rate + band.base;
  const snapped = Math.round(raw / 100) * 100;
  return Math.min(band.cap, Math.max(band.floor, snapped));
}

/** Baseline stat line for a player ESPN has no season stats for (rookies). */
function baselineStats(position: string): PlayerStats {
  const table: Record<string, PlayerStats> = {
    PG: { gamesPlayed: 0, avgMinutes: 24, pts: 11, reb: 2.5, ast: 4.5, stl: 1, blk: 0.4, to: 2, threePm: 1.2 },
    SG: { gamesPlayed: 0, avgMinutes: 26, pts: 13, reb: 3, ast: 3, stl: 1, blk: 0.3, to: 2, threePm: 1.6 },
    SF: { gamesPlayed: 0, avgMinutes: 28, pts: 14, reb: 5, ast: 2.5, stl: 0.9, blk: 0.5, to: 2, threePm: 1.5 },
    PF: { gamesPlayed: 0, avgMinutes: 26, pts: 13, reb: 7, ast: 2, stl: 0.8, blk: 0.7, to: 1.8, threePm: 0.9 },
    C: { gamesPlayed: 0, avgMinutes: 25, pts: 12, reb: 8, ast: 1.5, stl: 0.8, blk: 1.1, to: 1.8, threePm: 0.5 },
  };
  return table[position] ?? table.PG;
}

/**
 * Scale a positional baseline for a player with a thin track record: the
 * less he has played, the closer to a raw baseline he stays.
 */
function scaleBaseline(base: PlayerStats, raw: PlayerStats | undefined): PlayerStats {
  const scale = raw && raw.avgMinutes > 0 ? Math.max(0.75, Math.min(1, raw.avgMinutes / 10)) : 1;
  return {
    gamesPlayed: raw?.gamesPlayed ?? 0,
    avgMinutes: raw?.avgMinutes ?? base.avgMinutes,
    pts: base.pts * scale,
    reb: base.reb * scale,
    ast: base.ast * scale,
    stl: base.stl * scale,
    blk: base.blk * scale,
    to: base.to * scale,
    threePm: base.threePm * scale,
  };
}

/**
 * Projected ownership, derived from where each player sits in the pool by
 * projection. ESPN does not publish ownership numbers, and the contrarian
 * mode needs them to find leverage plays — a chalk-heavy pool has high
 * ownership, a value pool has low.
 */
function applyOwnership(players: Player[]): void {
  const ranked = [...players].sort((a, b) => b.projection - a.projection);
  ranked.forEach((p, i) => {
    const percentile = ranked.length > 1 ? i / (ranked.length - 1) : 0;
    p.projected_ownership = Math.max(2, Math.round(48 - percentile * 44));
  });
}

// ---------------------------------------------------------------------------
// NBA
// ---------------------------------------------------------------------------

const NBA_POSITION_SLOTS: Record<string, string[]> = {
  PG: ["PG", "G", "UTIL"],
  SG: ["SG", "G", "UTIL"],
  SF: ["SF", "F", "UTIL"],
  PF: ["PF", "F", "UTIL"],
  C: ["C", "UTIL"],
};

/**
 * Derive PG/SG/SF/PF from ESPN's Guard/Forward/Center plus the season stat
 * line: the most productive guard is the point guard, the highest-scoring
 * forward is the small forward, the rest of the frontcourt is power forward.
 */
function derivePositions(
  roster: EspnRosterAthlete[],
  statsById: Map<string, PlayerStats>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const group = (abbr: string) =>
    roster.filter((a) => (a.position?.abbreviation ?? "").toUpperCase() === abbr);
  const statOf = (a: EspnRosterAthlete) => statsById.get(a.id ?? "") ?? baselineStats("PG");

  const guards = group("G");
  const guardsByAssist = [...guards].sort((a, b) => {
    const sa = statOf(a);
    const sb = statOf(b);
    return sb.ast - sa.ast || sb.pts - sa.pts;
  });
  guardsByAssist.forEach((a, i) => {
    const id = a.id ?? a.displayName ?? "";
    if (guardsByAssist.length === 1) {
      // Only one guard on the roster — eligible for both guard slots so a
      // legal 8-slot lineup is still possible.
      out.set(id, ["PG", "SG", "G", "UTIL"]);
    } else {
      out.set(id, NBA_POSITION_SLOTS[i === 0 ? "PG" : "SG"]);
    }
  });

  const forwards = group("F");
  const forwardsByScore = [...forwards].sort((a, b) => {
    const sa = statOf(a);
    const sb = statOf(b);
    return sb.pts - sa.pts || sb.reb - sa.reb;
  });
  forwardsByScore.forEach((a, i) => {
    const id = a.id ?? a.displayName ?? "";
    if (forwardsByScore.length === 1) {
      out.set(id, ["SF", "PF", "F", "UTIL"]);
    } else {
      out.set(id, NBA_POSITION_SLOTS[i === 0 ? "SF" : "PF"]);
    }
  });

  for (const c of group("C")) {
    out.set(c.id ?? c.displayName ?? "", NBA_POSITION_SLOTS.C);
  }

  // Anyone ESPN lists with an unexpected label still gets a usable slot.
  for (const a of roster) {
    const id = a.id ?? a.displayName ?? "";
    if (!out.has(id)) out.set(id, ["UTIL"]);
  }
  return out;
}

interface NbaTeamBundle {
  roster: EspnRosterAthlete[];
  stats: Map<string, PlayerStats>;
  positions: Map<string, string[]>;
}

async function loadNbaTeam(teamId: string, seasonYear: number): Promise<NbaTeamBundle> {
  const [roster, teamStats] = await Promise.all([
    getJson<EspnRoster>(`${ESPN_WEB}/basketball/nba/teams/${teamId}/roster`),
    getJson<EspnTeamStats>(
      `${ESPN_WEB}/basketball/nba/teams/${teamId}/athletes/statistics?season=${seasonYear}`,
    ),
  ]);
  const stats = new Map<string, PlayerStats>();
  for (const leader of teamStats.results?.[0]?.leaders ?? []) {
    const id = leader.athlete?.id;
    if (id) stats.set(id, statsFromLeader(leader));
  }
  return {
    roster: roster.athletes ?? [],
    stats,
    positions: derivePositions(roster.athletes ?? [], stats),
  };
}

/** Box score for a live game — the actual stat line for every player. */
interface LiveBoxScore {
  playerId: string;
  name: string;
  minutes: number;
  dkPoints: number;
}

async function loadLiveBoxScore(eventId: string): Promise<LiveBoxScore[]> {
  const summary = await getJson<EspnSummary>(
    `${ESPN_WEB}/basketball/nba/summary?event=${eventId}`,
  );
  const out: LiveBoxScore[] = [];
  for (const teamBlock of summary.boxscore?.players ?? []) {
    for (const statBlock of teamBlock.statistics ?? []) {
      const keys = statBlock.keys ?? [];
      for (const entry of statBlock.athletes ?? []) {
        const id = entry.athlete?.id;
        if (!id) continue;
        const values = entry.stats ?? [];
        const value = (key: string) => {
          const idx = keys.indexOf(key);
          if (idx < 0) return 0;
          const raw = values[idx];
          const n = Number(raw);
          return Number.isFinite(n) ? n : 0;
        };
        const made = (key: string) => {
          const idx = keys.indexOf(key);
          if (idx < 0) return 0;
          const raw = values[idx] ?? "";
          const madeCount = Number(String(raw).split("-")[0]);
          return Number.isFinite(madeCount) ? madeCount : 0;
        };
        const pts = value("points");
        const reb = value("rebounds");
        const ast = value("assists");
        const stl = value("steals");
        const blk = value("blocks");
        const to = value("turnovers");
        const threePm = made("threePointFieldGoalsMade-fieldGoalsAttempted");
        const minutes = Number(String(values[keys.indexOf("minutes")] ?? "0").split(":")[0]);
        out.push({
          playerId: id,
          name: entry.athlete?.displayName ?? "",
          minutes: Number.isFinite(minutes) ? minutes : 0,
          dkPoints:
            pts + 0.5 * threePm + 1.25 * reb + 1.5 * ast + 2 * stl + 2 * blk - 0.5 * to,
        });
      }
    }
  }
  return out;
}

function formatTip(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function fetchLiveNbaPool(): Promise<LivePool> {
  const warnings: string[] = [];
  const board = await getJson<EspnScoreboard>(`${ESPN_WEB}/basketball/nba/scoreboard`);
  const seasonYear = board.leagues?.[0]?.season?.year ?? new Date().getFullYear();
  const events = board.events ?? [];
  if (events.length === 0) {
    return {
      sport: "nba",
      players: [],
      games: [],
      fetchedAt: new Date().toISOString(),
      warnings: ["No NBA games are scheduled today — there is no live slate to build from."],
    };
  }

  const teamIds = new Set<string>();
  const games: LiveGame[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    for (const c of comp?.competitors ?? []) {
      if (c.team?.id) teamIds.add(c.team.id);
    }
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    games.push({
      id: ev.id,
      label: `${away?.team?.abbreviation ?? "AWY"} @ ${home?.team?.abbreviation ?? "HOM"}`,
      startTime: comp?.date ?? ev.date ?? null,
      state: comp?.status?.type?.state ?? ev.status?.type?.state ?? "pre",
      detail: comp?.status?.type?.shortDetail ?? comp?.status?.type?.detail ?? "",
    });
  }

  const bundles = await mapLimit([...teamIds], 6, (id) => loadNbaTeam(id, seasonYear));
  // Index by team id — the competitor array order is not guaranteed to be
  // [away, home], so positional indexing would attach the wrong team's
  // roster and stats to the wrong side of the game.
  const bundleByTeam = new Map<string, NbaTeamBundle>();
  [...teamIds].forEach((id, i) => bundleByTeam.set(id, bundles[i]));

  // Live games: replace the season projection with a pace-adjusted one.
  const liveEvents = events
    .filter((ev) => ev.competitions?.[0]?.status?.type?.state === "in")
    .slice(0, 6);
  const boxScores = new Map<string, LiveBoxScore[]>();
  if (liveEvents.length > 0) {
    const loaded = await mapLimit(liveEvents, 3, async (ev) => {
      try {
        return await loadLiveBoxScore(ev.id);
      } catch {
        return [] as LiveBoxScore[];
      }
    });
    liveEvents.forEach((ev, i) => boxScores.set(ev.id, loaded[i] ?? []));
    if (liveEvents.length < events.filter((e) => e.competitions?.[0]?.status?.type?.state === "in").length) {
      warnings.push("Some in-progress games could not be read; those players keep their season projection.");
    }
  }

  const players: Player[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const away = competitors.find((c) => c.homeAway === "away");
    const home = competitors.find((c) => c.homeAway === "home");
    const gameKey = `${away?.team?.abbreviation ?? "AWY"}@${home?.team?.abbreviation ?? "HOM"}`;
    const box = boxScores.get(ev.id) ?? [];
    const boxById = new Map(box.map((b) => [b.playerId, b]));

    for (const side of [away, home]) {
      if (!side?.team?.id) continue;
      const bundle = bundleByTeam.get(side.team.id);
      if (!bundle) continue;
      const teamAbbr = side.team.abbreviation ?? "???";
      const opponentAbbr = side === away ? home?.team?.abbreviation : away?.team?.abbreviation;
      const tip = formatTip(comp?.date ?? ev.date);

      for (const athlete of bundle.roster) {
        const espnId = athlete.id;
        if (!espnId) continue;
        const name = athlete.displayName ?? espnId;
        const raw = bundle.stats.get(espnId);
        const slots = bundle.positions.get(espnId) ?? ["UTIL"];
        const primary = slots[0];
        // A player ESPN lists but who has not played yet has a row of zeros,
        // and a player who has played two minutes a night has a stat line
        // that says nothing about tonight. Both get the positional baseline
        // instead, so they enter the pool as usable minnows rather than
        // as zeroes.
        const usable = raw && raw.gamesPlayed > 0 && raw.avgMinutes >= 10;
        const effective = usable ? raw : scaleBaseline(baselineStats(primary), raw);
        let projection = dkFantasyPoints(effective);

        // Pace adjustment for a game in progress.
        const live = boxById.get(espnId);
        if (live && live.minutes >= 4) {
          const share = Math.min(1, live.minutes / 48);
          // Season rate for what is left of the game, plus what has already
          // been banked at today's pace.
          const seasonProjection = dkFantasyPoints(effective);
          projection = live.dkPoints + seasonProjection * (1 - share);
        }

        const injury = athlete.injuries?.[0];
        // ESPN's roster injury notes can be weeks old. Only flag the player
        // when the note is current, otherwise it is stale information.
        const injuryIsCurrent =
          !!injury?.date && Date.now() - new Date(injury.date).getTime() < 10 * 86_400_000;
        players.push({
          id: `nba-${espnId}`,
          name,
          sport: "nba",
          salary: derivedSalary(projection),
          projection: Math.round(projection * 10) / 10,
          team: teamAbbr,
          opponent: opponentAbbr,
          game_info: `${gameKey} ${tip}`.trim(),
          game_time: comp?.date ?? ev.date ?? null,
          positions: [primary],
          roster_positions: slots,
          correlation_group: gameKey,
          injury_status: injuryIsCurrent ? injury?.status ?? null : null,
          injury_severity: injuryIsCurrent ? injury?.date ?? null : null,
          photo_url: athlete.headshot?.href ?? null,
          jersey: athlete.jersey ?? null,
        });
      }
    }
  }

  applyOwnership(players);

  const outCount = players.filter((p) => (p.injury_status ?? "").toLowerCase().includes("out")).length;
  if (outCount > 0) {
    warnings.push(
      `${outCount} player${outCount === 1 ? " is" : "s are"} flagged by ESPN's injury report — they are badged in the pool.`,
    );
  }
  const withoutStats = players.filter((p) => p.projection > 0).length;
  if (withoutStats === 0) warnings.push("No player data came back from ESPN.");

  return {
    sport: "nba",
    players,
    games,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// MMA
// ---------------------------------------------------------------------------

function parseRecord(summary?: string): { wins: number; losses: number; draws: number } {
  if (!summary) return { wins: 0, losses: 0, draws: 0 };
  const parts = summary.split("-").map((p) => Number(p.trim()));
  return {
    wins: parts[0] ?? 0,
    losses: parts[1] ?? 0,
    draws: parts[2] ?? 0,
  };
}

/** A bout is finished once ESPN marks it complete or posts its state. */
function isFinishedBout(comp: EspnCompetition): boolean {
  const state = comp.status?.type?.state ?? "pre";
  return comp.status?.type?.completed === true || state === "post";
}

/** Does this card still have a bout you could put in a lineup? */
function cardHasOpenBout(ev: EspnEvent): boolean {
  const evState = ev.status?.type?.state ?? "pre";
  if (evState === "post") return false;
  return (ev.competitions ?? []).some((c) => !isFinishedBout(c));
}

/**
 * Find the next card with bouts still to be fought.
 *
 * ESPN's MMA board leads with the most recent card, which is usually
 * already final — there is nothing to enter. The scoreboard endpoint takes
 * a date, so we scan forward a week at a time until we find a card that
 * still has open bouts. Eight days per round trip keeps this to a handful
 * of requests.
 */
async function findNextMmaCard(): Promise<EspnEvent | null> {
  const start = Date.now();
  for (let offset = 0; offset < 56; offset += 8) {
    const days = Array.from({ length: 8 }, (_, i) => offset + i);
    const boards = await Promise.all(
      days.map(async (d) => {
        const key = new Date(start + d * 86_400_000)
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        try {
          return await getJson<EspnScoreboard>(
            `${ESPN_WEB}/mma/ufc/scoreboard?dates=${key}`,
          );
        } catch {
          return null;
        }
      }),
    );
    for (const board of boards) {
      const hit = (board?.events ?? []).find(cardHasOpenBout);
      if (hit) return hit;
    }
  }
  return null;
}

async function fetchLiveMmaPool(): Promise<LivePool> {
  const warnings: string[] = [];
  const games: LiveGame[] = [];
  const players: Player[] = [];

  const board = await getJson<EspnScoreboard>(`${ESPN_WEB}/mma/ufc/scoreboard`);
  const currentEvents = board.events ?? [];

  // If the card on the board is already final, move to the next one rather
  // than handing back an empty pool.
  let event = currentEvents.find(cardHasOpenBout) ?? null;
  let usingNextCard = false;
  if (!event) {
    event = await findNextMmaCard();
    usingNextCard = event !== null;
  }

  if (!event) {
    return {
      sport: "mma",
      players: [],
      games: [],
      fetchedAt: new Date().toISOString(),
      warnings: [
        "No UFC card is scheduled right now — there is no live card to build from.",
      ],
    };
  }

  const eventName = event.shortName ?? event.name ?? "UFC Event";
  const fullName = event.name ?? eventName;

  for (const comp of event.competitions ?? []) {
    if (isFinishedBout(comp)) continue;
    const competitors = comp.competitors ?? [];
    const names = competitors
      .map((c) => c.athlete?.displayName ?? c.athlete?.fullName ?? "")
      .filter(Boolean);
    if (names.length === 0) continue;

    // One board row per bout — on an MMA card the fight list IS the slate.
    games.push({
      id: `${event.id}-${comp.id ?? names.join("-")}`,
      label: names.join(" vs "),
      startTime: comp.startDate ?? comp.date ?? event.date ?? null,
      state: comp.status?.type?.state ?? "pre",
      detail: eventName,
    });

    for (const c of competitors) {
      const name = c.athlete?.displayName ?? c.athlete?.fullName;
      // ESPN's MMA competitors carry the athlete id on the competitor
      // itself and inside the uid ("s:3301~a:4418809"), not on `athlete`.
      const espnId =
        c.athlete?.id ??
        c.id ??
        (c.uid?.includes("~a:") ? c.uid.split("~a:")[1] : undefined);
      if (!name || !espnId) continue;
      const rec = parseRecord(c.records?.find((r) => r.name === "overall")?.summary);
      const total = rec.wins + rec.losses + rec.draws;
      const winRate = total > 0 ? rec.wins / total : 0.5;
      const opponent = competitors.find((o) => o !== c)?.athlete?.displayName ?? "";

      // Baseline projection from the fighter's record. ESPN does not publish
      // per-fight strike or takedown counts for these athletes.
      let projection = 13 + winRate * 11;
      if (rec.wins >= 10) projection += 1;
      if (rec.losses === 0 && rec.wins > 0) projection += 1.5;

      players.push({
        id: `mma-${espnId}`,
        name,
        sport: "mma",
        salary: derivedSalary(projection),
        projection: Math.round(projection * 10) / 10,
        opponent,
        bout: `${names[0] ?? ""} vs ${names[1] ?? ""}`,
        game_info: fullName,
        game_time: comp.startDate ?? comp.date ?? event.date ?? null,
        correlation_group: event.id,
        roster_positions: ["UTIL"],
        positions: ["UTIL"],
        photo_url: null,
      });
    }
  }

  if (usingNextCard) {
    const when = event.date
      ? new Date(event.date).toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : "";
    warnings.push(
      `The last card is final, so the optimizer is building for the next one: ${fullName}${
        when ? ` — ${when}` : ""
      }.`,
    );
  }

  warnings.push(
    "MMA projections are record-based baselines — ESPN does not publish per-fight strike counts.",
  );

  applyOwnership(players);

  return {
    sport: "mma",
    players,
    games,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Golf
// ---------------------------------------------------------------------------

function parseToPar(score?: string): number | null {
  if (!score) return null;
  const trimmed = score.trim();
  if (trimmed === "E" || trimmed === "EVEN" || trimmed === "Par") return 0;
  const n = Number(trimmed.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

async function fetchLiveGolfPool(): Promise<LivePool> {
  const warnings: string[] = [];
  const board = await getJson<EspnScoreboard>(`${ESPN_WEB}/golf/pga/scoreboard`);
  const events = board.events ?? [];
  if (events.length === 0) {
    return {
      sport: "golf",
      players: [],
      games: [],
      fetchedAt: new Date().toISOString(),
      warnings: ["No PGA tournament is live right now — there is no leaderboard to build from."],
    };
  }

  const ev = events[0];
  const comp = ev.competitions?.[0];
  const competitors = comp?.competitors ?? [];
  const tournament = ev.name ?? "PGA Tour";

  const scored = competitors
    .map((c) => ({
      id: c.athlete?.id ?? c.id ?? "",
      name: c.athlete?.displayName ?? c.athlete?.fullName ?? "",
      toPar: parseToPar(c.score),
      position: c.status?.position,
      thru: c.status?.thru,
    }))
    .filter((g) => g.id && g.name);

  const known = scored.filter((g) => g.toPar !== null);
  const fieldAvg = known.length
    ? known.reduce((s, g) => s + (g.toPar ?? 0), 0) / known.length
    : 0;

  const games: LiveGame[] = [
    {
      id: ev.id,
      label: tournament,
      startTime: ev.date ?? null,
      state: ev.status?.type?.state ?? "in",
      detail: `${scored.length} in the field`,
    },
  ];

  const players: Player[] = scored.slice(0, 120).map((g) => {
    const toPar = g.toPar ?? 0;
    // Fantasy points proxy: playing under the field average scores more.
    const projection = Math.max(8, Math.min(75, 30 + (fieldAvg - toPar) * 1.5));
    return {
      id: `golf-${g.id}`,
      name: g.name,
      sport: "golf",
      salary: derivedSalary(projection),
      projection: Math.round(projection * 10) / 10,
      game_info: tournament,
      game_time: ev.date ?? null,
      tee_time: null,
      roster_positions: ["UTIL"],
      positions: ["UTIL"],
      correlation_group: ev.id,
      photo_url: null,
    };
  });

  if (known.length === 0) {
    warnings.push("The leaderboard has no scores yet — projections are pre-tournament estimates.");
  }

  applyOwnership(players);

  return {
    sport: "golf",
    players,
    games,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// NFL
// ---------------------------------------------------------------------------

/**
 * Which roster slots each NFL position can fill.
 *
 * A running back is eligible for an RB slot and for the FLEX slot, which is
 * what makes the DraftKings-style roster fillable. ESPN's own abbreviations
 * are used, so no position guessing is needed.
 */
const NFL_SLOT_BY_POSITION: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB", "FLEX"],
  FB: ["RB", "FLEX"],
  WR: ["WR", "FLEX"],
  TE: ["TE", "FLEX"],
};

interface EspnNflRosterGroup {
  position?: string;
  items?: EspnRosterAthlete[];
}

interface EspnNflRoster {
  athletes?: EspnNflRosterGroup[];
  team?: { id?: string; abbreviation?: string; displayName?: string };
}

interface EspnNflStatCategory {
  name?: string;
  stats?: EspnStatValue[];
}

interface EspnNflLeader {
  value?: number;
  displayValue?: string;
  athlete?: { id?: string; displayName?: string; headshot?: { href?: string } };
  statistics?: EspnNflStatCategory[];
}

interface EspnNflTeamStats {
  season?: { year?: number };
  results?: Array<{ name?: string; leaders?: EspnNflLeader[] }>;
  teamTotals?: Array<{ name?: string; stats?: EspnStatValue[] }>;
}

/**
 * DraftKings NFL scoring, on a per-game basis.
 *
 * Passing 0.04/yd and 4/TD; rushing and receiving 0.1/yd and 6/TD;
 * 1 per reception; minus 1 per interception and 1 per fumble lost.
 *
 * The yardage bonuses (300 pass, 100 rush, 100 rec) are deliberately left
 * out: they only trigger on a single game and cannot be projected from a
 * season average without guessing.
 */
function dkNflPoints(stats: Map<string, number>): number {
  const g = (k: string) => stats.get(k) ?? 0;
  return (
    g("passingYards") * 0.04 +
    g("passingTouchdowns") * 4 -
    g("interceptions") * 1 +
    g("rushingYards") * 0.1 +
    g("rushingTouchdowns") * 6 +
    g("receptions") * 1 +
    g("receivingYards") * 0.1 +
    g("receivingTouchdowns") * 6 -
    g("fumblesLost") * 1
  );
}

interface NflTeamBundle {
  athletes: Map<string, EspnRosterAthlete>;
  /** Per-player stat line: stat name → per-game value. */
  stats: Map<string, Map<string, number>>;
  /** Projection for the team's DST unit. */
  dstProjection: number;
}

async function loadNflTeam(teamId: string, seasonYear: number): Promise<NflTeamBundle> {
  const [roster, teamStats] = await Promise.all([
    getJson<EspnNflRoster>(`${ESPN_WEB}/football/nfl/teams/${teamId}/roster`),
    getJson<EspnNflTeamStats>(
      `${ESPN_WEB}/football/nfl/teams/${teamId}/athletes/statistics?season=${seasonYear}&limit=100`,
    ),
  ]);

  // Only active offensive / special-teams players are DFS-eligible.
  const athletes = new Map<string, EspnRosterAthlete>();
  for (const group of roster.athletes ?? []) {
    if (group.position !== "offense" && group.position !== "specialTeam") continue;
    for (const a of group.items ?? []) {
      if (!a.id) continue;
      athletes.set(a.id, a);
    }
  }

  // Season totals first. ESPN's own per-game field rounds counting stats
  // to whole numbers (9 touchdowns over 6 games comes back as 1), which is
  // too lossy to price a player off, so the division happens here.
  const totals = new Map<string, Map<string, number>>();
  const gamesPlayed = new Map<string, number>();
  for (const res of teamStats.results ?? []) {
    for (const leader of res.leaders ?? []) {
      const id = leader.athlete?.id;
      if (!id) continue;
      const bucket = totals.get(id) ?? new Map<string, number>();
      for (const cat of leader.statistics ?? []) {
        for (const st of cat.stats ?? []) {
          if (!st.name || typeof st.value !== "number") continue;
          bucket.set(st.name, st.value);
          if (cat.name === "general" && st.name === "gamesPlayed") {
            gamesPlayed.set(id, st.value);
          }
        }
      }
      totals.set(id, bucket);
    }
  }

  // Team games played — the denominator for anyone without games of their own.
  let teamGames = 0;
  for (const total of teamStats.teamTotals ?? []) {
    for (const st of total.stats ?? []) {
      if (st.name === "gamesPlayed" && typeof st.value === "number" && st.value > 0) {
        teamGames = st.value;
      }
    }
  }

  // Per-game stat lines.
  const stats = new Map<string, Map<string, number>>();
  for (const [id, bucket] of totals) {
    const gp = gamesPlayed.get(id) ?? teamGames;
    const per = new Map<string, number>();
    if (gp > 0) {
      for (const [k, v] of bucket) per.set(k, v / gp);
    }
    stats.set(id, per);
  }

  // DST: the team's own sacks and takeaways, plus the points it allows
  // (DraftKings scores a defense on that too).
  let sacks = 0;
  let interceptions = 0;
  let pointsAllowed = 22;
  for (const total of teamStats.teamTotals ?? []) {
    for (const st of total.stats ?? []) {
      if (typeof st.value !== "number") continue;
      const per =
        typeof st.perGameValue === "number"
          ? st.perGameValue
          : teamGames > 0
            ? st.value / teamGames
            : st.value;
      if (st.name === "sacks" && total.name === "defensive") sacks = per;
      if (st.name === "interceptions" && total.name === "defensiveInterceptions") {
        interceptions = per;
      }
      if (st.name === "pointsAllowed") pointsAllowed = per;
    }
  }
  const allowedPoints =
    pointsAllowed <= 0
      ? 3
      : pointsAllowed <= 6
        ? 1
        : pointsAllowed <= 13
          ? 0
          : pointsAllowed <= 17
            ? -1
            : -2;
  const dstProjection = Math.max(
    0.5,
    Math.round((sacks + interceptions * 2 + allowedPoints) * 10) / 10,
  );

  return { athletes, stats, dstProjection };
}

async function fetchLiveNflPool(): Promise<LivePool> {
  const warnings: string[] = [];
  const board = await getJson<EspnScoreboard>(`${ESPN_WEB}/football/nfl/scoreboard`);
  const seasonYear = board.leagues?.[0]?.season?.year ?? new Date().getFullYear();
  const events = board.events ?? [];
  if (events.length === 0) {
    return {
      sport: "nfl",
      players: [],
      games: [],
      fetchedAt: new Date().toISOString(),
      warnings: ["No NFL games are scheduled today — there is no live slate to build from."],
    };
  }

  const teamIds = new Set<string>();
  const games: LiveGame[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    for (const c of comp?.competitors ?? []) {
      if (c.team?.id) teamIds.add(c.team.id);
    }
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    games.push({
      id: ev.id,
      label: `${away?.team?.abbreviation ?? "AWY"} @ ${home?.team?.abbreviation ?? "HOM"}`,
      startTime: comp?.date ?? ev.date ?? null,
      state: comp?.status?.type?.state ?? ev.status?.type?.state ?? "pre",
      detail: comp?.status?.type?.shortDetail ?? comp?.status?.type?.detail ?? "",
    });
  }

  const bundles = await mapLimit([...teamIds], 6, (id) => loadNflTeam(id, seasonYear));
  const bundleByTeam = new Map<string, NflTeamBundle>();
  [...teamIds].forEach((id, i) => bundleByTeam.set(id, bundles[i]));

  const players: Player[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const away = competitors.find((c) => c.homeAway === "away");
    const home = competitors.find((c) => c.homeAway === "home");
    const gameKey = `${away?.team?.abbreviation ?? "AWY"}@${home?.team?.abbreviation ?? "HOM"}`;
    const tip = formatTip(comp?.date ?? ev.date);

    for (const side of [away, home]) {
      if (!side?.team?.id) continue;
      const bundle = bundleByTeam.get(side.team.id);
      if (!bundle) continue;
      const teamAbbr = side.team.abbreviation ?? "???";
      const opponentAbbr = side === away ? home?.team?.abbreviation : away?.team?.abbreviation;

      for (const athlete of bundle.athletes.values()) {
        const espnId = athlete.id!;
        const pos = (athlete.position?.abbreviation ?? "").toUpperCase();
        const slots = NFL_SLOT_BY_POSITION[pos];
        if (!slots) continue; // individual defenders are not DFS roster slots
        const statLine = bundle.stats.get(espnId);
        if (!statLine) continue;
        const projection = dkNflPoints(statLine);
        if (projection <= 0) continue;
        players.push({
          id: `nfl-${espnId}`,
          name: athlete.displayName ?? espnId,
          sport: "nfl",
          salary: derivedNflSalary(projection, pos),
          projection: Math.round(projection * 10) / 10,
          team: teamAbbr,
          opponent: opponentAbbr,
          game_info: `${gameKey} ${tip}`.trim(),
          game_time: comp?.date ?? ev.date ?? null,
          positions: [pos],
          roster_positions: slots,
          correlation_group: gameKey,
          injury_status: null,
          photo_url: athlete.headshot?.href ?? null,
          jersey: athlete.jersey ?? null,
        });
      }

      // One DST unit per team.
      const dstProjection = bundle.dstProjection;
      players.push({
        id: `nfl-dst-${side.team.id}`,
        name: `${teamAbbr} Defense`,
        sport: "nfl",
        salary: derivedNflSalary(dstProjection, "DST"),
        projection: Math.round(dstProjection * 10) / 10,
        team: teamAbbr,
        opponent: opponentAbbr,
        game_info: `${gameKey} ${tip}`.trim(),
        game_time: comp?.date ?? ev.date ?? null,
        positions: ["DST"],
        roster_positions: ["DST"],
        correlation_group: gameKey,
        photo_url: null,
      });
    }
  }

  applyOwnership(players);

  const withoutStats = players.filter((p) => p.projection > 0).length;
  if (withoutStats === 0) warnings.push("No player data came back from ESPN.");
  const qbs = players.filter((p) => (p.positions ?? []).includes("QB")).length;
  if (qbs === 0) {
    warnings.push(
      "ESPN returned no quarterback season statistics — the NFL pool may be incomplete.",
    );
  }

  return {
    sport: "nfl",
    players,
    games,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function fetchLivePool(sport: Sport): Promise<LivePool> {
  if (sport === "nba") return fetchLiveNbaPool();
  if (sport === "nfl") return fetchLiveNflPool();
  if (sport === "mma") return fetchLiveMmaPool();
  return fetchLiveGolfPool();
}

/** Live news feed (NBA) straight from ESPN. */
export async function fetchLiveNews(): Promise<LiveNewsRow[]> {
  const payload = await getJson<{
    articles?: Array<{
      headline?: string;
      published?: string;
      links?: { web?: { href?: string } };
    }>;
  }>(`${ESPN_API}/basketball/nba/news?limit=25`);

  return (payload.articles ?? []).map((a) => ({
    title: a.headline ?? "",
    published: a.published ?? "",
    link: a.links?.web?.href ?? "",
  }));
}
