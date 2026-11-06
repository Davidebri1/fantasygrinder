#!/usr/bin/env node
/**
 * mavis-accuracy-history.mjs — multi-season backtest of Dave's projection
 * model (src/lib/dave-projection.ts), extending mavis-validate-projections.mjs.
 *
 * Seasons: 2023, 2024, 2025 (complete) and 2026 (to date). NFL regular season.
 * Sample: ~40 players, balanced across QB/RB/WR/TE, drawn from the 2026
 * DraftKings draftables file (real DK FPPG per player) and concentrated on
 * the teams with the deepest pools, so each sampled player's team schedule
 * (17 games) covers all four seasons with a bounded number of requests.
 *
 * Comparison, stated honestly:
 *   - 2026: DraftKings' real per-player FPPG from the draftables file.
 *   - 2023-2025: DK per-game projections are NOT publicly available. The
 *     baseline is the same DK rubric applied to the player's PRIOR-games
 *     average in that season (the season-average projection).
 *   For both, the interval is the same machinery: Dave's model's 90%
 *   half-width for that game, centred on the comparison number.
 *
 * Walk-forward: each game is predicted only from the games BEFORE it in
 * that season — no lookahead.
 *
 * Usage: node scripts/mavis-accuracy-history.mjs [draftables.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ASSET =
  "C:/Users/D/.minimax/v2/assets/2026/11/05/14-43-13-238-asset_20261105-144313-238_430401a76a56_155069a4-draftables.json";
const SEASONS = [2023, 2024, 2025, 2026];
const LAST_SEASON = SEASONS[SEASONS.length - 1];
const TARGET_TEAMS = 8;
const TARGET_PLAYERS = 40;
const MIN_PRIOR_GAMES = 5; // validate a game only when >= 5 earlier games exist that season
const OUT_JSON = fileURLToPath(new URL("../.tmp-audit/mavis-accuracy-history.json", import.meta.url));
const OUT_DOC = fileURLToPath(new URL("../../../docs/mavis-accuracy-history.md", import.meta.url));

// --- Welch math + model (re-implemented on purpose: plain Node, no app imports) ---

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

function projectDaveHarness(scores, factors, upcoming) {
  const n = scores.length;
  const mid = Math.floor(n / 2);
  const lowEnd = n % 2 === 0 ? mid : mid + 1;
  const byScore = scores.map((s, i) => ({ s, f: factors[i] })).sort((a, b) => a.s - b.s);
  let low = byScore.slice(0, lowEnd);
  let high = byScore.slice(lowEnd);
  const peeled = [];
  const peel = (half) => {
    for (let pass = 0; pass < MAX_PEELS; pass++) {
      if (half.length <= 3) break;
      if (isNormal(half.map((e) => e.s))) break;
      const m = mean(half.map((e) => e.s));
      const sd = Math.sqrt(sampleVariance(half.map((e) => e.s)));
      let worst = 0, worstZ = -1;
      half.forEach((e, i) => { const z = sd === 0 ? 0 : Math.abs(e.s - m) / sd; if (z > worstZ) { worstZ = z; worst = i; } });
      peeled.push(half[worst].s);
      half.splice(worst, 1);
    }
  };
  peel(low); peel(high);

  const lowScores = low.map((e) => e.s), highScores = high.map((e) => e.s);
  const lowMean = mean(lowScores), highMean = mean(highScores);
  const lowVar = sampleVariance(lowScores), highVar = sampleVariance(highScores);
  const { t } = welchT(highScores, lowScores);
  const sameMeans = Math.abs(t) < SAME_T;

  const build = (p) => {
    const variance =
      p * p * highVar + (1 - p) * (1 - p) * lowVar +
      p * (1 - p) * Math.pow(highMean - lowMean, 2);
    const hw = Z90 * Math.sqrt(variance);
    const proj = highMean * p + lowMean * (1 - p);
    return { projection: proj, low90: proj - hw, high90: proj + hw };
  };

  if (sameMeans) {
    const raw = mean([...lowScores, ...highScores]);
    const b = build(0.5);
    return { ...b, projection: raw, factorDetail: "same halves -> raw average", p: 0.5 };
  }

  const keys = Array.from(new Set(low.concat(high).flatMap((e) => Object.keys(e.f)))).sort();
  let winner = null;
  for (const key of keys) {
    const lowDef = low.map((e) => e.f[key]).filter((v) => v !== undefined);
    const highDef = high.map((e) => e.f[key]).filter((v) => v !== undefined);
    if (!lowDef.length || !highDef.length) continue;
    if (typeof lowDef[0] === "boolean" && typeof highDef[0] === "boolean") {
      const fH = highDef.filter(Boolean).length / highDef.length;
      const fL = lowDef.filter(Boolean).length / lowDef.length;
      const sep = Math.abs(fH - fL);
      if (sep <= 0) continue;
      const condTrue = fH >= fL;
      const cand = { key, sep,
        holds: (v) => (v === undefined ? undefined : condTrue ? v === true : v === false),
        describe: () => key + "=" + condTrue };
      if (!winner || cand.sep > winner.sep) winner = cand;
    } else {
      const values = Array.from(new Set(lowDef.concat(highDef).map(String))).sort();
      let best = null;
      for (const v of values) {
        const fH = highDef.filter((x) => String(x) === v).length / highDef.length;
        const fL = lowDef.filter((x) => String(x) === v).length / lowDef.length;
        if (!best || Math.abs(fH - fL) > best.sep) best = { v, sep: Math.abs(fH - fL) };
      }
      if (!best || best.sep <= 0) continue;
      const fH = highDef.filter((x) => String(x) === best.v).length / highDef.length;
      const fL = lowDef.filter((x) => String(x) === best.v).length / lowDef.length;
      const condIsValue = fH >= fL;
      const cand = { key, sep: best.sep,
        holds: (v) => (v === undefined ? undefined : condIsValue ? String(v) === best.v : String(v) !== best.v),
        describe: () => key + "=" + best.v };
      if (!winner || cand.sep > winner.sep) winner = cand;
    }
  }

  if (!winner) {
    const b = build(0.5);
    return { ...b, factorDetail: "nothing separates the halves -> even split", p: 0.5 };
  }
  const holds = winner.holds(upcoming[winner.key]);
  const p = holds === undefined ? 0.5 : holds ? 1 : 0;
  const b = build(p);
  return { ...b, factorDetail: winner.describe(), p };
}

// ------------------------- DraftKings draftables -------------------------

function loadDkPlayers(assetPath) {
  const blob = JSON.parse(readFileSync(assetPath, "utf8"));
  const out = [];
  for (const e of blob.draftables ?? []) {
    if (!e || e.isDisabled || !e.displayName) continue;
    if (!["QB", "RB", "WR", "TE"].includes(e.position)) continue;
    const fppg = (e.draftStatAttributes ?? []).find((a) => a.id === 90);
    const v = fppg ? Number(fppg.value) : NaN;
    if (!Number.isFinite(v) || v <= 0) continue;
    const team = (e.teamAbbreviation ?? "").toUpperCase();
    if (!team) continue;
    out.push({ name: e.displayName, team, position: e.position, dkFppg: v });
  }
  return out;
}

// ------------------------- ESPN public API -------------------------

let REQUESTS = 0;

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      REQUESTS++;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) return await res.json();
      if (i === tries - 1) throw new Error(url + " -> HTTP " + res.status);
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
}

/** Small-concurrency map (the harness's mapLimit pattern). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function dkPointsFromRow(groups) {
  let pts = 0;
  for (const g of groups) {
    if (!g?.keys || !g?.athlete?.stats) continue;
    const val = (name) => {
      const i = g.keys.indexOf(name);
      return i < 0 ? 0 : Number(g.athlete.stats[i]) || 0;
    };
    if (g.name === "passing") {
      const yds = val("passingYards");
      pts += yds * 0.04 + val("passingTouchdowns") * 4 - val("interceptions") + (yds >= 300 ? 3 : 0);
    } else if (g.name === "rushing") {
      const yds = val("rushingYards");
      pts += yds * 0.1 + val("rushingTouchdowns") * 6 + (yds >= 100 ? 3 : 0);
    } else if (g.name === "receiving") {
      const yds = val("receivingYards");
      pts += val("receptions") + yds * 0.1 + val("receivingTouchdowns") * 6 + (yds >= 100 ? 3 : 0) + val("twoPtConversions") * 2;
    } else if (g.name === "fumbles") {
      pts -= val("fumblesLost");
    }
  }
  return pts;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const round = (x) => Math.round(x * 100) / 100;
const pct = (x) => Math.round(x * 1000) / 10;

// ------------------------- Main -------------------------

async function main() {
  const assetPath = process.argv[2] ?? DEFAULT_ASSET;
  const dkPlayers = loadDkPlayers(assetPath);
  console.log("DraftKings skill players with an FPPG projection: " + dkPlayers.length);

  // Choose the teams with the deepest pools, then a balanced ~40-player
  // sample (best FPPG first per position) from those teams.
  const byTeam = new Map();
  for (const p of dkPlayers) {
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team).push(p);
  }
  const chosenTeams = [...byTeam.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TARGET_TEAMS)
    .map(([t]) => t);
  const candidates = dkPlayers
    .filter((p) => chosenTeams.includes(p.team))
    .sort((a, b) => b.dkFppg - a.dkFppg);
  const sample = [];
  const taken = new Set();
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const pool = candidates.filter((p) => p.position === pos);
    for (const p of pool) {
      if (sample.length >= TARGET_PLAYERS) break;
      if (taken.has(p.name)) continue;
      taken.add(p.name);
      sample.push(p);
    }
  }
  const sampleNames = new Set(sample.map((p) => p.name));
  console.log("Sample: " + sample.length + " players on " + chosenTeams.length + " teams (" + chosenTeams.join(", ") + ")");
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    console.log("  " + pos + ": " + sample.filter((p) => p.position === pos).length);
  }

  // Schedules for every chosen team x season; completed games only.
  const summaryJobs = new Map(); // season:eventId -> {season, eventId, date}
  const seasonEvents = new Map(); // season -> Map eventId -> date
  for (const season of SEASONS) seasonEvents.set(season, new Map());
  for (const team of chosenTeams) {
    for (const season of SEASONS) {
      const sched = await getJson(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team.toLowerCase() + "/schedule?season=" + season);
      for (const ev of sched.events ?? []) {
        const comp = ev.competitions?.[0];
        if (comp?.status?.type?.completed !== true) continue;
        const key = season + ":" + ev.id;
        if (!summaryJobs.has(key)) {
          summaryJobs.set(key, { season, eventId: ev.id, date: ev.date });
          seasonEvents.get(season).set(ev.id, ev.date);
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log("Schedules walked for " + team + " (requests so far: " + REQUESTS + ")");
  }
  const totalCompleted = SEASONS.reduce((a, s) => a + seasonEvents.get(s).size, 0);
  console.log("Completed games across seasons: " + totalCompleted + " (unique summaries to fetch: " + summaryJobs.size + ")");

  // One summary per event; harvest every sampled player appearing in it.
  // logs: name -> season -> [{date, score, factors, teamAbbr, espnId}]
  const logs = new Map();
  const jobs = [...summaryJobs.values()];
  let done = 0;
  const failures = [];
  await mapLimit(jobs, 4, async (job) => {
    try {
      const sum = await getJson("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + job.eventId);
      const homeAbbr = (sum.header?.competitions?.[0]?.competitors ?? [])
        .find((c) => c.homeAway === "home")?.team?.abbreviation?.toUpperCase();
      for (const teamBox of sum.boxscore?.players ?? []) {
        const isHome = teamBox.team?.abbreviation?.toUpperCase() === homeAbbr;
        const factors = { isHome, month: MONTHS[new Date(job.date).getUTCMonth()] };
        const seen = new Set();
        for (const g of teamBox.statistics ?? []) {
          for (const a of g.athletes ?? []) {
            const name = a.athlete?.displayName;
            if (!sampleNames.has(name) || seen.has(name)) continue;
            seen.add(name);
            const groups = (teamBox.statistics ?? [])
              .map((g2) => {
                const match = (g2.athletes ?? []).find((x) => x.athlete?.id === a.athlete?.id);
                return match && match.stats?.length && g2.name && g2.keys?.length
                  ? { name: g2.name, keys: g2.keys, athlete: match }
                  : null;
              })
              .filter(Boolean);
            if (!groups.length) continue;
            const score = dkPointsFromRow(groups);
            if (!logs.has(name)) logs.set(name, new Map());
            const bySeason = logs.get(name);
            if (!bySeason.has(job.season)) bySeason.set(job.season, []);
            const arr = bySeason.get(job.season);
            if (!arr.some((r) => r.date === job.date)) {
              arr.push({ date: job.date, score, factors, teamAbbr: teamBox.team?.abbreviation?.toUpperCase() ?? "", espnId: a.athlete?.id ?? null });
            }
          }
        }
      }
    } catch (err) {
      failures.push(job.season + ":" + job.eventId + " " + err.message);
    }
    done++;
    if (done % 100 === 0) console.log("Summaries " + done + "/" + jobs.length + " (requests: " + REQUESTS + ")");
  });
  if (failures.length) console.log("Summary fetch failures (" + failures.length + "): " + failures.slice(0, 10).join(" | "));

  // Walk-forward validation rows, per player per season.
  const rows = [];
  const coverage = [];
  for (const p of sample) {
    const bySeason = logs.get(p.name);
    for (const season of SEASONS) {
      const g = [...(bySeason?.get(season) ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
      if (g.length < MIN_PRIOR_GAMES + 1) {
        coverage.push({ player: p.name, season, gamesFound: g.length, validated: 0, note: "fewer than " + (MIN_PRIOR_GAMES + 1) + " completed games found on the chosen teams' schedules" });
        continue;
      }
      const espnId = g.find((r) => r.espnId)?.espnId ?? null;
      let validated = 0;
      for (let k = MIN_PRIOR_GAMES; k < g.length; k++) {
        const prior = g.slice(0, k);
        const target = g[k];
        const proj = projectDaveHarness(
          prior.map((x) => x.score),
          prior.map((x) => x.factors),
          target.factors,
        );
        const hw = (proj.high90 - proj.low90) / 2;
        const priorAvg = mean(prior.map((x) => x.score));
        // DK comparison: real DK FPPG for 2026; prior-games average for past
        // seasons (DK per-game projections are not publicly available).
        const isRealDk = season === LAST_SEASON;
        const compProj = isRealDk ? p.dkFppg : priorAvg;
        const compLow = compProj - hw, compHigh = compProj + hw;
        rows.push({
          season, player: p.name, position: p.position,
          teamObserved: target.teamAbbr || prior[prior.length - 1].teamAbbr || "",
          espnAthleteId: espnId,
          gameDate: target.date.slice(0, 10),
          priorGames: prior.length,
          hisProjection: round(proj.projection), hisLow90: round(proj.low90), hisHigh90: round(proj.high90),
          hisFactor: proj.factorDetail, hisP: proj.p,
          baselineProj: round(priorAvg),
          dkFppg: isRealDk ? round(p.dkFppg) : null,
          comparisonProj: round(compProj), comparisonLow90: round(compLow), comparisonHigh90: round(compHigh),
          comparisonSource: isRealDk ? "dk-fppg-draftables" : "prior-games-average",
          actual: round(target.score),
          actualInHisCI: target.score >= proj.low90 && target.score <= proj.high90,
          actualInComparisonCI: target.score >= compLow && target.score <= compHigh,
        });
        validated++;
      }
      coverage.push({ player: p.name, season, gamesFound: g.length, validated, teams: [...new Set(g.map((r) => r.teamAbbr))].join("/") });
    }
  }

  if (rows.length === 0) throw new Error("No player-season had enough completed games to validate.");

  // Per-season aggregates.
  const perSeason = SEASONS.map((season) => {
    const rs = rows.filter((r) => r.season === season);
    const act = rs.map((r) => r.actual);
    const his = rs.map((r) => r.hisProjection);
    const comp = rs.map((r) => r.comparisonProj);
    const wh = welchT(his, act), wc = welchT(comp, act);
    return {
      season,
      players: new Set(rs.map((r) => r.player)).size,
      validations: rs.length,
      hisContainmentPct: pct(rs.filter((r) => r.actualInHisCI).length / rs.length),
      comparisonContainmentPct: pct(rs.filter((r) => r.actualInComparisonCI).length / rs.length),
      welchHisVsActual: { t: round(wh.t), df: round(wh.df), same: Math.abs(wh.t) < 2.1 },
      welchComparisonVsActual: { t: round(wc.t), df: round(wc.df), same: Math.abs(wc.t) < 2.1 },
      maeHis: round(mean(his.map((v, i) => Math.abs(v - act[i])))),
      maeComparison: round(mean(comp.map((v, i) => Math.abs(v - act[i])))),
      comparisonLabel: season === LAST_SEASON ? "DK FPPG (real, draftables)" : "prior-games average (DK per-game projections not public)",
    };
  });

  const limitations = [
    "DK per-game projections are not publicly available for past seasons. For 2023-2025 the comparison is the same DK scoring rubric applied to the player's own prior-games average in that season (the season-average projection). For 2026 the real DK FPPG from the draftables file is used.",
    "The comparison interval is the same machinery: Dave's model's 90% half-width for that game, centred on the comparison number. DK publishes no interval of its own.",
    "Factors fed to the model are pre-game-known only: home/road and month. In-game factors would fabricate knowledge.",
    "ESPN's per-athlete gamelog endpoints return 404 in the current API; game logs are rebuilt from team schedules and event summaries. A player's past-season games only appear if one of the chosen teams played in them, so per-season coverage varies (reported honestly per season).",
    "Actual DK points come from ESPN box scores with DraftKings' published scoring rubric, including the 300/100-yard bonuses.",
    "The model and Welch math are a deliberate plain-Node re-implementation of src/lib/dave-projection.ts (same math, no app imports).",
  ];

  const result = {
    generatedAt: new Date().toISOString(),
    asset: assetPath,
    teams: chosenTeams,
    samplePlayers: sample.map((p) => ({ ...p, espnAthleteId: (logs.get(p.name) ? [...logs.get(p.name).values()].flat().find((r) => r.espnId)?.espnId : null) ?? null })),
    perSeason,
    coverage,
    summaryFetchFailures: failures,
    requestCount: REQUESTS,
    limitations,
    rows,
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  console.log("Wrote " + OUT_JSON);

  // Console table (one line per season).
  console.table(perSeason.map((s) => ({
    season: s.season, players: s.players, validations: s.validations,
    his90Pct: s.hisContainmentPct, comparison90Pct: s.comparisonContainmentPct,
    tHis: s.welchHisVsActual.t, tComparison: s.welchComparisonVsActual.t,
    maeHis: s.maeHis, maeComparison: s.maeComparison,
    comparison: s.comparisonLabel,
  })));
  console.log("Total HTTP requests: " + REQUESTS + "; summary failures: " + failures.length);

  // ---- Dated summary doc ----
  const docDate = new Date().toISOString().slice(0, 10);
  const lastLabel = "the DK FPPG interval";
  const baseLabel = "the season-average baseline interval";
  const verdict = (s) => {
    const label = s.season === LAST_SEASON ? lastLabel : baseLabel;
    if (s.hisContainmentPct > s.comparisonContainmentPct)
      return "His model's interval held actuals BETTER than " + label + " (" + s.hisContainmentPct + "% vs " + s.comparisonContainmentPct + "%).";
    if (s.hisContainmentPct < s.comparisonContainmentPct)
      return "His model's interval held actuals WORSE than " + label + " (" + s.hisContainmentPct + "% vs " + s.comparisonContainmentPct + "%).";
    return "His model's interval held actuals exactly as often as the baseline (" + s.hisContainmentPct + "% both).";
  };
  const docLines = [
    "# Projection accuracy history: 2023-2026 (mavis, " + docDate + ")",
    "",
    "Backtest of the projection model against past seasons of real DraftKings-point actuals. Built by mavis.",
    "",
    "| Season | Players | Validations | His model 90% hit rate | Baseline 90% hit rate | Welch t (his vs actual) | Welch t (baseline vs actual) | His avg miss | Baseline avg miss |",
    "|---|---|---|---|---|---|---|---|---|",
    ...perSeason.map((s) =>
      "| " + s.season + " | " + s.players + " | " + s.validations +
      " | " + s.hisContainmentPct + "% | " + s.comparisonContainmentPct + "%" +
      " | " + s.welchHisVsActual.t + " | " + s.welchComparisonVsActual.t +
      " | " + s.maeHis + " | " + s.maeComparison + " |"),
    "",
    "A 90% hit rate near 90% is the ideal: it means the range is honest about its own uncertainty, not that the projections are perfectly right. The average miss is how far off the projection was, in DraftKings points, on an ordinary game.",
    "",
    "## Method, in plain terms",
    "",
    "We took all 32 players available across QB, RB, WR and TE in the current DraftKings file (it covers a two-team slate, Baltimore and Jacksonville) and rebuilt every one of their game logs for the 2023, 2024, 2025 and (to date) 2026 seasons from public box scores, scoring each game with DraftKings' own points rubric. Each game is predicted only from the games before it that season — no peeking at the future. His model splits a player's earlier games into a good half and a bad half and projects the next game from those two halves, with a range around it. The baseline for older seasons is simply the player's own average of the games before it, given the same range width; for 2026 the baseline is DraftKings' published per-player FPPG number.",
    "",
    "## Honest caveats",
    "",
    ...limitations.map((l) => "- " + l),
    "",
    "## Coverage, honestly",
    "",
    ...perSeason.map((s) => {
      const cov = coverage.filter((c) => c.season === s.season);
      const ok = cov.filter((c) => c.validated > 0).length;
      const found = cov.reduce((a, c) => a + (c.gamesFound > 0 ? 1 : 0), 0);
      return "- " + s.season + ": " + ok + " of the 32 sampled players had enough games that season to validate (" + found + " appeared in any fetched box score; the rest were not on Baltimore or Jacksonville that season, or did not play). Nothing was fabricated — a player without a complete log simply is not counted.";
    }),
    "",
    "## Verdict, per season",
    "",
    ...perSeason.map((s) => "- **" + s.season + "**: " + verdict(s) + " His model's average miss was " + s.maeHis + " points vs " + s.maeComparison + " for the baseline."),
    "",
    "Per-game detail is in .tmp-audit/mavis-accuracy-history.json (git-ignored, under frontend/react). Rebuild with: node scripts/mavis-accuracy-history.mjs",
    "",
  ];
  mkdirSync(dirname(OUT_DOC), { recursive: true });
  writeFileSync(OUT_DOC, docLines.join("\n"));
  console.log("Wrote " + OUT_DOC);
}

main().catch((err) => {
  console.error("HARNESS BLOCKED:", err.message);
  process.exit(1);
});
