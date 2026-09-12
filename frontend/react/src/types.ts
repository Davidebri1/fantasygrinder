/**
 * Shared TypeScript types for the Fantasy Grinder web app.
 *
 * These mirror the wire shapes in `docs/openapi.yaml`. We deliberately
 * keep them in lockstep with the Django serializers; if a serializer
 * changes, this file changes too.
 */

export type Sport = "nba" | "mma" | "golf";
export type ContestType = "classic" | "showdown";
export type SolverBackend = "pulp" | "ortools";

export type Strategy =
  | "monteCarlo"
  | "maxProjection"
  | "contrarian"
  | "balanced"
  | "salaryCap";

/**
 * The optimizer is ONE solver (MILP / simplex). The 5 "strategies" are
 * really 3 objective functions (deterministic facts) + 2 simulation
 * modes (probabilistic samples). We group them explicitly so the UI
 * doesn't present guesses and facts as equals.
 */
export type ObjectiveFunction = "maxProjection" | "balanced" | "salaryCap";
export type SimulationMode = "off" | "monteCarlo" | "contrarian";

export const OBJECTIVES: {
  value: ObjectiveFunction;
  label: string;
  description: string;
}[] = [
  {
    value: "maxProjection",
    label: "Max Projection",
    description: "Highest total projected points. Best for cash games and single-entry. Deterministic — this IS the best lineup by projection.",
  },
  {
    value: "balanced",
    label: "Balanced (Value)",
    description: "Maximize projection per dollar of salary. Efficient builds that don't overpay for stars. Deterministic.",
  },
  {
    value: "salaryCap",
    label: "Salary Cap",
    description: "Weight salary spend heavily (70/30 salary-to-projection). For stars-and-scrubs builds that use most of the cap. Deterministic.",
  },
];

export const SIMULATION_MODES: {
  value: SimulationMode;
  label: string;
  description: string;
}[] = [
  {
    value: "off",
    label: "Off (deterministic)",
    description: "Use raw projections. Fastest. Produces provably-optimal lineups.",
  },
  {
    value: "monteCarlo",
    label: "Monte Carlo",
    description: "Sample 1k–10k correlated outcomes, optimize each, keep the best unique lineups. For GPP / multi-entry where you want variance-aware builds.",
  },
  {
    value: "contrarian",
    label: "Contrarian (leverage)",
    description: "Like Monte Carlo, but scores are divided by √ownership — low-owned ceiling plays gain leverage over chalk. Tournament-only.",
  },
];

/**
 * Kept for backwards compat with the optimizer engine's `Strategy` param.
 * Maps (objective, simulationMode) → engine strategy name.
 */
export function strategyFromParts(
  objective: ObjectiveFunction,
  simulationMode: SimulationMode,
): Strategy {
  if (simulationMode === "monteCarlo") return "monteCarlo";
  if (simulationMode === "contrarian") return "contrarian";
  return objective;
}

export interface Player {
  id: string;
  name: string;
  sport: Sport;
  salary: number;
  projection: number;
  user_projection?: number | null;
  team?: string;
  opponent?: string;
  game_info?: string;
  game_time?: string | null;
  positions?: string[];
  roster_positions?: string[];
  correlation_group?: string;
  opponent_id?: string;
  bout?: string;
  tee_time?: string | null;
  projected_ownership?: number;
  max_ownership?: number;
  min_exposure?: number;
  max_exposure?: number;
  stddev?: number | null;
  is_locked?: boolean;
  is_excluded?: boolean;
  is_liked?: boolean;
  injury_status?: string | null;
  injury_severity?: string | null;
}

export interface Slate {
  id: string;
  sport: Sport;
  slate_date: string;
  slate_time: string;
  name: string;
  file_name: string;
  is_active: boolean;
  created_at: string;
}

export interface SlateDetail extends Slate {
  players: Player[];
}

export interface NbaSettings {
  salary_cap: number;
  num_lineups: number;
  contest_type: ContestType;
  strategy: Strategy;
  max_exposure: number;
  max_attempts: number;
  enable_bring_back: boolean;
  bring_back_count: number;
  global_min_players_per_team: number;
  global_max_players_per_team: number;
  team_stacking_rules: { team: string; min_players: number; max_players: number }[];
  excluded_teams: string[];
  respect_game_times: boolean;
  min_projection: number;
  simulation_count: number;
  teammate_correlation: number;
  opponent_correlation: number;
}

export interface MmaSettings {
  salary_cap: number;
  num_lineups: number;
  strategy: Strategy;
  roster_size: number;
  allow_opponents: boolean;
  max_exposure: number;
  min_projection: number;
  simulation_count: number;
  opponent_correlation: number;
  card_correlation: number;
}

export interface GolfSettings {
  salary_cap: number;
  num_lineups: number;
  strategy: Strategy;
  roster_size: number;
  max_exposure: number;
  min_projection: number;
  simulation_count: number;
}

export interface SlotAssignment {
  slot: string;
  score_multiplier: number;
  player_id: string;
  player_name: string;
}

export interface Lineup {
  assignments: SlotAssignment[];
  strategy: Strategy;
  solver_backend: SolverBackend;
  rank: number;
  total_salary: number;
  total_projection: number;
  total_ceiling: number;
  teams: string[];
  games: string[];
  unique_key: string;
}

export interface RunMetadata {
  strategy: Strategy;
  solver_backend: SolverBackend;
  result_count: number;
  top_score: number;
  elapsed_ms: number;
  warnings: string[];
}

export interface OptimizeResponse {
  lineups: Lineup[];
  run_metadata: RunMetadata;
}

export const DEFAULT_NBA_SETTINGS: NbaSettings = {
  salary_cap: 50_000,
  num_lineups: 20,
  contest_type: "classic",
  // Default to maxProjection. Monte Carlo is still selectable for
  // tournament play, but for first-time use it's slow and confusing.
  // The Smart Recommendations panel picks the right strategy per contest.
  strategy: "maxProjection",
  max_exposure: 100,
  max_attempts: 5_000,
  enable_bring_back: false,
  bring_back_count: 1,
  global_min_players_per_team: 0,
  global_max_players_per_team: 0,
  team_stacking_rules: [],
  excluded_teams: [],
  respect_game_times: true,
  min_projection: 0,
  // Default to a fast strategy. The Smart Recommendations panel picks
  // the right strategy per contest type. Monte Carlo is still available
  // (selectable in the Strategy dropdown) but no longer the default.
  simulation_count: 1_000,
  teammate_correlation: 0.35,
  opponent_correlation: 0.2,
};

export const DEFAULT_MMA_SETTINGS: MmaSettings = {
  salary_cap: 50_000,
  num_lineups: 20,
  strategy: "maxProjection",
  roster_size: 6,
  allow_opponents: false,
  max_exposure: 100,
  min_projection: 0,
  simulation_count: 1_000,
  opponent_correlation: -0.4,
  card_correlation: 0.1,
};

export const DEFAULT_GOLF_SETTINGS: GolfSettings = {
  salary_cap: 50_000,
  num_lineups: 20,
  strategy: "maxProjection",
  roster_size: 6,
  max_exposure: 100,
  min_projection: 0,
  simulation_count: 10_000,
};
