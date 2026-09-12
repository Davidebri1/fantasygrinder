/**
 * Top-level orchestrator. Mirrors `optimizer/run.py` in the Python port.
 *
 * Public API: `runOptimize(settings, players)` → `OptimizeResult`.
 *
 * Flow:
 *   1. Filter eligible (excluded / zero salary / below min projection).
 *   2. Build correlation matrix + run Monte Carlo (if applicable).
 *   3. Iterate the strategy plan, solve each via MILP, dedupe lineups.
 *   4. Sort by totalProjection desc, assign ranks, return top-K.
 */

import { solveMilp, type MilpSpec } from "./milp";
import {
  buildGolfLineup,
  buildMmaLineup,
  buildNbaLineup,
  GOLF_ROSTER_SIZE,
  mmaRosterSize,
  MMA_ROSTER_SIZE,
  NBA_CLASSIC_SLOTS,
} from "./sports";
import {
  effectiveProjection,
  effectiveStddev,
  runSimulations,
} from "./simulate";
import { buildStrategyPlan } from "./strategies";
import { lpRelaxation } from "./lp";
import type {
  Lineup,
  OptimizeResult,
  OptimizerSettings,
  Player,
  Sport,
} from "./types";

const SPORT_ROSTER: Record<Sport, (settings: OptimizerSettings) => number> = {
  nba: (s) => (s.contestType === "showdown" ? 6 : 8),
  mma: (s) => mmaRosterSize(s.allowOpponents ?? false, countDistinctBouts([])),
  golf: () => GOLF_ROSTER_SIZE,
};

function countDistinctBouts(players: Player[]): number {
  const set = new Set<string>();
  for (const p of players) if (p.bout) set.add(p.bout);
  return set.size;
}

function filterEligible(players: Player[], settings: OptimizerSettings): Player[] {
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const p of players) {
    if (p.isExcluded) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.salary <= 0) continue;
    if (effectiveProjection(p) < (settings.minProjection ?? 0)) continue;
    out.push(p);
  }
  return out;
}

export function runOptimize(
  settings: OptimizerSettings,
  players: Player[],
): OptimizeResult {
  const started = performance.now();
  const warnings: string[] = [];
  const eligible = filterEligible(players, settings);
  const rosterSize = SPORT_ROSTER[settings.sport](settings);
  if (eligible.length < rosterSize) {
    return {
      lineups: [],
      strategy: settings.strategy,
      solverBackend: "browser",
      elapsedMs: Math.round(performance.now() - started),
      warnings: [`Need ≥ ${rosterSize} eligible players; have ${eligible.length}.`],
    };
  }

  // 2. Monte Carlo?
  let simulatedRows: number[][] | null = null;
  if (settings.strategy === "monteCarlo" || settings.strategy === "contrarian") {
    const means = eligible.map((p) => effectiveProjection(p));
    const stds = eligible.map((p) => effectiveStddev(p));
    void means;
    void stds;
    simulatedRows = runSimulations(eligible, settings.simulationCount, {
      sport: settings.sport,
      teammateCorrelation: settings.teammateCorrelation ?? 0.35,
      opponentCorrelation: settings.opponentCorrelation ?? 0.2,
      cardCorrelation: settings.cardCorrelation ?? 0.1,
      seed: settings.seed,
    });
  }

  // 3. Strategy plan
  const plan = buildStrategyPlan(settings.strategy, eligible, settings, simulatedRows);
  const collected: Lineup[] = [];
  const forbidden: Set<number>[] = [];
  const wantUnique = settings.uniqueLineups !== false;

  let solves = 0;
  let duplicatesDropped = 0;
  let infeasibleSolves = 0;

  for (const strat of plan) {
    const spec = buildSpecForSport(eligible, strat.scores, settings, forbidden);
    if (spec === null) continue;
    solves += 1;
    const result = solveMilp(spec);
    if (result.status !== "Optimal" || result.selectedIdx.length === 0) {
      infeasibleSolves += 1;
      continue;
    }

    const lineup = buildLineupForSport(
      result.selectedIdx,
      eligible,
      settings,
      "browser",
      settings.strategy,
      0,
    );
    // We accept incomplete slot assignments (bipartite may fail on
    // degenerate top-of-projection picks). The UI shows whatever
    // slots were filled; missing slots are omitted.
    if (collected.find((l) => l.uniqueKey === lineup.uniqueKey)) {
      duplicatesDropped += 1;
      continue;
    }
    collected.push(lineup);
    forbidden.push(new Set(result.selectedIdx));

    // Non-unique mode: we only need the single optimal lineup, cloned below.
    if (!wantUnique) break;
    if (collected.length >= settings.numLineups) break;
  }

  // Non-unique mode: return the proven optimum repeated N times (the same
  // lineup for N contest entries), rather than N distinct combinations.
  if (!wantUnique && collected.length > 0) {
    const best = collected[0];
    const clones: Lineup[] = Array.from({ length: settings.numLineups }, (_, i) => ({
      ...best,
      assignments: best.assignments.map((a) => ({ ...a })),
      rank: i + 1,
    }));
    return {
      lineups: clones,
      strategy: settings.strategy,
      solverBackend: "browser",
      elapsedMs: Math.round(performance.now() - started),
      warnings: [
        "Unique lineups off — the single optimal lineup was repeated. Turn it on for multi-entry portfolio diversity.",
      ],
      telemetry: {
        requested: settings.numLineups,
        solves,
        uniqueFound: 1,
        duplicatesDropped,
        infeasibleSolves,
        shortBy: 0,
      },
    };
  }

  // 4. Sort + rank
  collected.sort((a, b) => b.totalProjection - a.totalProjection);
  collected.forEach((l, i) => (l.rank = i + 1));
  const top = collected.slice(0, settings.numLineups);

  const shortBy = Math.max(0, settings.numLineups - collected.length);
  if (shortBy > 0) {
    warnings.push(
      `Requested ${settings.numLineups} unique lineups; produced ${collected.length} ` +
        `(${solves} solves, ${duplicatesDropped} duplicates dropped, ${infeasibleSolves} infeasible). ` +
        `The pool or constraints don't allow more distinct lineups.`,
    );
  }

  // LP relaxation bound — the "simplex" view. Deterministic and identical
  // for both solver modes; reported so the bound is visible.
  const lockedIdx = new Set<number>();
  const excludedIdx = new Set<number>();
  for (let i = 0; i < eligible.length; i++) {
    if (eligible[i].isLocked) lockedIdx.add(i);
    if (eligible[i].isExcluded) excludedIdx.add(i);
  }
  const rosterSizeForLp = SPORT_ROSTER[settings.sport](settings);
  const baseScores = plan[0]?.scores ?? eligible.map((p) => p.projection);
  const lp = lpRelaxation(
    eligible,
    baseScores,
    rosterSizeForLp,
    settings.salaryCap,
    lockedIdx,
    excludedIdx,
  );
  const solverName = settings.solver === "simplex" ? "simplex" : "branchBound";

  return {
    lineups: top,
    strategy: settings.strategy,
    solverBackend: "browser",
    elapsedMs: Math.round(performance.now() - started),
    warnings,
    telemetry: {
      requested: settings.numLineups,
      solves,
      uniqueFound: collected.length,
      duplicatesDropped,
      infeasibleSolves,
      shortBy,
      solver: solverName,
      lpBound: Math.round(lp.bound * 100) / 100,
    },
  };
}

function buildSpecForSport(
  eligible: Player[],
  scores: number[],
  settings: OptimizerSettings,
  forbidden: Set<number>[],
): MilpSpec | null {
  const locked = new Set<number>();
  const excluded = new Set<number>();
  for (let i = 0; i < eligible.length; i++) {
    if (eligible[i].isLocked) locked.add(i);
    if (eligible[i].isExcluded) excluded.add(i);
  }

  const rosterSize = SPORT_ROSTER[settings.sport](settings);
  const baseSpec: MilpSpec = {
    scores: scores.slice(),
    salaries: eligible.map((p) => p.salary),
    rosterSize,
    salaryCap: settings.salaryCap,
    lockedIdx: locked,
    excludedIdx: excluded,
    forbiddenSets: forbidden,
  };

  if (settings.sport === "nba" && settings.contestType === "showdown") {
    // CPT multiplier: pick the highest-proj player as captain.
    const cptIdx = scores
      .map((s, i) => ({ s, i }))
      .filter((x) => !excluded.has(x.i))
      .sort((a, b) => b.s - a.s)[0]?.i;
    if (cptIdx == null) return null;
    const multipliers = new Array(eligible.length).fill(1.0);
    multipliers[cptIdx] = 1.5;
    return {
      ...baseSpec,
      scoreMultipliers: multipliers,
      preAssignments: [[0, cptIdx]],
    };
  }

  if (settings.sport === "mma") {
    const distinctBouts = countDistinctBouts(eligible);
    const size = mmaRosterSize(settings.allowOpponents ?? false, distinctBouts);
    return { ...baseSpec, rosterSize: size };
  }

  return baseSpec;
}

function buildLineupForSport(
  selectedIdx: number[],
  players: Player[],
  settings: OptimizerSettings,
  backend: "browser",
  strategy: string,
  rank: number,
): Lineup {
  if (settings.sport === "nba") {
    return buildNbaLineup(
      selectedIdx,
      players,
      settings.contestType ?? "classic",
      strategy,
      backend,
      rank,
    );
  }
  if (settings.sport === "mma") {
    return buildMmaLineup(selectedIdx, players, strategy, backend, rank);
  }
  return buildGolfLineup(selectedIdx, players, strategy, backend, rank);
}

// Re-export for callers
export { NBA_CLASSIC_SLOTS };
export { effectiveProjection, effectiveStddev } from "./simulate";
export type {
  Sport,
  Strategy,
  Player,
  Lineup,
  SlotAssignment,
  OptimizeResult,
} from "./types";
