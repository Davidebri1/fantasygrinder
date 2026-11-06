#!/usr/bin/env node
/**
 * mavis-validate-projections.mjs — validation harness for Dave's projection
 * model (src/lib/dave-projection.ts).
 *
 * What it does, in the owner's own terms:
 *   "Did you run my predictions for some players? Did you source other
 *   projections to compare against? And then compare to actuals. We are
 *   doing a t-test to compare sameness — does the actual fall within my
 *   model's projection's confidence interval (likewise for other
 *   projections)?"
 *
 * Data sources (all public, no keys):
 *   - DraftKings draftables blob on disk: the player pool and DraftKings'
 *     own projection (draftStatAttributes id 90, "FPPG").
 *   - ESPN's public JSON API for game logs. NOTE: the per-athlete gamelog
 *     endpoints (site[.web].api.espn.com/.../athletes/{id}/gamelog) return
 *     404 in the current API — they are gone. Game logs are rebuilt the
 *     public way instead: each player's team schedule gives the completed
 *     games, and each game's event summary gives the box score, from which
 *     the player's actual DraftKings points are computed with DraftKings'
 *     published scoring rubric.
 *
 * Honest limitations, stated up front:
 *   1. DraftKings publishes one FPPG number per player (their projection
 *      for the current game). It is applied to every validation game for
 *      that player; it is not a per-game historical projection, because
 *      DraftKings does not publish those.
 *   2. DraftKings publishes no confidence interval. To answer "does the
 *      actual fall within the interval" for their number too, the SAME
 *      interval machinery is applied to it: the interval is centred on
 *      DraftKings' number with the same half-width as Dave's model
 *      produced for that player on that game. That is a courtesy
 *      construction, not a DraftKings product.
 *   3. The model and the Welch t-test here are a deliberate re-implementation
 *      (the stats amount to ~40 lines) of the same math as
 *      src/lib/dave-projection.ts, because this script is plain Node and
 *      imports nothing from the app bundle.
 *   4. Factors fed to the model are only the conditions knowable BEFORE a
 *      game: isHome and month. The engine also supports in-game factors
 *      (passAttempts, minutes), but guessing those before a game would
 *      fabricate knowledge the model does not have — when such a factor
 *      wins separation and is unknown for the upcoming game, the model
 *      itself falls back to P = 0.5.
 *
 * Usage:  node scripts/mavis-validate-projections.mjs [draftables.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ASSET =
  "C:/Users/D/.minimax/v2/assets/2026/11/05/14-43-13-238-asset_20261105-144313-238_430401a76a56_155069a4-draftables.json";
const SEASON = 2026;
const OUT_PATH = fileURLToPath(new URL("../.tmp-audit/mavis-projection-validation.json", import.meta.url));
const TARGET_PLAYERS = 12;
const TARGET_TEAMS = 4;
const MIN_PRIOR_GAMES = 5; // validate a game only when >= 5 earlier games exist

// ---------------------------------------------------------------------------
// The Welch math, re-implemented on purpose (see limitation 3)
// ---------------------------------------------------------------------------

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sampleVariance(xs) {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}
/** Welch's t and Welch-Satterthwaite df — same math as the engine module. */
function welchT(a, b) {
  const nA = a.length, nB = b.length;
  const vA = sampleVariance(a), vB = sampleVariance(b);
  const se2 = vA / nA + vB / nB;
  if (se2 === 0) return { t: 0, df: Math.min(nA, nB) - 1 };
  const df =
    (se2 * se2) /
    ((vA / nA) ** 2 / (nA - 1) + (vB / nB) ** 2 / (nB - 1));
  return { t: (mean(a) - mean(b)) / Math.sqrt(se2), df };
}

// ---------------------------------------------------------------------------
// Dave's model, re-implemented for plain Node (see limitation 3)
// ---------------------------------------------------------------------------

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

/**
 * The model, exactly as in src/lib/dave-projection.ts, reduced to what the
 * harness can know: numeric scores and pre-game factors (isHome, month).
 * scores[i] pairs with factors[i] (chronological order; the median split
 * sorts by score internally, exactly like the engine).
 */
function projectDaveHarness(scores, factors, upcoming) {
  const n = scores.length;
  const mid = Math.floor(n / 2);
  const lowEnd = n % 2 === 0 ? mid : mid + 1; // odd middle game -> LOW half
  const byScore = scores
    .map((s, i) => ({ s, f: factors[i] }))
    .sort((a, b) => a.s - b.s);
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

  const lowScores = low.map((e) => e.s);
  const highScores = high.map((e) => e.s);
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
    return { ...b, projection: raw, factor: null, factorDetail: "same halves -> raw average", p: 0.5, peeled, sameMeans: true,
      normality: { high: isNormal(highScores), low: isNormal(lowScores) }, highMean, lowMean };
  }

  // Single winning factor, exactly one (his doc: "you simply pick one").
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
      const cand = { key, sep, highFraction: condTrue ? fH : 1 - fH, lowFraction: condTrue ? fL : 1 - fL,
        holds: (v) => (v === undefined ? undefined : condTrue ? v === true : v === false),
        describe: () => key + "=" + condTrue };
      if (!winner || cand.sep > winner.sep) winner = cand;
    } else {
      // month (categorical): best single value oriented to the high side.
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
      const cand = { key, sep: best.sep, highFraction: condIsValue ? fH : 1 - fH, lowFraction: condIsValue ? fL : 1 - fL,
        holds: (v) => (v === undefined ? undefined : condIsValue ? String(v) === best.v : String(v) !== best.v),
        describe: () => key + "=" + best.v };
      if (!winner || cand.sep > winner.sep) winner = cand;
    }
  }

  if (!winner) {
    const b = build(0.5);
    return { ...b, factor: null, factorDetail: "nothing separates the halves -> even split", p: 0.5, peeled, sameMeans: false,
      normality: { high: isNormal(highScores), low: isNormal(lowScores) }, highMean, lowMean };
  }
  const holds = winner.holds(upcoming[winner.key]);
  const p = holds === undefined ? 0.5 : holds ? 1 : 0;
  const b = build(p);
  return { ...b, factor: winner.key, factorDetail: winner.describe(), p, peeled, sameMeans: false,
    normality: { high: isNormal(highScores), low: isNormal(lowScores) }, highMean, lowMean };
}

// ---------------------------------------------------------------------------
// DraftKings draftables blob
// ---------------------------------------------------------------------------

function loadDkPlayers(assetPath) {
  const blob = JSON.parse(readFileSync(assetPath, "utf8"));
  const out = [];
  for (const e of blob.draftables ?? []) {
    if (!e || e.isDisabled || !e.displayName) continue;
    if (!["QB", "RB", "WR", "TE"].includes(e.position)) continue; // clean DK rubric only
    const fppg = (e.draftStatAttributes ?? []).find((a) => a.id === 90);
    const v = fppg ? Number(fppg.value) : NaN;
    if (!Number.isFinite(v) || v <= 0) continue;
    const team = (e.teamAbbreviation ?? "").toUpperCase();
    if (!team) continue;
    out.push({ name: e.displayName, team, position: e.position, dkFppg: v });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ESPN public API
// ---------------------------------------------------------------------------

async function getJson(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) return await res.json();
      if (i === tries - 1) throw new Error(url + " -> HTTP " + res.status);
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** DraftKings points from an ESPN summary box-score row (stat names may
 *  differ per group; every stat is looked up by name, missing ones count 0). */
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
      pts += yds * 0.04 + val("passingTouchdowns") * 4 - val("interceptions") +
        (yds >= 300 ? 3 : 0);
    } else if (g.name === "rushing") {
      const yds = val("rushingYards");
      pts += yds * 0.1 + val("rushingTouchdowns") * 6 + (yds >= 100 ? 3 : 0);
    } else if (g.name === "receiving") {
      const yds = val("receivingYards");
      pts += val("receptions") + yds * 0.1 + val("receivingTouchdowns") * 6 +
        (yds >= 100 ? 3 : 0) + val("twoPtConversions") * 2;
    } else if (g.name === "fumbles") {
      pts -= val("fumblesLost");
    }
  }
  return pts;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const round = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------

async function main() {
  const assetPath = process.argv[2] ?? DEFAULT_ASSET;
  const dkPlayers = loadDkPlayers(assetPath);
  console.log("DraftKings skill players with an FPPG projection: " + dkPlayers.length);

  // Concentrate players on few teams -> few schedule/summary fetches.
  const byTeam = new Map();
  for (const p of dkPlayers) {
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team).push(p);
  }
  const teams = [...byTeam.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TARGET_TEAMS)
    .map(([team, players]) =>
      ({ team, players: players.sort((a, b) => b.dkFppg - a.dkFppg).slice(0, TARGET_PLAYERS) }));
  const targets = teams
    .flatMap((t) => t.players)
    .sort((a, b) => b.dkFppg - a.dkFppg)
    .slice(0, TARGET_PLAYERS * 2);
  const teamSet = new Set(targets.map((p) => p.team));
  const nameToPlayer = new Map(targets.map((p) => [p.name, p]));
  console.log("Validating on " + targets.length + " players from teams: " + [...teamSet].join(", "));

  // Completed games on the chosen teams' schedules.
  const eventIds = new Map(); // id -> date
  for (const team of teamSet) {
    const sched = await getJson("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team.toLowerCase() + "/schedule?season=" + SEASON);
    for (const ev of sched.events ?? []) {
      const comp = ev.competitions?.[0];
      if (comp?.status?.type?.completed !== true) continue;
      eventIds.set(ev.id, ev.date);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (eventIds.size === 0) {
    throw new Error("No completed " + SEASON + " NFL games found on the chosen teams' schedules — cannot compare to actuals.");
  }
  console.log("Completed games on those schedules: " + eventIds.size);

  // One summary per event; harvest every target player in it.
  const logs = new Map(); // name -> [{date, score, factors}] in game order
  for (const [eventId, date] of [...eventIds.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1))) {
    const sum = await getJson("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + eventId);
    const homeAbbr = (sum.header?.competitions?.[0]?.competitors ?? [])
      .find((c) => c.homeAway === "home")?.team?.abbreviation?.toUpperCase();
    for (const teamBox of sum.boxscore?.players ?? []) {
      const isHome = teamBox.team?.abbreviation?.toUpperCase() === homeAbbr;
      const factors = {
        isHome,
        month: MONTHS[new Date(date).getUTCMonth()],
      };
      const seen = new Set();
      for (const g of teamBox.statistics ?? []) {
        for (const a of g.athletes ?? []) {
          const name = a.athlete?.displayName;
          if (!nameToPlayer.has(name) || seen.has(name)) continue;
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
          if (!logs.has(name)) logs.set(name, []);
          const arr = logs.get(name);
          if (!arr.some((r) => r.date === date)) arr.push({ date, score, factors });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Walk-forward validation rows.
  const rows = [];
  let playersValidated = 0;
  const noLogs = [];
  for (const [name, player] of nameToPlayer) {
    const g = (logs.get(name) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (g.length < MIN_PRIOR_GAMES + 1) { noLogs.push(name); continue; }
    playersValidated++;
    for (let k = MIN_PRIOR_GAMES; k < g.length; k++) {
      const prior = g.slice(0, k);
      const target = g[k];
      const proj = projectDaveHarness(
        prior.map((x) => x.score),
        prior.map((x) => x.factors),
        target.factors,
      );
      const inHis = target.score >= proj.low90 && target.score <= proj.high90;
      // Courtesy interval for DraftKings: same half-width as Dave's CI (limitation 2).
      const hisHw = (proj.high90 - proj.low90) / 2;
      const dkLow = player.dkFppg - hisHw, dkHigh = player.dkFppg + hisHw;
      const inDk = target.score >= dkLow && target.score <= dkHigh;
      rows.push({
        player: name, position: player.position, team: player.team,
        gameDate: target.date.slice(0, 10),
        priorGames: prior.length,
        hisProjection: round(proj.projection), hisLow90: round(proj.low90), hisHigh90: round(proj.high90),
        hisFactor: proj.factorDetail, hisP: proj.p, peeledOut: proj.peeled.length,
        dkFppg: round(player.dkFppg), dkLow90: round(dkLow), dkHigh90: round(dkHigh),
        actual: round(target.score),
        actualInHisCI: inHis, actualInDkCI: inDk,
        normality: proj.normality,
      });
    }
  }

  if (rows.length === 0) {
    throw new Error("No player had enough completed games to validate (need >= " + (MIN_PRIOR_GAMES + 1) + ").");
  }

  // Pooled Welch verdicts across all validation rows.
  const his = rows.map((r) => r.hisProjection);
  const dk = rows.map((r) => r.dkFppg);
  const act = rows.map((r) => r.actual);
  const welchHis = welchT(his, act);
  const welchDk = welchT(dk, act);
  const summary = {
    validationRows: rows.length,
    playersValidated,
    playersWithoutEnoughLogs: noLogs,
    hisCIContainsActual: rows.filter((r) => r.actualInHisCI).length,
    dkCIContainsActual: rows.filter((r) => r.actualInDkCI).length,
    welchHisVsActual: { t: round(welchHis.t), df: round(welchHis.df), same: Math.abs(welchHis.t) < 2.1 },
    welchDkVsActual: { t: round(welchDk.t), df: round(welchDk.df), same: Math.abs(welchDk.t) < 2.1 },
    limitations: [
      "DK's FPPG is one current-week number per player, applied to every validation game; DK publishes no historical per-game projections.",
      "DK's interval is a courtesy construction: Dave's CI half-width centred on DK's number. DK publishes no confidence interval.",
      "The model + Welch math here is a deliberate re-implementation of src/lib/dave-projection.ts (plain Node, no app imports).",
      "Game logs are rebuilt from ESPN team schedules + event summaries because ESPN's per-athlete gamelog endpoints return 404 in the current API.",
      "Factors are pre-game-known only (isHome, month); in-game factors would fabricate knowledge.",
      "Actual DK points are computed from ESPN box scores with DraftKings' published scoring rubric (including the 300/100-yard bonuses).",
    ],
  };

  console.table(rows.map((r) => ({
    player: r.player, game: r.gameDate, his: r.hisProjection,
    his90: "[" + r.hisLow90 + ", " + r.hisHigh90 + "]", dk: r.dkFppg,
    actual: r.actual, inHisCI: r.actualInHisCI, inDkCI: r.actualInDkCI,
  })));
  console.log("Summary: " + JSON.stringify(summary, null, 2));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), season: SEASON, asset: assetPath, summary, rows }, null, 2));
  console.log("Wrote " + OUT_PATH);
}

main().catch((err) => {
  console.error("HARNESS BLOCKED:", err.message);
  process.exit(1);
});
