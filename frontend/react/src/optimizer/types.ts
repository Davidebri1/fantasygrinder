/**
 * In-browser DFS optimizer.
 *
 * This is a TypeScript port of the Python optimizer engine that previously
 * lived in `backend/django/optimizer/`. The customer runs this entirely in
 * the browser — no Python, no server, no terminal. Open `index.html`.
 *
 * Architecture
 * ------------
 *  - `players.ts`     — sport-agnostic Player record.
 *  - `simulate.ts`    — Box-Muller + Cholesky for correlated Monte Carlo.
 *  - `milp.ts`        — branch-and-bound MILP solver (pure JS).
 *  - `sports/`        — sport-specific constraint builders.
 *  - `strategies.ts`  — 5 strategies (maxProjection, monteCarlo, …).
 *  - `index.ts`       — `runOptimize()` public API.
 *
 * Performance targets match the Python reference: NBA Classic (~150
 * players, 8 slots) under 50 ms per lineup. We use a tight branch-and-bound
 * with LP-relaxation upper bound; for the <200 player pools the
 * customer's daily workflow touches, this finishes in single-digit ms.
 */

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────
export type Sport = "nba" | "mma" | "golf";
export type ContestType = "classic" | "showdown";
export type SolverBackend = "pulp" | "ortools" | "browser";
export type Strategy =
  | "monteCarlo"
  | "maxProjection"
  | "contrarian"
  | "balanced"
  | "salaryCap";

export interface Player {
  id: string;
  name: string;
  sport: Sport;
  salary: number;
  projection: number;
  userProjection?: number | null;
  team?: string;
  opponent?: string;
  gameInfo?: string;
  positions?: string[];
  rosterPositions?: string[];
  correlationGroup?: string;
  opponentId?: string;
  bout?: string;
  projectedOwnership?: number;
  isLocked?: boolean;
  isExcluded?: boolean;
  isLiked?: boolean;
  injuryStatus?: string | null;
  stddev?: number | null;
  /** Direct headshot URL — when set, no lookup is needed. */
  photoUrl?: string | null;
}

export interface OptimizerSettings {
  sport: Sport;
  strategy: Strategy;
  salaryCap: number;
  numLineups: number;
  maxExposure?: number;
  minProjection?: number;
  simulationCount: number;
  contestType?: ContestType;
  seed?: number;
  /**
   * When true (default), generate N *distinct* lineups — the N best
   * different player combinations, for multi-entry portfolio construction.
   * When false, solve once and return the single optimal lineup N times.
   */
  uniqueLineups?: boolean;
  /**
   * Solver view. "branchBound" (default) is the integer search.
   * "simplex" computes the LP-relaxation bound explicitly and reports it.
   * Both return the same integer lineups for the same inputs.
   */
  solver?: "branchBound" | "simplex";
  // Sport-specific knobs
  teammateCorrelation?: number;
  opponentCorrelation?: number;
  cardCorrelation?: number;
  allowOpponents?: boolean;
  globalMaxPlayersPerTeam?: number;
  enableBringBack?: boolean;
}

export interface SlotAssignment {
  slot: string;
  scoreMultiplier: number;
  playerId: string;
  playerName: string;
}

export interface Lineup {
  assignments: SlotAssignment[];
  strategy: Strategy;
  solverBackend: SolverBackend;
  rank: number;
  totalSalary: number;
  totalProjection: number;
  totalCeiling: number;
  teams: string[];
  games: string[];
  uniqueKey: string;
}

export interface OptimizeResult {
  lineups: Lineup[];
  strategy: Strategy;
  solverBackend: SolverBackend;
  elapsedMs: number;
  warnings: string[];
  /** Observable run counts — so de-dup is never a silent black box. */
  telemetry?: OptimizeTelemetry;
}

export interface OptimizeTelemetry {
  /** Lineups the caller asked for. */
  requested: number;
  /** Solver invocations performed. */
  solves: number;
  /** Distinct lineups collected. */
  uniqueFound: number;
  /** Solves that returned an already-seen lineup (dropped). */
  duplicatesDropped: number;
  /** Solves that returned infeasible / no lineup. */
  infeasibleSolves: number;
  /** requested − uniqueFound (0 when fully satisfied). */
  shortBy: number;
  /** Which solver view produced this run. */
  solver?: "branchBound" | "simplex";
  /** LP-relaxation upper bound on any feasible lineup (the "simplex" value). */
  lpBound?: number;
}
