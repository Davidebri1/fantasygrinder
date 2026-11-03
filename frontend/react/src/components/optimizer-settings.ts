/**
 * Optimizer settings — the shared shape every sport screen edits.
 *
 * These are UI-level settings (what the user can change) as distinct from
 * the engine-level `OptimizerSettings` in `@/optimizer/types`, which is what
 * the solver actually consumes. The screen maps one to the other.
 */
import type { Strategy } from "@/types";
import type { StackRule } from "@/optimizer/types";

export type Sport = "nba" | "nfl" | "mma" | "golf";

/** A stack rule as the screen holds it: the engine's rule plus a name to show. */
export interface StackRuleUi extends StackRule {
  /** How the rule is written in the UI, e.g. "BOS" or "BOS@NE". */
  label: string;
}

export interface OptimizerUiSettings {
  strategy: Strategy;
  salary_cap: number;
  num_lineups: number;
  min_projection: number;
  simulation_count: number;
  unique_lineups: boolean;
  solver: "branchBound" | "simplex";
  contest_type: "classic" | "showdown";
  teammate_correlation: number;
  opponent_correlation: number;
  enable_bring_back: boolean;
  allow_opponents: boolean;
  card_correlation: number;
  /** Hard ceiling on the share of the portfolio any single player may hold. */
  max_exposure: number;
  /** Stacking rules the optimizer must satisfy. */
  stack_rules: StackRuleUi[];
}

/**
 * Defaults chosen to produce a portfolio you can actually enter: 150
 * lineups is the largest count a contest site takes, and a 50% exposure
 * cap keeps the portfolio spread across the slate instead of repeating the
 * same handful of stars. Both are editable in the customize panel.
 */
export function defaultUiSettings(sport: Sport): OptimizerUiSettings {
  return {
    strategy: "maxProjection",
    salary_cap: 50_000,
    num_lineups: 150,
    min_projection: 0,
    simulation_count: 1_000,
    unique_lineups: true,
    solver: "branchBound",
    contest_type: "classic",
    teammate_correlation: 0.35,
    opponent_correlation: sport === "mma" ? -0.4 : 0.2,
    enable_bring_back: false,
    allow_opponents: false,
    card_correlation: 0.1,
    max_exposure: 50,
    stack_rules: [],
  };
}
