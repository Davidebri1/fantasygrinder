/**
 * Top-level orchestrator. Mirrors `optimizer/run.py` in the Python port.
 *
 * Public API: `runOptimize(settings, players)` → `OptimizeResult`.
 *
 * Flow:
 *   1. Filter eligible (excluded / zero salary / below min projection).
 *   2. Build correlation matrix + run Monte Carlo (if applicable).
 *   3. Build the portfolio — N distinct, legal lineups ranked by score.
 *   4. Report what was produced, and what could not be.
 *
 * The portfolio builder (see `portfolio.ts`) is what guarantees the caller
 * gets the number of lineups they asked for. The previous implementation
 * re-solved the MILP with each found lineup forbidden inside an 8-second
 * wall-clock budget, so asking for 150 lineups silently returned a handful.
 */

import {
  buildGolfLineup,
  buildMmaLineup,
  buildSlotLineup,
  GOLF_ROSTER_SIZE,
  mmaRosterSize,
  MMA_ROSTER_SIZE,
  NBA_CLASSIC_SLOTS,
  NBA_SHOWDOWN_SLOTS,
  NFL_CLASSIC_SLOTS,
  type RosterSlot,
} from "./sports";
import {
  effectiveProjection,
  effectiveStddev,
  runSimulations,
} from "./simulate";
import { buildStrategyPlan } from "./strategies";
import { lpRelaxation } from "./lp";
import { buildPortfolio, type PortfolioSlot } from "./portfolio";
import type {
  Lineup,
  OptimizeResult,
  OptimizerSettings,
  Player,
  SlotAssignment,
  Sport,
  StackRule,
} from "./types";

const SPORT_ROSTER: Record<
  Sport,
  (settings: OptimizerSettings, eligible: Player[]) => number
> = {
  nba: (s) => (s.contestType === "showdown" ? NBA_SHOWDOWN_SLOTS.length : NBA_CLASSIC_SLOTS.length),
  nfl: () => NFL_CLASSIC_SLOTS.length,
  // An MMA card is six fighters, but you can only take one fighter from a
  // bout — so the roster can only be as big as the number of bouts on the
  // card. This has to be counted from the players actually on the slate.
  mma: (s, eligible) =>
    mmaRosterSize(s.allowOpponents ?? false, countDistinctBouts(eligible)),
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

/** The roster slots a given sport/contest uses. */
export function slotsForSport(settings: OptimizerSettings): RosterSlot[] {
  if (settings.sport === "nba") {
    return (settings.contestType ?? "classic") === "showdown"
      ? NBA_SHOWDOWN_SLOTS
      : NBA_CLASSIC_SLOTS;
  }
  if (settings.sport === "nfl") return NFL_CLASSIC_SLOTS;
  return [];
}

/**
 * The stacking rules a run has to satisfy.
 *
 * The legacy global team controls are translated into explicit per-team
 * rules, so the portfolio builder only ever has to understand one kind of
 * rule. The teams come from the eligible pool — a team with no eligible
 * player cannot be stacked and must not become an impossible rule.
 */
function stackRulesFor(settings: OptimizerSettings, eligible: Player[]): StackRule[] {
  const rules: StackRule[] = [...(settings.stackRules ?? [])];
  const teamCounts = new Map<string, number>();
  for (const p of eligible) {
    const team = (p.team ?? "").trim();
    if (!team) continue;
    teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
  }
  const minPerTeam = settings.globalMinPlayersPerTeam ?? 0;
  const maxPerTeam = settings.globalMaxPlayersPerTeam ?? 0;
  if (minPerTeam > 0) {
    for (const [team, count] of teamCounts) {
      rules.push({ scope: "team", id: team, min: minPerTeam, max: count });
    }
  }
  if (maxPerTeam > 0) {
    for (const team of teamCounts.keys()) {
      rules.push({ scope: "team", id: team, min: 0, max: maxPerTeam });
    }
  }
  return rules;
}

/** Sports whose roster is position-constrained (NFL/NBA) vs flat (MMA/Golf). */
function isPositionConstrained(sport: Sport): boolean {
  return sport === "nba" || sport === "nfl";
}

/** A single FLEX slot repeated — used by MMA and Golf. */
function flexSlots(size: number): RosterSlot[] {
  return Array.from({ length: size }, () => ({ label: "FLEX", accepts: null }));
}

export function runOptimize(
  settings: OptimizerSettings,
  players: Player[],
): OptimizeResult {
  const started = performance.now();
  const warnings: string[] = [];
  const eligible = filterEligible(players, settings);
  const rosterSize = SPORT_ROSTER[settings.sport](settings, eligible);
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
  if (settings.strategy === "monteCarlo") {
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

  // 3. Objective scores for this run.
  const plan = buildStrategyPlan(settings.strategy, eligible, settings, simulatedRows);
  const scores = plan[0]?.scores ?? eligible.map((p) => effectiveProjection(p));

  const lockedIdx = new Set<number>();
  for (let i = 0; i < eligible.length; i++) {
    if (eligible[i].isLocked) lockedIdx.add(i);
  }
  const excludedIdx = new Set<number>();

  const slots: RosterSlot[] = isPositionConstrained(settings.sport)
    ? slotsForSport(settings)
    : flexSlots(rosterSize);

  /*
   * On an MMA card you cannot take both fighters from the same bout — that
   * lineup is illegal in every contest. Unless the user has asked to allow
   * it, a lineup that does it is skipped rather than counted.
   */
  const isLegal =
    settings.sport === "mma" && !(settings.allowOpponents ?? false)
      ? (picks: number[]) => {
          const seenBouts = new Set<string>();
          for (const i of picks) {
            const bout = eligible[i]?.bout;
            if (!bout) continue;
            if (seenBouts.has(bout)) return false;
            seenBouts.add(bout);
          }
          return true;
        }
      : undefined;

  // 4. Build the portfolio.
  const stackRules = stackRulesFor(settings, eligible);
  const portfolio = buildPortfolio({
    players: eligible,
    scores,
    slots: slots as PortfolioSlot[],
    salaryCap: settings.salaryCap,
    count: settings.numLineups,
    lockedIdx,
    excludedIdx,
    maxExposurePct: settings.maxExposure ?? 100,
    seed: settings.seed ?? 42,
    isLegal,
    stackRules,
    // A big portfolio needs real time, but it must never be cut short
    // silently — the shortfall is reported below if it happens.
    timeBudgetMs: 20_000,
    maxExpansions: 200_000,
  });

  const built: Lineup[] = portfolio.lineups.map((entry, i) => {
    if (isPositionConstrained(settings.sport)) {
      return buildSlotLineup(
        entry.picks,
        portfolio.slots,
        eligible,
        settings.strategy,
        "browser",
        i + 1,
      );
    }
    if (settings.sport === "mma") {
      return buildMmaLineup(entry.picks, eligible, settings.strategy, "browser", i + 1);
    }
    return buildGolfLineup(entry.picks, eligible, settings.strategy, "browser", i + 1);
  });

  if (portfolio.stats.droppedSlots > 0) {
    warnings.push(
      `${portfolio.stats.droppedSlots} roster slot${portfolio.stats.droppedSlots === 1 ? " has" : "s have"} ` +
        `no eligible player on this slate, so those slots were left out.`,
    );
  }
  for (const rule of portfolio.stats.relaxedStackRules) {
    const what = rule.scope === "team" ? `team ${rule.id}` : `game ${rule.id}`;
    const label = `min ${rule.min} / max ${rule.max} for ${what}`;
    if (rule.reason === "impossible") {
      warnings.push(
        `Stack rule "${label}" cannot be met on this slate, so it was dropped. ` +
          `No lineup can hold that many players from ${rule.id}.`,
      );
    } else {
      warnings.push(
        `Stack rule "${label}" could not be held for every lineup, so it was dropped ` +
          `to keep the full count of ${settings.numLineups} lineups.`,
      );
    }
  }
  if (portfolio.stats.exposureRelaxed) {
    warnings.push(
      `A ${settings.maxExposure}% exposure cap could not be held for all ${settings.numLineups} lineups. ` +
        `The cap was relaxed so you still get the full count — raise the cap in Customize if you would rather ` +
        `have fewer lineups that respect it.`,
    );
  }

  // Non-unique mode: the same optimal lineup repeated for N entries.
  const wantUnique = settings.uniqueLineups !== false;
  let lineups = built;
  if (!wantUnique && built.length > 0) {
    const best = built[0];
    lineups = Array.from({ length: settings.numLineups }, (_, i) => ({
      ...best,
      assignments: best.assignments.map((a: SlotAssignment) => ({ ...a })),
      rank: i + 1,
    }));
    warnings.push(
      "Unique lineups off — the single optimal lineup was repeated. Turn it on for multi-entry portfolio diversity.",
    );
  }

  const shortBy = Math.max(0, settings.numLineups - lineups.length);
  if (shortBy > 0) {
    warnings.push(
      `Requested ${settings.numLineups} lineups; produced ${lineups.length}. ` +
        `The pool of ${eligible.length} eligible players does not contain enough distinct legal lineups ` +
        `under the current salary cap and constraints.`,
    );
  }

  // LP relaxation bound — the "simplex" view. Deterministic and identical
  // for both solver modes; reported so the bound is visible.
  const baseScores = plan[0]?.scores ?? eligible.map((p) => p.projection);
  const lp = lpRelaxation(
    eligible,
    baseScores,
    rosterSize,
    settings.salaryCap,
    lockedIdx,
    excludedIdx,
  );
  const solverName = settings.solver === "simplex" ? "simplex" : "branchBound";

  return {
    lineups,
    strategy: settings.strategy,
    solverBackend: "browser",
    elapsedMs: Math.round(performance.now() - started),
    warnings,
    telemetry: {
      requested: settings.numLineups,
      solves: portfolio.stats.expansions,
      uniqueFound: portfolio.stats.produced,
      duplicatesDropped: portfolio.stats.duplicatesDropped,
      infeasibleSolves: 0,
      shortBy,
      solver: solverName,
      lpBound: Math.round(lp.bound * 100) / 100,
    },
  };
}

// Re-export for callers
export { NBA_CLASSIC_SLOTS, NFL_CLASSIC_SLOTS, MMA_ROSTER_SIZE };
export { effectiveProjection, effectiveStddev } from "./simulate";
export type {
  Sport,
  Strategy,
  Player,
  Lineup,
  SlotAssignment,
  OptimizeResult,
} from "./types";
