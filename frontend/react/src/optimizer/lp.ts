/**
 * LP relaxation of the lineup problem.
 *
 * The integer program is:
 *   maximize  Σ scoreᵢ · xᵢ
 *   subject to Σ xᵢ = rosterSize        (exactly N players)
 *              Σ salaryᵢ · xᵢ ≤ cap       (budget)
 *              xᵢ ∈ {0, 1}               (discrete)
 *
 * Relax xᵢ ∈ {0, 1} to 0 ≤ xᵢ ≤ 1 and this LP has a closed-form optimum:
 * it's a fractional knapsack with a cardinality constraint, so you take
 * candidates by score density until the budget binds — exactly one item may
 * be taken fractionally. That optimum is the LP *bound*: no integer lineup
 * can beat it, and the branch-and-bound search uses it to prune.
 *
 * This is the "simplex" view of the problem. The LP is linear, so the
 * solution is deterministic; the integer solver then rounds up to the
 * discrete optimum, so both modes return identical lineups.
 */
import type { Player } from "./types";

export interface LpResult {
  /** Upper bound on any feasible lineup's score. */
  bound: number;
  /** Number of items taken whole. */
  integralCount: number;
  /** Fraction of the single fractional item (0..1), if the budget binds. */
  fractional: number;
  /** Density-sort comparisons performed (a cheap "iteration" proxy). */
  iterations: number;
  feasible: boolean;
}

export function lpRelaxation(
  players: Player[],
  scores: number[],
  rosterSize: number,
  cap: number,
  lockedIdx: Set<number>,
  excludedIdx: Set<number>,
): LpResult {
  let bound = 0;
  let budget = cap;
  let remaining = rosterSize;
  let integralCount = 0;
  let fractional = 0;
  let iterations = 0;

  for (const i of lockedIdx) {
    bound += scores[i];
    budget -= players[i].salary;
    remaining -= 1;
    integralCount += 1;
  }
  if (remaining < 0 || budget < 0) {
    return { bound: 0, integralCount, fractional: 0, iterations, feasible: false };
  }

  const candidates = players
    .map((p, i) => i)
    .filter((i) => !lockedIdx.has(i) && !excludedIdx.has(i) && players[i].salary > 0)
    .sort((a, b) => {
      iterations += 1;
      const da = scores[a] / players[a].salary;
      const db = scores[b] / players[b].salary;
      return db - da;
    });

  for (const i of candidates) {
    if (remaining <= 0) break;
    const sal = players[i].salary;
    if (sal <= budget) {
      bound += scores[i];
      budget -= sal;
      remaining -= 1;
      integralCount += 1;
    } else {
      // Fractional item — the LP can take a fraction; the integer can't.
      fractional = budget / sal;
      bound += scores[i] * fractional;
      remaining -= 1;
      budget = 0;
      break;
    }
  }

  const feasible = integralCount + (fractional > 0 ? 1 : 0) >= rosterSize;
  return { bound, integralCount, fractional, iterations, feasible };
}
