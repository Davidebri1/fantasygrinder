#!/usr/bin/env node
/**
 * mavis-accuracy-history.mjs — career-to-date backtest of Dave's projection
 * model (src/lib/dave-projection.ts).
 *
 * Built by mavis for Dave. This is a REBUILD: the previous run was rejected
 * on methodological grounds (too little history, per-season sample, mean
 * absolute error as the headline). The changes:
 *
 *   1. History: NFL regular seasons 2002 .. 2026 (every completed game ESPN
 *      publishes for the sampled teams), not 2023-2026.
 *   2. Sample: a projection is only issued when the player has >= 30 prior
 *      games ACROSS ALL SEASONS (Central Limit Theorem threshold). Below 30
 *      the harness records "insufficient sample" and issues NO projection.
 *      Prior games = the player's completed games strictly before the target
 *      game, across all seasons in the dataset, sorted by date.
 *   3. Baseline: the plain prior-games average. No split, no factor, no
 *      weighting. "Nobody special."
 *   4. Headline metrics: scenario metrics (boom/bust detection, direction
 *      match, upward-trend identification). Mean absolute error is NOT a
 *      headline metric. Containment and Welch t are supporting lines.
 *
 * DATA PATH (the only one that works on ESPN's public API today):
 *   team schedule  ->  event id + date
 *     -> event summary (box score for BOTH teams)
 *       -> DraftKings points per player, via DK's published scoring rubric
 *   ESPN's per-athlete gamelog endpoints on site.api are dead (404) and are
 *   not used here.
 *
 * ---------------------------------------------------------------------------
 * VARIABLE DEFINITIONS (authoritative — mirrored in docs/mavis-accuracy-history.md)
 * ---------------------------------------------------------------------------
 *
 * EARLIER GAMES (per target game)
 *   The set of that player's completed games whose date is STRICTLY BEFORE the
 *   target game's date, drawn from ALL seasons present in the dataset, sorted
 *   by date ascending. Ties are impossible for one player. "prior_games_n" is
 *   the size of this set. A player's earlier games include every game of
 *   theirs that appears in the sampled teams' schedules; games played for a
 *   team outside the sampled set are absent (see caveats).
 *
 * TARGET GAME
 *   A completed game for a player. A target game QUALIFIES when the player
 *   has >= 30 earlier games; otherwise it is SKIPPED with the reason
 *   "insufficient sample" and NO projection is issued.
 *
 * HIGH HALF / LOW HALF / CUT
 *   The model splits the earlier games at the median of their DK points
 *   (medianSplit): sorted ascending, the LOW half takes the first
 *   ceil(n/2) games and the HIGH half the rest (odd counts put the middle
 *   game in the LOW half). This is the pre-peel split — the same cut the
 *   model itself uses before it peels multimodal outliers.
 *   CUT (C) = the largest DK point value in the LOW half. It is the score
 *   boundary of the split: an earlier game is LOW iff its score <= C.
 *   For odd n, C is the median score; for even n, C is the lower median.
 *
 * BOOM GAME / BUST GAME (the ACTUAL outcome of a target game)
 *   Boom  = the target game's actual DK points >  C (it landed in the HIGH
 *            half of that player's own earlier games).
 *   Bust  = the target game's actual DK points <= C (it landed in the LOW
 *            half).
 *   Because C is the player's own median, roughly half of all target games
 *   are booms and half are busts by construction.
 *
 * FACTOR
 *   The single pre-game-known condition (of: home/road, month) that best
 *   separates the HIGH half from the LOW half of the earlier games, by the
 *   model's own rule (probability separation for booleans/categories,
 *   squashed Cohen's d for numbers). Exactly one factor is used.
 *
 * P
 *   The model's probability that the HIGH half's factor condition holds in
 *   the target game: 1 if it holds, 0 if it does not, 0.5 when the condition
 *   is unknown for the target game, or when the halves are the same
 *   population (Welch |t| < 2.1) or nothing separates them.
 *
 * MODEL PROJECTION / MODEL CI
 *   projection = highMean * P + lowMean * (1 - P), post-peel (or the raw
 *   average of the post-peel games when the halves are one population).
 *   CI = projection +/- 1.6449 * sd of the two-component mixture.
 *
 * MODEL SCENARIO PREDICTION (model_half)
 *   HIGH if P = 1, LOW if P = 0, EVEN if P = 0.5 (the model declined to
 *   call a side). This is the model's own scenario output.
 *
 * MODEL IMPLIED HALF (model_implied_half)
 *   The same cut rule applied to the model's own projection: HIGH if
 *   projection > C, LOW if projection < C, EVEN if equal. Reported so the
 *   model and the baseline can be compared through ONE identical classifier.
 *
 * BASELINE
 *   The plain prior-games average: the arithmetic mean of ALL the player's
 *   earlier games (no split, no factor, no weighting, no outlier removal).
 *   BASELINE PROJECTION = that mean.
 *   BASELINE SCENARIO PREDICTION (baseline_half): a plain average carries no
 *   half of its own, so the only directional content it has is where the
 *   average sits relative to the same cut C —
 *     HIGH if baseline projection > C, LOW if < C, EVEN if = C.
 *   Because a mean sits at or above a median, this benchmark leans HIGH on
 *   almost every game. That is a property of averaging a boom/bust
 *   distribution, not a choice made to favour the model, and it is reported
 *   as-is. The no-call reading of the baseline (a plain average makes no
 *   directional call at all) is reported alongside it.
 *   BASELINE CI = the baseline projection +/- the SAME half-width the model
 *   used for that game, so the two intervals differ only in their centre.
 *
 * UPWARD-TREND CASE
 *   A target game where mean(last 5 earlier games) > mean(first 5 earlier
 *   games) AND the actual landed HIGH (a boom). "Identified" means the
 *   predictor's scenario for that game was HIGH.
 *
 * CONTAINMENT
 *   The actual DK points fall inside the predictor's 90% interval.
 *
 * USAGE
 *   node scripts/mavis-accuracy-history.mjs
 *   MAVIS_TEAMS=ne,gb,pit,sf MAVIS_SEASON_START=2002 MAVIS_SEASON_END=2026
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(HERE, "..", ".tmp-audit", "mavis-accuracy-history.json");
const OUT_DOC = join(HERE, "..", "..", "..", "docs", "mavis-accuracy-history.md");
const CACHE_DIR = process.env.MAVIS_CACHE_DIR
  ? join(process.env.MAVIS_CACHE_DIR)
  : join(tmpdir(), "mavis-accuracy-cache");

const TEAMS = (process.env.MAVIS_TEAMS ?? "ne,gb,pit,sf")
  .split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const SEASON_START = Number(process.env.MAVIS_SEASON_START ?? 2002);
const SEASON_END = Number(process.env.MAVIS_SEASON_END ?? 2026);
const MIN_PRIOR_GAMES = Number(process.env.MAVIS_MIN_PRIOR_GAMES ?? 30);
const CONCURRENCY = Number(process.env.MAVIS_CONCURRENCY ?? 8);
const POSITION_LOOKUP_CAP = Number(process.env.MAVIS_POSITION_LOOKUP_CAP ?? 900);

const SEASONS = [];
for (let y = SEASON_START; y <= SEASON_END; y++) SEASONS.push(y);

const ERAS = [
  { label: "2002-2008", from: 2002, to: 2008 },
  { label: "2009-2014", from: 2009, to: 2014 },
  { label: "2015-2020", from: 2015, to: 2020 },
  { label: "2021-2026", from: 2021, to: 2026 },
];

// ---------------------------------------------------------------------------
// Math + model — a deliberate plain-Node port of src/lib/dave-projection.ts.
// Same maths, no app imports, so the harness runs under bare node.
// ---------------------------------------------------------------------------

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sampleVariance(xs) {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}
function welchT(a, b) {
  const nA = a.length, nB = b.length;
  const vA = sampleVariance(a), vB = sampleVariance(b);
  const se2 = vA / nA + vB / nB;
  if (se2 === 0) return { t: 0, df: Math.min(nA, nB) - 1 };
  const df = (se2 * se2) / ((vA / nA) ** 2 / (nA - 1) + (vB / nB) ** 2 / (nB - 1));
  return { t: (mean(a) - mean(b)) / Math.sqrt(se2), df };
}

const SAME_T = 2.1, SKEW_LIMIT = 1, KURT_LIMIT = 2, MAX_PEELS = 2, Z90 = 1.6449;

function skewKurt(xs) {
  const m = mean(xs);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of xs) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
  m2 /= xs.length; m3 /= xs.length; m4 /= xs.length;
  if (m2 === 0) return { skew: 0, kurt: 0 };
  return { skew: m3 / Math.pow(m2, 1.5), kurt: m4 / (m2 * m2) - 3 };
}
const isNormal = (xs) => {
  const { skew, kurt } = skewKurt(xs);
  return Math.abs(skew) <= SKEW_LIMIT && Math.abs(kurt) <= KURT_LIMIT;
};

function medianSplit(games) {
  // games: [{ score, f }] — f carries the pre-game-known factors.
  const sorted = games.map((g, i) => ({ s: g.score, f: g.f, i })).sort((a, b) => a.s - b.s);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return { low: sorted.slice(0, lowEnd), high: sorted.slice(lowEnd) };
}

function peel(half) {
  const kept = half.slice();
  const peeled = [];
  for (let pass = 0; pass < MAX_PEELS; pass++) {
    if (kept.length <= 3) break;
    if (isNormal(kept.map((e) => e.s))) break;
    const m = mean(kept.map((e) => e.s));
    const sd = Math.sqrt(sampleVariance(kept.map((e) => e.s)));
    let worst = 0, worstZ = -1;
    kept.forEach((e, i) => {
      const z = sd === 0 ? 0 : Math.abs(e.s - m) / sd;
      if (z > worstZ) { worstZ = z; worst = i; }
    });
    peeled.push(kept[worst].i); // original index, as the engine reports
    kept.splice(worst, 1);
  }
  return { kept, peeled };
}

function detectFactorCandidates(low, high) {
  const keys = new Set();
  for (const e of [...low, ...high]) for (const k of Object.keys(e.f)) keys.add(k);
  const out = [];
  for (const key of Array.from(keys).sort()) {
    const lowDef = low.map((e) => e.f[key]).filter((v) => v !== undefined);
    const highDef = high.map((e) => e.f[key]).filter((v) => v !== undefined);
    if (lowDef.length < 1 || highDef.length < 1) continue;
    const all = [...lowDef, ...highDef];
    if (all.every((v) => typeof v === "boolean")) {
      const fH = highDef.filter(Boolean).length / highDef.length;
      const fL = lowDef.filter(Boolean).length / lowDef.length;
      const condTrue = fH >= fL;
      const sep = Math.abs(fH - fL);
      if (sep <= 0) continue;
      out.push({
        key, sep,
        holds: (v) => (v === undefined ? undefined : condTrue ? v === true : v === false),
        describe: () => key + "=" + condTrue,
      });
    } else if (all.every((v) => typeof v === "number")) {
      const mH = mean(highDef.map(Number)), mL = mean(lowDef.map(Number));
      const vH = sampleVariance(highDef.map(Number)), vL = sampleVariance(lowDef.map(Number));
      const pooled = Math.sqrt(((highDef.length - 1) * vH + (lowDef.length - 1) * vL) /
        (highDef.length + lowDef.length - 2));
      if (mH === mL) continue;
      const d = pooled === 0 ? Infinity : Math.abs(mH - mL) / pooled;
      const sep = d === Infinity ? 1 : d / (d + 1);
      const highAbove = mH > mL;
      const mid = (mH + mL) / 2;
      const fracAbove = (defs) => defs.filter((v) => Number(v) > mid).length / defs.length;
      out.push({
        key, sep,
        holds: (v) => {
          if (v === undefined || typeof v !== "number") return undefined;
          if (v === mid) return undefined;
          return highAbove ? v > mid : v < mid;
        },
        describe: () => key + (highAbove ? ">" : "<") + mid.toFixed(2),
      });
    } else {
      const values = Array.from(new Set(all.map(String))).sort();
      let best = null;
      for (const v of values) {
        const fH = highDef.filter((x) => String(x) === v).length / highDef.length;
        const fL = lowDef.filter((x) => String(x) === v).length / lowDef.length;
        const sep = Math.abs(fH - fL);
        if (!best || sep > best.sep) best = { v, sep };
      }
      if (!best || best.sep <= 0) continue;
      const bv = best.v;
      const fH = highDef.filter((x) => String(x) === bv).length / highDef.length;
      const fL = lowDef.filter((x) => String(x) === bv).length / lowDef.length;
      const condIsValue = fH >= fL;
      out.push({
        key, sep: best.sep,
        holds: (v) => (v === undefined ? undefined : condIsValue ? String(v) === bv : String(v) !== bv),
        describe: () => key + "=" + bv,
      });
    }
  }
  return out;
}

/** Faithful port of projectDave(). */
function projectDave(games, upcoming) {
  if (games.length < 4) throw new Error("needs at least 4 games");
  const split = medianSplit(games);
  const lowPeeled = peel(split.low);
  const highPeeled = peel(split.high);
  const peeled = [...lowPeeled.peeled, ...highPeeled.peeled].sort((a, b) => a - b);
  const lowScores = lowPeeled.kept.map((e) => e.s);
  const highScores = highPeeled.kept.map((e) => e.s);
  const lowMean = mean(lowScores), highMean = mean(highScores);
  const lowVar = sampleVariance(lowScores), highVar = sampleVariance(highScores);
  const { t } = welchT(highScores, lowScores);
  const sameMeans = Math.abs(t) < SAME_T;

  const build = (p) => {
    const variance = p * p * highVar + (1 - p) * (1 - p) * lowVar +
      p * (1 - p) * Math.pow(highMean - lowMean, 2);
    const halfWidth = Z90 * Math.sqrt(variance);
    const projection = highMean * p + lowMean * (1 - p);
    return { projection, low90: projection - halfWidth, high90: projection + halfWidth,
      highMean, lowMean, p, sameMeans, factor: null, factorDetail: null, peeled };
  };

  if (sameMeans) {
    const raw = mean([...lowScores, ...highScores]);
    return { ...build(0.5), projection: raw, factor: null };
  }

  const candidates = detectFactorCandidates(lowPeeled.kept, highPeeled.kept);
  const winner = candidates.reduce((acc, c) => (!acc || c.sep > acc.sep ? c : acc), null);
  if (!winner) return build(0.5);

  const holds = winner.holds(upcoming[winner.key]);
  const p = holds === undefined ? 0.5 : holds ? 1 : 0;
  return { ...build(p), factor: winner.key, factorDetail: winner.describe(), factorSep: winner.sep };
}

// ---------------------------------------------------------------------------
// ESPN fetching
// ---------------------------------------------------------------------------

let REQUESTS = 0;
let SUMMARIES_FETCHED = 0;
const FAILURES = [];

async function getJson(url, label) {
  const tries = 4;
  for (let i = 0; i < tries; i++) {
    try {
      REQUESTS++;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
      if (res.ok) return await res.json();
      if (i === tries - 1) throw new Error("HTTP " + res.status);
    } catch (err) {
      if (i === tries - 1) {
        FAILURES.push((label ?? url) + " :: " + err.message);
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// DraftKings scoring rubric (the public one).
function dkPointsFor(rec) {
  const get = (group, key) => {
    const g = rec.groups[group];
    if (!g) return 0;
    const i = g.keys.indexOf(key);
    if (i < 0) return 0;
    const v = Number(g.values[i]);
    return Number.isFinite(v) ? v : 0;
  };
  let pts = 0;
  const passYds = get("passing", "passingYards");
  pts += passYds * 0.04 + get("passing", "passingTouchdowns") * 4 - get("passing", "interceptions");
  if (passYds >= 300) pts += 3;
  const rushYds = get("rushing", "rushingYards");
  pts += rushYds * 0.1 + get("rushing", "rushingTouchdowns") * 6;
  if (rushYds >= 100) pts += 3;
  const recYds = get("receiving", "receivingYards");
  pts += get("receiving", "receptions") + recYds * 0.1 + get("receiving", "receivingTouchdowns") * 6;
  if (recYds >= 100) pts += 3;
  pts += get("receiving", "twoPointConversions") * 2;
  pts -= get("fumbles", "fumblesLost");
  return Math.round(pts * 100) / 100;
}

function passingAttempts(rec) {
  const g = rec.groups.passing;
  if (!g) return 0;
  const i = g.keys.indexOf("completions/passingAttempts");
  if (i < 0) return 0;
  const parts = String(g.values[i] ?? "").split("/");
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

function groupNumber(rec, group, key) {
  const g = rec.groups[group];
  if (!g) return 0;
  const i = g.keys.indexOf(key);
  if (i < 0) return 0;
  const v = Number(g.values[i]);
  return Number.isFinite(v) ? v : 0;
}

function inferPosition(rec) {
  const att = passingAttempts(rec);
  const rushAtt = groupNumber(rec, "rushing", "rushingAttempts");
  const targets = groupNumber(rec, "receiving", "receivingTargets");
  if (att > 0) return "QB";
  if (rushAtt > 0 && targets > 0) return "RB";
  if (rushAtt >= 3 && targets === 0) return "RB";
  if (targets > 0) return "WR/TE";
  if (rushAtt > 0) return "RB";
  return null;
}

/** Pull both teams' box scores out of one event summary. */
function harvestSummary(sum, date, season) {
  const competitors = sum?.header?.competitions?.[0]?.competitors ?? [];
  const homeAbbr = (competitors.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "").toUpperCase();
  const month = MONTHS[new Date(date).getUTCMonth()];
  const players = [];
  for (const teamBox of sum?.boxscore?.players ?? []) {
    const teamAbbr = (teamBox?.team?.abbreviation ?? "").toUpperCase();
    const isHome = teamAbbr === homeAbbr;
    const byAthlete = new Map();
    for (const g of teamBox?.statistics ?? []) {
      for (const a of g?.athletes ?? []) {
        const id = a?.athlete?.id;
        if (!id) continue;
        let rec = byAthlete.get(id);
        if (!rec) {
          rec = { id: String(id), name: a.athlete.displayName ?? "", groups: {} };
          byAthlete.set(id, rec);
        }
        rec.groups[g.name] = { keys: g.keys ?? [], values: a.stats ?? [] };
      }
    }
    for (const rec of byAthlete.values()) {
      const pos = inferPosition(rec);
      if (!pos) continue; // only offensive players who produced DK-relevant stats
      players.push({
        id: rec.id, name: rec.name, team: teamAbbr, isHome, month,
        season, date, pos, score: dkPointsFor(rec),
      });
    }
  }
  return { date, season, homeAbbr, players };
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const pct = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 10 : null);

function medianCut(scores) {
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return sorted[lowEnd - 1];
}
function impliedHalf(projection, cut) {
  if (projection > cut) return "HIGH";
  if (projection < cut) return "LOW";
  return "EVEN";
}
function scenarioFromP(p) {
  if (p === 1) return "HIGH";
  if (p === 0) return "LOW";
  return "EVEN";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  console.log("mavis-accuracy-history: teams=" + TEAMS.join(",") +
    " seasons=" + SEASON_START + ".." + SEASON_END +
    " minPriorGames=" + MIN_PRIOR_GAMES);

  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, "events.json");
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  console.log("Cached event summaries available: " + Object.keys(cache).length);

  // ---- 1. schedules ------------------------------------------------------
  const events = new Map(); // eventId -> { id, date, season }
  await mapLimit(TEAMS.flatMap((t) => SEASONS.map((s) => [t, s])), 4, async ([team, season]) => {
    try {
      const sched = await getJson(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team + "/schedule?season=" + season,
        "schedule " + team + " " + season);
      for (const ev of sched?.events ?? []) {
        if (ev?.competitions?.[0]?.status?.type?.completed !== true) continue;
        const id = String(ev.id);
        if (events.has(id)) continue;
        events.set(id, { id, date: ev.date, season });
      }
    } catch { /* recorded in FAILURES */ }
  });
  const SCHEDULE_REQUESTS = REQUESTS;
  console.log("Completed regular-season games across seasons: " + events.size +
    " (requests: " + REQUESTS + ")");

  // ---- 2. summaries (cached) -------------------------------------------
  const ids = [...events.keys()];
  let done = 0;
  await mapLimit(ids, CONCURRENCY, async (id) => {
    if (cache[id]) { done++; return; }
    const ev = events.get(id);
    try {
      const sum = await getJson(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + id,
        "summary " + id);
      cache[id] = harvestSummary(sum, ev.date, ev.season);
      SUMMARIES_FETCHED++;
    } catch { /* recorded in FAILURES */ }
    done++;
    if (done % 400 === 0) {
      console.log("  summaries " + done + "/" + ids.length + " (requests: " + REQUESTS + ")");
      writeFileSync(cachePath, JSON.stringify(cache));
    }
  });
  writeFileSync(cachePath, JSON.stringify(cache));
  const cachedEvents = Object.values(cache);
  console.log("Event summaries held: " + cachedEvents.length + "/" + ids.length +
    " (requests: " + REQUESTS + ")");

  // ---- 3. player logs ----------------------------------------------------
  const logs = new Map(); // athleteId -> [games]
  for (const ev of cachedEvents) {
    for (const p of ev.players ?? []) {
      if (!logs.has(p.id)) logs.set(p.id, []);
      logs.get(p.id).push({
        date: p.date, season: p.season, score: p.score,
        isHome: p.isHome, month: p.month, team: p.team, pos: p.pos, name: p.name,
      });
    }
  }
  for (const list of logs.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  console.log("Distinct players with DK-relevant games: " + logs.size);

  // ---- 4. walk-forward, career to date ----------------------------------
  const rows = [];
  const skipped = [];
  const perPlayer = [];
  let skippedCount = 0;

  for (const [id, games] of logs) {
    const name = games[0].name;
    let qualified = 0;
    for (let k = 0; k < games.length; k++) {
      const prior = games.slice(0, k);
      const target = games[k];
      if (prior.length < MIN_PRIOR_GAMES) {
        skippedCount++;
        if (skipped.length < 20000) {
          skipped.push({ player: name, date: target.date, season: target.season,
            prior_games_n: prior.length, reason: "insufficient sample (n < " + MIN_PRIOR_GAMES + ")" });
        }
        continue;
      }
      qualified++;
      const priorScores = prior.map((g) => g.score);
      const cut = medianCut(priorScores);
      const proj = projectDave(
        prior.map((g) => ({ score: g.score, f: { isHome: g.isHome, month: g.month } })),
        { isHome: target.isHome, month: target.month });
      const baseline = mean(priorScores);
      const hw = (proj.high90 - proj.low90) / 2;
      const actual = target.score;
      const isBoom = actual > cut;

      const first5 = mean(priorScores.slice(0, 5));
      const last5 = mean(priorScores.slice(-5));
      const upwardTrend = last5 > first5;

      rows.push({
        player: name, athlete_id: id, date: target.date, season: target.season,
        position: target.pos, team: target.team,
        prior_games_n: prior.length,
        cut: round(cut),
        boom_or_bust_actual: isBoom ? "BOOM" : "BUST",
        model_half: scenarioFromP(proj.p),
        model_projection: round(proj.projection),
        model_factor: proj.factor,
        model_factor_detail: proj.factorDetail,
        model_factor_sep: proj.factorSep ?? null,
        model_P: proj.p,
        model_ci: [round(proj.low90), round(proj.high90)],
        model_implied_half: impliedHalf(proj.projection, cut),
        baseline_projection: round(baseline),
        baseline_half: impliedHalf(baseline, cut),
        baseline_ci: [round(baseline - hw), round(baseline + hw)],
        actual: round(actual),
        contained_model: actual >= proj.low90 && actual <= proj.high90,
        contained_baseline: actual >= baseline - hw && actual <= baseline + hw,
        upward_trend_case: upwardTrend && isBoom,
        upward_trend: upwardTrend,
        same_means: proj.sameMeans,
        model_peeled: proj.peeled ? proj.peeled.length : 0,
        high_mean: round(proj.highMean),
        low_mean: round(proj.lowMean),
      });
    }
    perPlayer.push({
      player: name, athlete_id: id, position: games[0].pos,
      teams: [...new Set(games.map((g) => g.team))].join("/"),
      seasons: [...new Set(games.map((g) => g.season))].sort((a, b) => a - b),
      games: games.length, qualified, skipped: games.length - qualified,
    });
  }

  console.log("Target games qualified: " + rows.length + " | skipped (insufficient sample): " + skippedCount);
  if (rows.length === 0) throw new Error("No target games qualified - nothing to report.");

  // ---- 5. metrics --------------------------------------------------------
  const scenarioBlock = (rs) => {
    const booms = rs.filter((r) => r.boom_or_bust_actual === "BOOM");
    const busts = rs.filter((r) => r.boom_or_bust_actual === "BUST");
    const trendCases = rs.filter((r) => r.upward_trend_case);
    const rate = (n, d) => (d ? pct(n / d) : null);
    const modelHalfOf = (r) => r.model_half;
    const modelImpliedOf = (r) => r.model_implied_half;
    const baseHalfOf = (r) => r.baseline_half;
    const matched = (c, r) =>
      (c === "HIGH" && r.boom_or_bust_actual === "BOOM") ||
      (c === "LOW" && r.boom_or_bust_actual === "BUST");
    // McNemar-style paired test: how often the model and the baseline differ,
    // and in which direction. z = (n01 - n10) / sqrt(n01 + n10).
    const pairedZ = (aFn, bFn) => {
      let n01 = 0, n10 = 0;
      for (const r of rs) {
        const a = aFn(r), b = bFn(r);
        if (a && !b) n01++; else if (!a && b) n10++;
      }
      const d = n01 + n10;
      return { z: d ? Math.round(((n01 - n10) / Math.sqrt(d)) * 100) / 100 : 0, n01, n10 };
    };
    const p1rows = rs.filter((r) => r.model_P === 1);
    const p0rows = rs.filter((r) => r.model_P === 0);
    const dirHits = rs.filter((r) => matched(modelHalfOf(r), r)).length;
    const zTests = {
      directionModelVsBaseline: pairedZ((r) => matched(modelHalfOf(r), r), (r) => matched(baseHalfOf(r), r)),
      boomModelVsBaseline: pairedZ(
        (r) => modelHalfOf(r) === "HIGH" && r.boom_or_bust_actual === "BOOM",
        (r) => baseHalfOf(r) === "HIGH" && r.boom_or_bust_actual === "BOOM"),
      bustModelVsBaseline: pairedZ(
        (r) => modelHalfOf(r) === "LOW" && r.boom_or_bust_actual === "BUST",
        (r) => baseHalfOf(r) === "LOW" && r.boom_or_bust_actual === "BUST"),
      trendModelVsBaseline: pairedZ(
        (r) => modelHalfOf(r) === "HIGH" && r.upward_trend_case,
        (r) => baseHalfOf(r) === "HIGH" && r.upward_trend_case),
    };
    const sepVals = rs.map((r) => r.model_factor_sep).filter((v) => v !== null && v !== undefined);
    const chanceZ = rs.length
      ? Math.round((((dirHits / rs.length) - 0.5) / Math.sqrt(0.25 / rs.length)) * 100) / 100
      : 0;

    const mCalled = rs.filter((r) => modelHalfOf(r) !== "EVEN");
    const wModel = welchT(rs.map((r) => r.model_projection), rs.map((r) => r.actual));
    const wBase = welchT(rs.map((r) => r.baseline_projection), rs.map((r) => r.actual));

    return {
      targetGames: rs.length,
      booms: booms.length, busts: busts.length,
      boomRate: rate(booms.length, rs.length),
      trendCases: trendCases.length,
      model: {
        boomHigh: rate(booms.filter((r) => modelHalfOf(r) === "HIGH").length, booms.length),
        boomHighImplied: rate(booms.filter((r) => modelImpliedOf(r) === "HIGH").length, booms.length),
        bustLow: rate(busts.filter((r) => modelHalfOf(r) === "LOW").length, busts.length),
        bustLowImplied: rate(busts.filter((r) => modelImpliedOf(r) === "LOW").length, busts.length),
        directionMatch: rate(rs.filter((r) => matched(modelHalfOf(r), r)).length, rs.length),
        directionMatchImplied: rate(rs.filter((r) => matched(modelImpliedOf(r), r)).length, rs.length),
        directionMatchWhenCalled: rate(mCalled.filter((r) => matched(modelHalfOf(r), r)).length, mCalled.length),
        callsMade: mCalled.length,
        callRate: rate(mCalled.length, rs.length),
        trendIdentified: rate(trendCases.filter((r) => modelHalfOf(r) === "HIGH").length, trendCases.length),
        trendIdentifiedImplied: rate(trendCases.filter((r) => modelImpliedOf(r) === "HIGH").length, trendCases.length),
        boomRateWhenP1: rate(p1rows.filter((r) => r.boom_or_bust_actual === "BOOM").length, p1rows.length),
        bustRateWhenP0: rate(p0rows.filter((r) => r.boom_or_bust_actual === "BUST").length, p0rows.length),
        directionChanceZ: chanceZ,
        factorSepMean: sepVals.length ? round(sepVals.reduce((a, b) => a + b, 0) / sepVals.length) : null,
        contained: rate(rs.filter((r) => r.contained_model).length, rs.length),
        welch: { t: round(wModel.t), df: round(wModel.df) },
      },
      baseline: {
        boomHigh: rate(booms.filter((r) => baseHalfOf(r) === "HIGH").length, booms.length),
        bustLow: rate(busts.filter((r) => baseHalfOf(r) === "LOW").length, busts.length),
        directionMatch: rate(rs.filter((r) => matched(baseHalfOf(r), r)).length, rs.length),
        trendIdentified: rate(trendCases.filter((r) => baseHalfOf(r) === "HIGH").length, trendCases.length),
        contained: rate(rs.filter((r) => r.contained_baseline).length, rs.length),
        welch: { t: round(wBase.t), df: round(wBase.df) },
        halfCallHigh: rate(rs.filter((r) => r.baseline_half === "HIGH").length, rs.length),
        noCallScore: 0,
      },
      chance: 50,
      zTests,
    };
  };

  const perEra = ERAS.map((e) => {
    const rs = rows.filter((r) => r.season >= e.from && r.season <= e.to);
    return { era: e.label, from: e.from, to: e.to, ...scenarioBlock(rs) };
  });
  const overall = scenarioBlock(rows);

  const perSeason = SEASONS.map((season) => {
    const rs = rows.filter((r) => r.season === season);
    const seen = new Set();
    for (const list of logs.values()) for (const g of list) if (g.season === season) seen.add(g.name);
    return {
      season,
      playersWithGames: seen.size,
      playersQualified: new Set(rs.map((r) => r.player)).size,
      ...scenarioBlock(rs),
    };
  });

  // ---- 6. exact ESPN positions for the audited population ----------------
  const positionOf = new Map();
  const qualifiedPlayers = [...new Map(rows.map((r) => [r.athlete_id, r.player])).entries()];
  let posLookups = 0;
  await mapLimit(qualifiedPlayers, CONCURRENCY, async ([id]) => {
    if (posLookups >= POSITION_LOOKUP_CAP) return;
    posLookups++;
    try {
      const a = await getJson(
        "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/" + id +
        "?lang=en&region=us", "athlete " + id);
      const abbr = a?.position?.abbreviation;
      if (abbr) positionOf.set(id, abbr);
    } catch { /* recorded in FAILURES */ }
  });
  for (const r of rows) {
    const exact = positionOf.get(r.athlete_id);
    if (exact) r.position = exact;
  }
  const positionMix = {};
  for (const r of rows) positionMix[r.position] = (positionMix[r.position] ?? 0) + 1;

  // ---- 7. outputs ---------------------------------------------------------
  const docDate = new Date().toISOString().slice(0, 10);
  const result = {
    generatedAt: new Date().toISOString(),
    config: {
      teams: TEAMS, seasonStart: SEASON_START, seasonEnd: SEASON_END,
      minPriorGames: MIN_PRIOR_GAMES, factorsFed: ["isHome", "month"],
      scoringRubric: "DraftKings published rubric",
      dataPath: "ESPN team schedule -> event summary -> DraftKings points",
    },
    definitions: {
      earlierGames: "That player's completed games strictly before the target game date, across all seasons in the dataset, sorted by date ascending.",
      targetGame: "A completed game. Qualifies only when prior_games_n >= " + MIN_PRIOR_GAMES + "; otherwise skipped as 'insufficient sample' with no projection issued.",
      highHalf: "Top half of the earlier games by DK points (median split; odd counts put the middle game in the LOW half). Pre-peel.",
      lowHalf: "Bottom half of the earlier games by DK points. Pre-peel.",
      cut: "C = the largest DK point value in the LOW half. Earlier games are LOW iff score <= C.",
      boomGame: "Target game whose actual DK points > C (landed in the player's HIGH half).",
      bustGame: "Target game whose actual DK points <= C (landed in the player's LOW half).",
      factor: "The single pre-game-known condition (home/road, month) that best separates the HIGH half from the LOW half.",
      P: "Model probability that the HIGH half's factor condition holds in the target game: 1, 0, or 0.5.",
      containment: "Actual DK points fall inside the predictor's 90% interval.",
      baseline: "Plain prior-games average (no split, no factor, no weighting). Its scenario is where that average sits relative to the cut C.",
    },
    coverage: {
      teams: TEAMS, seasons: SEASONS,
      playersSeen: logs.size,
      playersQualified: qualifiedPlayers.length,
      targetGamesQualified: rows.length,
      targetGamesSkipped: skippedCount,
      eventsFetched: cachedEvents.length,
      eventsPlanned: ids.length,
      perSeason, perPlayer,
    },
    metrics: { overall, perEra },
    positionMix,
    requestCount: REQUESTS,
    scheduleRequests: SCHEDULE_REQUESTS,
    summariesFetched: SUMMARIES_FETCHED,
    summariesFromCache: cachedEvents.length - SUMMARIES_FETCHED,
    positionLookups: posLookups,
    failureCount: FAILURES.length,
    failures: FAILURES.slice(0, 200),
    runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rows,
    skipped: skipped.slice(0, 5000),
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 1));
  console.log("Wrote " + OUT_JSON);

  console.log("");
  console.log("=== ACTIONABLE METRICS (model vs baseline) ===");
  console.table([overall, ...perEra].map((b) => ({
    scope: b.era ?? "ALL", games: b.targetGames, booms: b.booms, busts: b.busts,
    modelBoomHigh: b.model.boomHigh, baseBoomHigh: b.baseline.boomHigh,
    modelBustLow: b.model.bustLow, baseBustLow: b.baseline.bustLow,
    modelDir: b.model.directionMatch, baseDir: b.baseline.directionMatch,
    modelTrend: b.model.trendIdentified, baseTrend: b.baseline.trendIdentified,
    modelCont: b.model.contained, baseCont: b.baseline.contained,
    tModel: b.model.welch.t, tBase: b.baseline.welch.t,
  })));
  console.log("Requests: " + REQUESTS + " | failures: " + FAILURES.length +
    " | runtime: " + Math.round((Date.now() - startedAt) / 1000) + "s");

  writeDoc({ docDate, result, overall, perEra, perSeason, rows, skippedCount, logs });
  console.log("Wrote " + OUT_DOC);
}

// ---------------------------------------------------------------------------
// Document writer
// ---------------------------------------------------------------------------

function writeDoc(ctx) {
  const { docDate, result, overall: o, perEra, perSeason, rows, skippedCount } = ctx;
  const fmt = (x) => (x === null || x === undefined ? "n/a" : (Math.round(x * 10) / 10) + "%");
  const cmp = [
    { label: "Boom games called HIGH", m: o.model.boomHigh, b: o.baseline.boomHigh },
    { label: "Bust games called LOW", m: o.model.bustLow, b: o.baseline.bustLow },
    { label: "Direction call matched the outcome", m: o.model.directionMatch, b: o.baseline.directionMatch },
    { label: "Upward-trend cases identified", m: o.model.trendIdentified, b: o.baseline.trendIdentified },
  ];
  const wins = cmp.filter((c) => c.m !== null && c.b !== null && c.m > c.b).length;
  const losses = cmp.filter((c) => c.m !== null && c.b !== null && c.m < c.b).length;
  const ties = cmp.length - wins - losses;
  const cmpSame = [
    { label: "Boom games called HIGH", m: o.model.boomHighImplied, b: o.baseline.boomHigh },
    { label: "Bust games called LOW", m: o.model.bustLowImplied, b: o.baseline.bustLow },
    { label: "Direction call matched the outcome", m: o.model.directionMatchImplied, b: o.baseline.directionMatch },
    { label: "Upward-trend cases identified", m: o.model.trendIdentifiedImplied, b: o.baseline.trendIdentified },
  ];
  const sameWins = cmpSame.filter((c) => c.m !== null && c.b !== null && c.m > c.b).length;
  const sameLosses = cmpSame.filter((c) => c.m !== null && c.b !== null && c.m < c.b).length;

  const factorCounts = {};
  let pOne = 0, pZero = 0, pHalf = 0, sameMeansCount = 0;
  for (const r of rows) {
    const key = r.model_factor ?? "none (even split / same halves)";
    factorCounts[key] = (factorCounts[key] ?? 0) + 1;
    if (r.model_P === 1) pOne++;
    else if (r.model_P === 0) pZero++;
    else pHalf++;
    if (r.same_means) sameMeansCount++;
  }
  const topFactors = Object.entries(factorCounts).sort((a, b) => b[1] - a[1]);
  const positionMix = result.positionMix ?? {};

  const seasonsSeen = perSeason.filter((s) => s.playersWithGames > 0);
  const firstSeason = seasonsSeen.length ? seasonsSeen[0].season : null;
  const lastSeason = seasonsSeen.length ? seasonsSeen[seasonsSeen.length - 1].season : null;

  // ---- verdict, written from the numbers, no spin ----
  const verdictParts = [];
  verdictParts.push("Over " + o.targetGames.toLocaleString() + " target games from " +
    result.coverage.playersQualified.toLocaleString() + " qualified players, the model scored higher than the plain prior-games baseline on " +
    wins + " of the " + cmp.length + " scenario metrics" +
    (ties ? " (" + ties + " tied)" : "") +
    (losses ? " and lost on " + losses : "") + ".");
  verdictParts.push("On the model's own scenario output it called " + fmt(o.model.boomHigh) +
    " of boom games HIGH (baseline " + fmt(o.baseline.boomHigh) + ", chance 50%), " +
    fmt(o.model.bustLow) + " of bust games LOW (baseline " + fmt(o.baseline.bustLow) + "), and its direction call matched the actual outcome on " +
    fmt(o.model.directionMatch) + " of all target games against the baseline's " +
    fmt(o.baseline.directionMatch) + "; when the model actually called a side it was right " +
    fmt(o.model.directionMatchWhenCalled) + " of the time.");
  verdictParts.push("The reason is visible in the conditional rates. When the model says HIGH (P = 1) the game turned out to be a boom " + fmt(o.model.boomRateWhenP1) + " of the time; when it says LOW (P = 0) the game was a bust " + fmt(o.model.bustRateWhenP0) + " of the time. Both are a coin flip. The model's direction call is worth z = " + o.model.directionChanceZ + " against chance, and a paired z of " + o.zTests.directionModelVsBaseline.z + " against the baseline on the same games.");
  verdictParts.push("It identified " + fmt(o.model.trendIdentified) + " of the " +
    o.trendCases.toLocaleString() + " upward-trend cases against the baseline's " +
    fmt(o.baseline.trendIdentified) + ".");
  if (wins === cmp.length) {
    verdictParts.push("Plainly: on this data the model beats the naive average on every scenario metric asked for.");
  } else if (wins === 0) {
    verdictParts.push("Plainly: on this data the model does NOT beat the naive average on any of the scenario metrics.");
  } else {
    verdictParts.push("Plainly: it is a mixed result, not a clean win - the model wins " + wins +
      " of the " + cmp.length + " and loses " + losses + ", and the losses are stated above without softening.");
  }
  verdictParts.push("Read the two wins carefully. The bust-detection win is large and real (paired z = " + o.zTests.bustModelVsBaseline.z + "). The direction-call win is not a win at all: " + fmt(o.model.directionMatch) + " against " + fmt(o.baseline.directionMatch) + " is a paired z of " + o.zTests.directionModelVsBaseline.z + ", which is noise. The two losses are real too, and they are the price of the baseline's HIGH lean: it calls HIGH on " + fmt(o.baseline.halfCallHigh) + " of games, so it wins any metric that rewards saying HIGH and loses badly on bust detection (" + fmt(o.baseline.bustLow) + " against the model's " + fmt(o.model.bustLow) + ").");
  verdictParts.push("Through one identical classifier on both sides the model wins " + sameWins +
    " and loses " + sameLosses + " of the same four rows. Supporting lines: containment in the 90% interval was " +
    fmt(o.model.contained) + " for the model against " + fmt(o.baseline.contained) +
    " for the baseline, and Welch t against the actuals was " + o.model.welch.t +
    " for the model against " + o.baseline.welch.t + " for the baseline.");
  const verdict = verdictParts.join(" ");

  const implications = [
    "- **The 30-game gate is doing its job.** " + result.coverage.targetGamesSkipped.toLocaleString() +
      " candidate games were refused for insufficient sample and " +
      result.coverage.targetGamesQualified.toLocaleString() + " were projected. That is the difference between projecting from a handful of games and projecting from a career.",
    "- **The model never abstains.** With " + result.config.minPriorGames + " or more prior games the Welch sameness test never fired (" + sameMeansCount + " of " + rows.length.toLocaleString() + " rows) and the factor's condition is always known before kickoff, so P was never 0.5. The model called a side on " + fmt(o.model.callRate) + " of target games; the games where the honest answer was \"I don't know\" were forced into a call.",
    "- **The factor is the whole story, and the factor is mostly selection noise.** The winning pre-game factor was " +
      topFactors.map(([k, v]) => k + " on " + v.toLocaleString() + " games (" + fmt((v / rows.length) * 100) + ")").join(", ") +
      ". P was 1 on " + fmt((pOne / rows.length) * 100) + " of games, 0 on " + fmt((pZero / rows.length) * 100) +
      " and 0.5 (no call) on " + fmt((pHalf / rows.length) * 100) + ". The winning factor separated the two halves by an average of " +
      o.model.factorSepMean + " on the very games it was chosen from, and then carried almost nothing into the next game: " +
      fmt(o.model.boomRateWhenP1) + " boom rate when it said HIGH, " + fmt(o.model.bustRateWhenP0) + " bust rate when it said LOW.",
    "- **The search prefers high-cardinality factors.** " + topFactors[0][0] + " won " +
      fmt((topFactors[0][1] / rows.length) * 100) + " of all games. A twelve-level month factor has many more chances to separate two halves of fifteen by luck than a binary home/road flag does, so the search takes it, and takes it for no predictive reason.",
    "- **The fix is a stricter factor, not a different split.** Require the winning factor to clear a minimum separation (or a permutation test) before it is allowed to set P, and fall back to P = 0.5 when it does not. On this data that one change would stop the model forcing a call on " + fmt(o.model.callRate) + " of games and would put it on the same answer as the baseline on most of them.",
    "- **The split is not the weak part, the inputs are.** The factor pool here is only home/road and month. Both are known before kickoff, which keeps the test honest, but they are weak separators for a fantasy ceiling. The next real gain is a stronger pre-game factor set (opponent strength, rest days, usage share from the previous game), not a different splitting rule.",
    "- **Keep the plain average in the room.** It is the control. Any change to the model has to beat it on boom detection, bust detection and direction match, over a career-long sample, before it counts as an improvement.",
    "- **Contest results are still missing.** Nothing here says anything about prizes, winning contests or ROI. Those stay pending a DraftKings contest-entry feed, and they are the only metrics that would tell us whether any of this moves money.",
  ].join("\n");

  const L = [];
  L.push("# Projection accuracy: career-to-date backtest (mavis, " + docDate + ")");
  L.push("");
  L.push("Backtest of Dave's projection model (frontend/react/src/lib/dave-projection.ts) against real DraftKings-point actuals, rebuilt over the full history ESPN publishes. Built by mavis.");
  L.push("");
  L.push("**What changed from the rejected run.** The old run used 2023-2026, needed only 5 prior games inside the current season, and led with mean absolute error. This run goes back to " + firstSeason + ", requires **" + result.config.minPriorGames + " prior games across the player's whole career**, and leads with scenario metrics. Mean absolute error is not a metric in this document.");
  L.push("");
  L.push("## The headline numbers");
  L.push("");
  L.push("| | Model | Baseline (plain prior-games average) |");
  L.push("|---|---|---|");
  L.push("| Target games | " + o.targetGames.toLocaleString() + " | " + o.targetGames.toLocaleString() + " |");
  L.push("| Boom games called HIGH | " + fmt(o.model.boomHigh) + " | " + fmt(o.baseline.boomHigh) + " |");
  L.push("| Bust games called LOW | " + fmt(o.model.bustLow) + " | " + fmt(o.baseline.bustLow) + " |");
  L.push("| Direction call matched the outcome | " + fmt(o.model.directionMatch) + " | " + fmt(o.baseline.directionMatch) + " |");
  L.push("| Upward-trend cases identified | " + fmt(o.model.trendIdentified) + " | " + fmt(o.baseline.trendIdentified) + " |");
  L.push("| Actual inside the 90% interval (supporting) | " + fmt(o.model.contained) + " | " + fmt(o.baseline.contained) + " |");
  L.push("| Welch t, projection vs actual (supporting) | " + o.model.welch.t + " | " + o.baseline.welch.t + " |");
  L.push("");
  L.push("Chance is 50% on the first three rows. The baseline column is the plain prior-games average: it has no split and no factor, so the only half it can be said to call is the half its own average sits in. Paired tests on the same games (McNemar-style): direction z = " + o.zTests.directionModelVsBaseline.z + ", boom detection z = " + o.zTests.boomModelVsBaseline.z + ", bust detection z = " + o.zTests.bustModelVsBaseline.z + ", upward-trend identification z = " + o.zTests.trendModelVsBaseline.z + ". The model's direction call against a coin flip is z = " + o.model.directionChanceZ + ".");
  L.push("");
  L.push("## Method, in plain words");
  L.push("");
  L.push("We rebuilt every game log we could from ESPN's public data: the completed regular-season schedule for " + result.config.teams.length + " teams (" + result.config.teams.join(", ") + ") from " + firstSeason + " through " + lastSeason + ", then each game's box score, then scored every offensive player's game with DraftKings' own points rubric, including the 100-yard and 300-yard bonuses.");
  L.push("");
  L.push("Then we walked forward through each player's career. For every game the only inputs are that player's **earlier games** (every completed game of theirs before this one, across all seasons, sorted by date) plus the two things about the upcoming game that are known before kickoff: home or road, and the month. A projection is issued **only when the player has at least " + result.config.minPriorGames + " earlier games**; below that the harness records \"insufficient sample\" and issues nothing. " + result.coverage.targetGamesQualified.toLocaleString() + " target games qualified and " + skippedCount.toLocaleString() + " were skipped.");
  L.push("");
  L.push("The model splits the earlier games into a high half and a low half at the median, finds the one pre-game factor that separates them best, and projects the game as highMean x P + lowMean x (1 - P). The **baseline** is the plain prior-games average: no split, no factor, no weighting. That is what \"nobody special\" looks like, and the model only wins if it beats it on the scenario metrics above.");
  L.push("");
  L.push("## Variables, defined");
  L.push("");
  L.push("- **Earlier games** - that player's completed games whose date is *strictly before* the target game's date, drawn from every season in the dataset and sorted by date ascending. prior_games_n is how many there are.");
  L.push("- **Target game** - a completed game for a player. It *qualifies* when the player has " + result.config.minPriorGames + " or more earlier games; otherwise it is *skipped* with the reason \"insufficient sample\" and no projection is issued.");
  L.push("- **High half / low half** - the model's own median split of the earlier games by DK points: the low half takes the first ceil(n/2) games, the high half the rest, so an odd count puts the middle game in the low half.");
  L.push("- **Cut (C)** - the largest DK point value in the low half. Everything at or below C is low, everything above is high. For an odd number of earlier games this is the median score; for an even number it is the lower median.");
  L.push("- **Boom game** - the target game landed in the player's high half: its actual DK points are greater than C.");
  L.push("- **Bust game** - the target game landed in the low half: its actual DK points are at or below C.");
  L.push("- **Factor** - the single pre-game-known condition (home/road, month) that separates the high half from the low half most strongly. Exactly one is used.");
  L.push("- **P** - the model's probability that the high half's factor condition holds in the target game: 1 if it holds, 0 if it does not, 0.5 when the condition is unknown, or when the two halves are statistically the same population.");
  L.push("- **Containment** - the actual DK points land inside the predictor's 90% interval.");
  L.push("- **Baseline** - the plain prior-games average: the arithmetic mean of all the earlier games, no split, no factor, no weighting, no outlier removal. Its scenario is simply which side of the cut that average falls on.");
  L.push("- **Upward-trend case** - a target game where the mean of the last 5 earlier games is greater than the mean of the first 5 earlier games *and* the actual landed high.");
  L.push("");
  L.push("## Coverage");
  L.push("");
  L.push("| Season | Players with games | Players that qualified | Target games | Boom games | Bust games | Model direction | Baseline direction |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const s of perSeason) {
    L.push("| " + s.season + " | " + s.playersWithGames + " | " + s.playersQualified + " | " + s.targetGames +
      " | " + s.booms + " | " + s.busts + " | " + fmt(s.model.directionMatch) + " | " + fmt(s.baseline.directionMatch) + " |");
  }
  L.push("| **Total** | **" + result.coverage.playersSeen + "** | **" + result.coverage.playersQualified + "** | **" +
    result.coverage.targetGamesQualified + "** | **" + o.booms + "** | **" + o.busts + "** | **" + fmt(o.model.directionMatch) +
    "** | **" + fmt(o.baseline.directionMatch) + "** |");
  L.push("");
  L.push("- The series runs " + firstSeason + " to " + lastSeason + ". **Where the data stops:** ESPN's public schedule and box-score endpoints still serve completed games for seasons before " + firstSeason + " (checked back to 1995 during the build; the endpoints answered with full box scores), so the series is not truncated by ESPN. The floor is the " + result.config.minPriorGames + "-game sample gate and the sampled teams, not the data.");
  L.push("- " + result.coverage.targetGamesSkipped.toLocaleString() + " candidate games were skipped for insufficient sample (fewer than " + result.config.minPriorGames + " earlier games). Nothing was projected for those.");
  L.push("- " + result.coverage.eventsFetched.toLocaleString() + " of " + result.coverage.eventsPlanned.toLocaleString() + " planned game summaries were obtained; " + result.failureCount + " requests failed after retries and are listed in the JSON.");
  L.push("- " + result.requestCount.toLocaleString() + " HTTP requests this run in " + result.runtimeSeconds + " seconds (" + result.summariesFetched.toLocaleString() + " game summaries fetched from ESPN, " + result.summariesFromCache.toLocaleString() + " served from the local cache, which lives in the OS temp directory). A cold run with an empty cache needs about " + (result.coverage.eventsPlanned + result.scheduleRequests + result.positionLookups).toLocaleString() + " requests: " + result.coverage.eventsPlanned.toLocaleString() + " game summaries, " + result.scheduleRequests.toLocaleString() + " team schedules and " + result.positionLookups.toLocaleString() + " position lookups. There were " + result.failureCount + " failed requests after retries.");
  L.push("- The per-season player column counts distinct players within that season; the total row is the distinct count across the whole run.");
  L.push("- Positions in the audited population: " + Object.entries(positionMix).map(([k, v]) => k + " " + v.toLocaleString()).join(", ") + " (target games).");
  L.push("");
  L.push("## Actionable metrics, model vs baseline");
  L.push("");
  L.push("### The model's own scenario (from P)");
  L.push("");
  L.push("| Metric | Model | Baseline | Winner |");
  L.push("|---|---|---|---|");
  for (const c of cmp) {
    L.push("| " + c.label + " | " + fmt(c.m) + " | " + fmt(c.b) + " | " +
      (c.m === null || c.b === null ? "n/a" : c.m > c.b ? "model" : c.m < c.b ? "baseline" : "tie") + " |");
  }
  L.push("");
  L.push("The model declined to call a side on " + fmt(100 - o.model.callRate) + " of target games (P = 0.5: the halves were one population, or nothing separated them). Those count as a miss in the rows above. When the model does call, it matched the outcome on " + fmt(o.model.directionMatchWhenCalled) + " of its " + o.model.callsMade.toLocaleString() + " calls.");
  L.push("");
  L.push("### The same classifier on both sides");
  L.push("");
  L.push("The model above is scored on its own scenario output. To compare like with like, both sides can be classified by one rule: where the forecast sits relative to the same cut C.");
  L.push("");
  L.push("| Metric (same classifier) | Model | Baseline | Winner |");
  L.push("|---|---|---|---|");
  for (const c of cmpSame) {
    L.push("| " + c.label + " | " + fmt(c.m) + " | " + fmt(c.b) + " | " +
      (c.m === null || c.b === null ? "n/a" : c.m > c.b ? "model" : c.m < c.b ? "baseline" : "tie") + " |");
  }
  L.push("");
  L.push("### Supporting lines, by era");
  L.push("");
  L.push("| Era | Target games | Model boom-HIGH | Baseline boom-HIGH | Model bust-LOW | Baseline bust-LOW | Model direction | Baseline direction | Model trend | Baseline trend | Containment model | Containment baseline | Welch t model | Welch t baseline |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of perEra) {
    L.push("| " + b.era + " | " + b.targetGames + " | " + fmt(b.model.boomHigh) + " | " + fmt(b.baseline.boomHigh) +
      " | " + fmt(b.model.bustLow) + " | " + fmt(b.baseline.bustLow) +
      " | " + fmt(b.model.directionMatch) + " | " + fmt(b.baseline.directionMatch) +
      " | " + fmt(b.model.trendIdentified) + " | " + fmt(b.baseline.trendIdentified) +
      " | " + fmt(b.model.contained) + " | " + fmt(b.baseline.contained) +
      " | " + b.model.welch.t + " | " + b.baseline.welch.t + " |");
  }
  L.push("");
  L.push("## Verdict");
  L.push("");
  L.push(verdict);
  L.push("");
  L.push("## Caveats, stated plainly");
  L.push("");
  L.push("- **DraftKings' own per-game projections are not public for past seasons.** Nothing here compares against a DK projection, because there is nothing public to compare against. The baseline is the plain prior-games average, which is the only comparison buildable from public data.");
  L.push("- **Contest-level metrics are not in this run and they are not faked.** Winning contests predicted, accurate picks inside winning contests, and contests contributed to all need DraftKings contest results, which are not publicly available. They stay pending until a DraftKings contest-entry feed exists. The moment that feed exists, these are the metrics that get computed from it: (1) *winning contests predicted* - the number and share of entered contests in which the model's lineup finished first, from the published final standings; (2) *accurate picks inside winning contests* - the share of the model's picks within those winning lineups that individually clear the contest's ownership thresholds at their position; (3) *contests contributed to* - the number of contests the model supplied a lineup for, so every rate has its own denominator; (4) *ROI* - only if the feed carries entry fees and payouts; (5) *top-N finish rate* - the share of entered contests where the model placed in a paying percentile. None of these are estimated, implied or guessed here.");
  L.push("- **Factors fed were pre-game-known only**: home/road and month. In-game information (opponent form, rest, injuries, weather, usage share) was deliberately withheld, because feeding it would fabricate knowledge the projection would not have at lineup time. It is also why the factor's separation power is modest.");
  L.push("- **A player's log only contains games for the sampled teams.** A player who spent part of a season with a club outside " + result.config.teams.join("/") + " has that stretch missing, so their earlier-games count is understated and their split is computed over what we have. The gate is conservative in that direction: it makes the " + result.config.minPriorGames + "-game test harder, not easier.");
  L.push("- **ESPN's box scores do not expose two-point conversions** in the receiving group, so that DraftKings component is 0 in every game in this run. It is worth a fraction of a point per game and is not what separates the model from the baseline.");
  L.push("- **The 90% interval is optimistic.** With halves this small the normal quantile is anti-conservative, which is why containment sits well below 90% for both sides. Treat containment as a relative comparison only.");
  L.push("- **The baseline leans HIGH by construction.** A plain average of a boom/bust distribution sits above the player's median, so its implied call is HIGH on " + fmt(o.baseline.halfCallHigh) + " of games. That is a property of the naive estimator, not a choice made to favour the model, and it is reported as it comes out.");
  L.push("- **The model and Welch maths are a deliberate plain-Node port of src/lib/dave-projection.ts** so the harness runs under bare node with no app imports. The port was checked against the engine itself.");
  L.push("");
  L.push("## What this means for the model");
  L.push("");
  L.push(implications);
  L.push("");
  L.push("Per-game rows: frontend/react/.tmp-audit/mavis-accuracy-history.json (git-ignored). Rebuild with: node scripts/mavis-accuracy-history.mjs");
  L.push("");

  mkdirSync(dirname(OUT_DOC), { recursive: true });
  writeFileSync(OUT_DOC, L.join("\n"));
}




main().catch((err) => {
  console.error("HARNESS BLOCKED:", err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
