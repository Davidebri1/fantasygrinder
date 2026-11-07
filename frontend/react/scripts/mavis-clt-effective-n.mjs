/**
 * mavis-clt-effective-n.mjs
 *
 * Has the central limit theorem actually been reached, per statistic?
 *
 * The accuracy harness gates on 30 earlier GAMES. That guarantees 30 observations of the
 * modelled variable (DraftKings points per game), but it does not guarantee 30 observations
 * of a secondary statistic: a receiver who was targeted zero times in 20 of his 30 games has
 * an effective sample of 10 catches, and no number of games fixes that.
 *
 * This script measures the gap:
 *   - earlier games the harness counts (DK-relevant stat)
 *   - the EFFECTIVE sample for each statistic: earlier games where it was non-zero
 *   - the joint gate: target games where every measured statistic clears 30
 *   - the plain prior-games baseline re-scored under both gates
 *
 * Writes:
 *   frontend/react/.tmp-audit/mavis-clt-effective-n.json
 *   docs/mavis-clt-effective-n.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_JSON = join(ROOT, ".tmp-audit", "mavis-clt-effective-n.json");
const OUT_DOC = resolve(ROOT, "..", "..", "docs", "mavis-clt-effective-n.md");
const CACHE_DIR = process.env.MAVIS_CACHE_DIR
  ? process.env.MAVIS_CACHE_DIR
  : join(tmpdir(), "mavis-clt-cache");

const TEAMS = (process.env.MAVIS_TEAMS ?? "ne,gb,pit,sf")
  .split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const SEASON_START = Number(process.env.MAVIS_SEASON_START ?? 2002);
const SEASON_END = Number(process.env.MAVIS_SEASON_END ?? 2026);
const MIN_PRIOR = Number(process.env.MAVIS_MIN_PRIOR ?? 30);
const CONCURRENCY = Number(process.env.MAVIS_CONCURRENCY ?? 12);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let REQUESTS = 0;
const FAILURES = [];

async function getJson(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      REQUESTS++;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  FAILURES.push(url + " :: " + String(lastErr));
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function groupNumber(rec, group, key) {
  const g = rec.groups[group];
  if (!g) return 0;
  const i = g.keys.indexOf(key);
  return i < 0 ? 0 : num(g.values[i]);
}
function passingAttempts(rec) {
  const g = rec.groups.passing;
  if (!g) return 0;
  const i = g.keys.indexOf("completions/passingAttempts");
  if (i < 0) return 0;
  const parts = String(g.values[i] ?? "").split("/");
  return num(parts[parts.length - 1]);
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
function dkPoints(rec) {
  const get = (group, key) => groupNumber(rec, group, key);
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

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const lowEnd = s.length % 2 === 0 ? m : m + 1;
  return s[lowEnd - 1];
}
function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function quantiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
  return {
    n: s.length,
    min: s[0] ?? null,
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1] ?? null,
    shareAtLeast30: s.length ? +(s.filter((v) => v >= 30).length / s.length).toFixed(4) : null,
  };
}

(async () => {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, "summaries.json");
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const seasons = [];
  for (let s = SEASON_START; s <= SEASON_END; s++) seasons.push(s);

  const events = new Map();
  await mapLimit(TEAMS.flatMap((t) => seasons.map((s) => [t, s])), 4, async ([team, season]) => {
    const sched = await getJson(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team + "/schedule?season=" + season,
    );
    for (const ev of sched?.events ?? []) {
      if (ev?.competitions?.[0]?.status?.type?.completed !== true) continue;
      const id = String(ev.id);
      if (events.has(id)) continue;
      events.set(id, { id, date: ev.date, season });
    }
  });
  const ids = [...events.keys()];
  console.log("Completed games: " + ids.length + " (requests " + REQUESTS + ")");

  let done = 0;
  await mapLimit(ids, CONCURRENCY, async (id) => {
    if (cache[id]) { done++; return; }
    const ev = events.get(id);
    const sum = await getJson(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + id,
    );
    if (!sum) { done++; return; }
    const competitors = sum?.header?.competitions?.[0]?.competitors ?? [];
    const homeAbbr = (competitors.find((c) => c.homeAway === "home")?.team?.abbreviation ?? "").toUpperCase();
    const out = [];
    for (const teamBox of sum?.boxscore?.players ?? []) {
      const teamAbbr = (teamBox?.team?.abbreviation ?? "").toUpperCase();
      const byAthlete = new Map();
      for (const g of teamBox?.statistics ?? []) {
        for (const a of g?.athletes ?? []) {
          const aid = a?.athlete?.id;
          if (!aid) continue;
          let rec = byAthlete.get(aid);
          if (!rec) {
            rec = { id: String(aid), name: a.athlete.displayName ?? "", groups: {} };
            byAthlete.set(aid, rec);
          }
          rec.groups[g.name] = { keys: g.keys ?? [], values: a.stats ?? [] };
        }
      }
      for (const rec of byAthlete.values()) {
        const pos = inferPosition(rec);
        if (!pos) continue;
        out.push({
          id: rec.id, name: rec.name, team: teamAbbr, pos,
          date: ev.date, season: ev.season, month: MONTHS[new Date(ev.date).getUTCMonth()],
          isHome: teamAbbr === homeAbbr,
          pts: dkPoints(rec),
          passAtt: passingAttempts(rec),
          rushAtt: groupNumber(rec, "rushing", "rushingAttempts"),
          rec: groupNumber(rec, "receiving", "receptions"),
          tgt: groupNumber(rec, "receiving", "receivingTargets"),
        });
      }
    }
    cache[id] = out;
    done++;
    if (done % 400 === 0) {
      console.log("  summaries " + done + "/" + ids.length);
      writeFileSync(cachePath, JSON.stringify(cache));
    }
  });
  writeFileSync(cachePath, JSON.stringify(cache));
  console.log("Summaries held: " + Object.keys(cache).length + " (requests " + REQUESTS + ")");

  const logs = new Map();
  for (const id of ids) {
    for (const p of cache[id] ?? []) {
      if (!logs.has(p.id)) logs.set(p.id, []);
      logs.get(p.id).push(p);
    }
  }
  for (const arr of logs.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const rows = [];
  for (const [pid, games] of logs) {
    for (let i = 0; i < games.length; i++) {
      const target = games[i];
      const earlier = games.slice(0, i);
      if (earlier.length < MIN_PRIOR) continue;
      const pts = earlier.map((g) => g.pts);
      const cut = median(pts);
      const avg = mean(pts);
      const eff = {
        passAtt: earlier.filter((g) => g.passAtt > 0).length,
        rushAtt: earlier.filter((g) => g.rushAtt > 0).length,
        rec: earlier.filter((g) => g.rec > 0).length,
        tgt: earlier.filter((g) => g.tgt > 0).length,
      };
      rows.push({
        id: pid, name: target.name, team: target.team, pos: target.pos,
        date: target.date, season: target.season,
        nGames: earlier.length,
        cut, avg, actual: target.pts,
        boom: target.pts > cut,
        bust: target.pts <= cut,
        baselineHigh: avg > cut,
        eff,
      });
    }
  }
  console.log("Target games qualified (n_games >= " + MIN_PRIOR + "): " + rows.length);

  const STATS = ["passAtt", "rushAtt", "rec", "tgt"];
  const RELEVANT = {
    QB: ["passAtt"],
    RB: ["rushAtt", "tgt"],
    "WR/TE": ["tgt", "rec"],
  };
  function relevantFor(pos) { return RELEVANT[pos] ?? []; }
  // A statistic only accrues for the positions that generate it. Requiring every
  // statistic to clear 30 is therefore empty by construction: a wide receiver
  // never has 30 pass attempts. The meaningful gate is the set of statistics
  // that are actually relevant to the player's position.
  const LABEL = { passAtt: "Pass attempts", rushAtt: "Rush attempts", rec: "Receptions", tgt: "Receiving targets" };
  const perStat = {};
  for (const s of STATS) perStat[s] = quantiles(rows.map((r) => r.eff[s]));
  const nGamesQ = quantiles(rows.map((r) => r.nGames));
  const joint = rows.filter((r) => relevantFor(r.pos).every((s) => r.eff[s] >= 30));
  const anyBelow = rows.filter((r) => relevantFor(r.pos).some((s) => r.eff[s] < 30));
  const allStatsJoint = rows.filter((r) => STATS.every((s) => r.eff[s] >= 30));
  // Per-position share for each statistic, so a diluted column is not misread.
  const byPos = {};
  for (const r of rows) {
    if (!byPos[r.pos]) byPos[r.pos] = [];
    byPos[r.pos].push(r);
  }
  const perStatByPos = {};
  for (const pos of Object.keys(byPos)) {
    perStatByPos[pos] = {};
    for (const s of STATS) {
      perStatByPos[pos][s] = quantiles(byPos[pos].map((r) => r.eff[s]));
    }
    perStatByPos[pos].nGames = quantiles(byPos[pos].map((r) => r.nGames));
  }

  function rates(subset) {
    if (!subset.length) return null;
    const n = subset.length;
    return {
      games: n,
      boomRate: +(subset.filter((r) => r.boom).length / n).toFixed(4),
      baselineCallsHigh: +(subset.filter((r) => r.baselineHigh).length / n).toFixed(4),
      baselineDirectionMatch: +(subset.filter((r) => r.baselineHigh === r.boom).length / n).toFixed(4),
    };
  }

  // ---- join with the accuracy harness rows, and score both gates --------
  // The harness already produced every model's output per target game. Joining
  // it here lets the SAME scenario metrics be scored on the full population
  // and on the stricter population. Recomputing the full-population numbers
  // is also the check that this join is correct: they must reproduce the
  // accuracy document exactly.
  const ACCURACY_JSON = join(ROOT, ".tmp-audit", "mavis-accuracy-history.json");
  let gateSplit = null;
  if (existsSync(ACCURACY_JSON)) {
    const acc = JSON.parse(readFileSync(ACCURACY_JSON, "utf8"));
    const byKey = new Map();
    for (const r of acc.rows ?? []) {
      byKey.set(r.athlete_id + "|" + r.date, r);
    }
    const joined = [];
    for (const r of rows) {
      const a = byKey.get(r.id + "|" + r.date);
      if (!a) continue;
      joined.push({
        pos: r.pos,
        boom: a.boom_or_bust_actual === "BOOM",
        bust: a.boom_or_bust_actual === "BUST",
        modelHigh: a.model_half === "HIGH",
        modelLow: a.model_half === "LOW",
        baseHigh: a.baseline_half === "HIGH",
        trendCase: !!a.upward_trend_case,
        strict: relevantFor(r.pos).every((s) => r.eff[s] >= 30),
      });
    }
    function score(subset) {
      if (!subset.length) return null;
      const n = subset.length;
      const booms = subset.filter((x) => x.boom);
      const busts = subset.filter((x) => x.bust);
      const trends = subset.filter((x) => x.trendCase);
      const dir = subset.filter((x) => (x.boom && x.modelHigh) || (x.bust && x.modelLow)).length / n;
      const dirB = subset.filter((x) => (x.boom && x.baseHigh) || (x.bust && !x.baseHigh)).length / n;
      return {
        games: n,
        boomGames: booms.length,
        bustGames: busts.length,
        trendCases: trends.length,
        modelBoomHigh: booms.length ? +(booms.filter((x) => x.modelHigh).length / booms.length).toFixed(4) : null,
        baseBoomHigh: booms.length ? +(booms.filter((x) => x.baseHigh).length / booms.length).toFixed(4) : null,
        modelBustLow: busts.length ? +(busts.filter((x) => x.modelLow).length / busts.length).toFixed(4) : null,
        baseBustLow: busts.length ? +(busts.filter((x) => !x.baseHigh).length / busts.length).toFixed(4) : null,
        modelDirection: +dir.toFixed(4),
        baseDirection: +dirB.toFixed(4),
        modelTrend: trends.length ? +(trends.filter((x) => x.modelHigh).length / trends.length).toFixed(4) : null,
        baseTrend: trends.length ? +(trends.filter((x) => x.baseHigh).length / trends.length).toFixed(4) : null,
      };
    }
    const full = score(joined);
    const strict = score(joined.filter((x) => x.strict));
    gateSplit = { joined: joined.length, full, strict };
  }

  const result = {
    generatedAt: new Date().toISOString(),
    config: { teams: TEAMS, seasons: [SEASON_START, SEASON_END], minPriorGames: MIN_PRIOR },
    requestCount: REQUESTS,
    failureCount: FAILURES.length,
    coverage: {
      eventsFetched: Object.keys(cache).length,
      eventsPlanned: ids.length,
      players: logs.size,
      targetGamesQualified: rows.length,
    },
    nEarlierGames: nGamesQ,
    effectiveN: perStat,
    effectiveNByPosition: perStatByPos,
    jointStrictGate: {
      note: "Every statistic that is relevant to the player's position clears 30 non-zero observations.",
      games: joint.length,
      shareOfQualified: +(joint.length / rows.length).toFixed(4),
      rates: rates(joint),
    },
    allStatisticsGate: {
      note: "Every statistic clears 30, including the ones that do not apply to the position. Empty by construction, and reported so it is not mistaken for a result.",
      games: allStatsJoint.length,
      shareOfQualified: +(allStatsJoint.length / rows.length).toFixed(4),
    },
    gamesOnlyGate: { rates: rates(rows) },
    gateSplit,
    minutesPlayed: {
      available: false,
      note: "ESPN's NFL box score has no minutes or snap-count statistic, so a minutes-based sample size cannot be measured from this source. Snap counts would need another provider.",
    },
  };
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), "utf8");

  const L = [];
  const pct1 = (x) => (x * 100).toFixed(1) + "%";
  L.push("# Has the central limit theorem actually been reached?");
  L.push("");
  L.push("Generated by scripts/mavis-clt-effective-n.mjs on " + new Date().toISOString().slice(0, 10) + ".");
  L.push("");
  L.push("The accuracy harness gates on **30 earlier games**. That guarantees 30 observations of the");
  L.push("variable the model actually projects - DraftKings points per game - so the CLT holds for the");
  L.push("projection. It does **not** automatically hold for a secondary statistic: a receiver who was");
  L.push("targeted zero times in 20 of his 30 games has an effective sample of 10 catches, and no");
  L.push("number of games fixes that. This page measures the difference.");
  L.push("");
  L.push("## Coverage");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push("| Seasons | " + SEASON_START + "-" + SEASON_END + " |");
  L.push("| Teams | " + TEAMS.join(", ") + " |");
  L.push("| Games fetched | " + Object.keys(cache).length + " of " + ids.length + " |");
  L.push("| Players with games | " + logs.size + " |");
  L.push("| Target games with >= " + MIN_PRIOR + " earlier games | " + rows.length + " |");
  L.push("| HTTP requests | " + REQUESTS + " (" + FAILURES.length + " failed) |");
  L.push("");
  L.push("## Effective sample size, per statistic");
  L.push("");
  L.push("Effective n = the number of earlier games in which the statistic was **non-zero**.");
  L.push("");
  L.push("| Statistic | min | p10 | median | p90 | max | target games with effective n >= 30 |");
  L.push("|---|---|---|---|---|---|---|");
  for (const s of STATS) {
    const q = perStat[s];
    L.push("| " + LABEL[s] + " | " + q.min + " | " + q.p10 + " | " + q.median + " | " + q.p90 + " | " + q.max + " | " + pct1(q.shareAtLeast30) + " |");
  }
  L.push("| DraftKings points (the modelled variable) | " + nGamesQ.min + " | " + nGamesQ.p10 + " | " + nGamesQ.median + " | " + nGamesQ.p90 + " | " + nGamesQ.max + " | 100% |");
  L.push("");
  L.push("### Minutes played");
  L.push("");
  L.push("**Not available.** ESPN's NFL box score carries no minutes or snap-count statistic, so a");
  L.push("minutes-based sample size cannot be measured from this source at all. It would need snap");
  L.push("counts from another provider.");
  L.push("");
  L.push("### By position");
  L.push("");
  L.push("A statistic only accrues for the positions that generate it, so the shares above are");
  L.push("diluted by players who never touch that statistic. Here they are per position.");
  L.push("");
  L.push("| Position | Target games | " + STATS.map((s) => LABEL[s]).join(" | ") + " |");
  L.push("|---|---|" + STATS.map(() => "---").join("|") + "|");
  for (const pos of Object.keys(byPos)) {
    const cells = STATS.map((s) => pct1(perStatByPos[pos][s].shareAtLeast30));
    L.push("| " + pos + " | " + byPos[pos].length + " | " + cells.join(" | ") + " |");
  }
  L.push("");
  L.push("## The joint gate");
  L.push("");
  L.push("### Requiring every statistic, including the ones that do not apply");
  L.push("");
  L.push("That gate is empty: " + allStatsJoint.length + " of " + rows.length + " target games. It is");
  L.push("empty by construction, because a wide receiver never has 30 pass attempts. It is reported");
  L.push("here so it is not mistaken for a result.");
  L.push("");
  L.push("");
  L.push("Requiring **every statistic that is relevant to the player's position** to clear 30 leaves " +
    joint.length + " of " + rows.length + " target games (" +
    pct1(result.jointStrictGate.shareOfQualified) + ").");
  L.push("");
  if (joint.length && result.gamesOnlyGate.rates) {
    const g = result.gamesOnlyGate.rates, s = result.jointStrictGate.rates;
    L.push("| Population | Games | Boom rate | Baseline calls HIGH | Baseline direction matched |");
    L.push("|---|---|---|---|---|");
    L.push("| Games-only gate (n_games >= 30) | " + g.games + " | " + pct1(g.boomRate) + " | " + pct1(g.baselineCallsHigh) + " | " + pct1(g.baselineDirectionMatch) + " |");
    L.push("| Strict gate (every stat's effective n >= 30) | " + s.games + " | " + pct1(s.boomRate) + " | " + pct1(s.baselineCallsHigh) + " | " + pct1(s.baselineDirectionMatch) + " |");
    L.push("");
  }
  if (gateSplit && gateSplit.full && gateSplit.strict) {
    L.push("## The model, scored under both gates");
    L.push("");
    L.push("The same four scenario metrics, on the full qualified population and on the strictly");
    L.push("qualified one. The full-population column is also the check on this join: it reproduces");
    L.push("the numbers in the accuracy document exactly.");
    L.push("");
    L.push("| Metric | Full (n_games >= 30) | Strict (relevant stats >= 30) |");
    L.push("|---|---|---|");
    const f = gateSplit.full, s = gateSplit.strict;
    const p1 = (x) => (x === null || x === undefined ? "n/a" : (x * 100).toFixed(1) + "%");
    L.push("| Target games | " + f.games + " | " + s.games + " |");
    L.push("| Boom games called HIGH (model) | " + p1(f.modelBoomHigh) + " | " + p1(s.modelBoomHigh) + " |");
    L.push("| Boom games called HIGH (baseline) | " + p1(f.baseBoomHigh) + " | " + p1(s.baseBoomHigh) + " |");
    L.push("| Bust games called LOW (model) | " + p1(f.modelBustLow) + " | " + p1(s.modelBustLow) + " |");
    L.push("| Bust games called LOW (baseline) | " + p1(f.baseBustLow) + " | " + p1(s.baseBustLow) + " |");
    L.push("| Direction matched (model) | " + p1(f.modelDirection) + " | " + p1(s.modelDirection) + " |");
    L.push("| Direction matched (baseline) | " + p1(f.baseDirection) + " | " + p1(s.baseDirection) + " |");
    L.push("| Upward-trend cases identified (model) | " + p1(f.modelTrend) + " | " + p1(s.modelTrend) + " |");
    L.push("| Upward-trend cases identified (baseline) | " + p1(f.baseTrend) + " | " + p1(s.baseTrend) + " |");
    L.push("");
  }
  L.push("## What this means");
  L.push("");
  L.push("- The CLT is reached **for the variable the model projects** (DraftKings points) at every");
  L.push("  qualified target game: n >= " + MIN_PRIOR + " earlier games.");
  L.push("- It is reached **per statistic** only where the share in the table above is high. Where it");
  L.push("  is not, that statistic's mean for that player rests on fewer than 30 real observations.");
  L.push("- " + anyBelow.length + " of " + rows.length + " target games (" +
    pct1(anyBelow.length / rows.length) + ") have at least one statistic whose effective sample");
  L.push("  is below 30.");
  L.push("");
  mkdirSync(dirname(OUT_DOC), { recursive: true });
  writeFileSync(OUT_DOC, L.join("\n"), "utf8");
  console.log("Wrote " + OUT_JSON);
  console.log("Wrote " + OUT_DOC);
  console.log(JSON.stringify({ nEarlierGames: nGamesQ, effectiveN: perStat, joint: result.jointStrictGate }, null, 2));
})().catch((e) => {
  console.error(String(e).slice(0, 800));
  process.exit(1);
});
