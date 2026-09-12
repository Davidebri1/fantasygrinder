/**
 * 5 strategies, ported from the Python `optimizer/strategies.py`.
 *
 * Each strategy returns a list of per-player score vectors. The MILP
 * solver runs once per score vector and the unique lineups are kept.
 */

import type { OptimizerSettings, Player, Strategy } from "./types";
import { effectiveProjection } from "./simulate";

export interface StrategyResult {
  scores: number[];
  iteration: number;
  description: string;
}

function scoreMaxProjection(players: Player[]): number[] {
  return players.map((p) => effectiveProjection(p));
}

function scoreBalanced(players: Player[]): number[] {
  return players.map((p) => (p.salary > 0 ? effectiveProjection(p) / (p.salary / 1000) : 0));
}

function scoreSalaryCap(players: Player[], weightSalary = 0.7): number[] {
  const wS = weightSalary;
  const wP = 1 - weightSalary;
  return players.map((p) => wS * (p.salary / 1000) + wP * effectiveProjection(p));
}

function scoreContrarian(row: number[], players: Player[]): number[] {
  return players.map((_p, i) => {
    const ownership = Math.max(players[i].projectedOwnership ?? 10, 0.1) / 100;
    return row[i] / Math.sqrt(ownership);
  });
}

function perturb(scores: number[], amount: number, seed: number): number[] {
  let s = seed >>> 0;
  function rand(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return scores.map((v) => v * (1 + (rand() * 2 - 1) * amount));
}

export function buildStrategyPlan(
  strategy: Strategy,
  players: Player[],
  settings: OptimizerSettings,
  simulatedRows: number[][] | null,
): StrategyResult[] {
  if (strategy === "monteCarlo" || strategy === "contrarian") {
    if (!simulatedRows || simulatedRows.length === 0) return [];
    const n = Math.min(settings.simulationCount, simulatedRows.length);
    const out: StrategyResult[] = [];
    for (let i = 0; i < n; i++) {
      const row = simulatedRows[i];
      out.push({
        scores: strategy === "contrarian" ? scoreContrarian(row, players) : row,
        iteration: i,
        description: strategy === "contrarian" ? "contrarian" : "monteCarlo",
      });
    }
    return out;
  }
  // Deterministic objectives: the score model is fixed, so the answer is a
  // fact. To produce N lineups we return the same objective N times and let
  // the caller forbid each found lineup before re-solving — that yields the
  // N best *distinct* lineups, in order, with no randomness. Re-running gives
  // an identical result.
  if (strategy === "maxProjection") {
    const base = scoreMaxProjection(players);
    const count = Math.max(1, settings.numLineups * 3);
    return Array.from({ length: count }, (_, i) => ({
      scores: base,
      iteration: i,
      description: "max_projection",
    }));
  }
  if (strategy === "balanced") {
    const base = scoreBalanced(players);
    const count = Math.max(1, settings.numLineups * 3);
    return Array.from({ length: count }, (_, i) => ({
      scores: base,
      iteration: i,
      description: "balanced",
    }));
  }
  if (strategy === "salaryCap") {
    const base = scoreSalaryCap(players);
    const count = Math.max(1, settings.numLineups * 3);
    return Array.from({ length: count }, (_, i) => ({
      scores: base,
      iteration: i,
      description: "salary_cap",
    }));
  }
  return [];
}

function hashSeed(base: number, iter: number): number {
  // FNV-1a-ish.
  let h = 2166136261;
  h = (h ^ (base & 0xff)) * 16777619;
  h = (h ^ ((base >>> 8) & 0xff)) * 16777619;
  h = (h ^ (iter & 0xff)) * 16777619;
  return h >>> 0;
}
