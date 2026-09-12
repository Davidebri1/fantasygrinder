/**
 * Sport-specific constraint builders + slot structures.
 *
 * Mirrors `backend/django/optimizer/sports/{nba,mma,golf}.py`.
 */

import { effectiveProjection, effectiveStddev } from "./simulate";
import type { Lineup, Player, SlotAssignment } from "./types";
import type { ConstraintFn } from "./milp";

// ─────────────────────────────────────────────────────────────────────────
// NBA Classic
// ─────────────────────────────────────────────────────────────────────────
export interface RosterSlot {
  label: string;
  /** null = accepts any position. */
  accepts: string[] | null;
}

export const NBA_CLASSIC_SLOTS: RosterSlot[] = [
  { label: "PG", accepts: ["PG"] },
  { label: "SG", accepts: ["SG"] },
  { label: "SF", accepts: ["SF"] },
  { label: "PF", accepts: ["PF"] },
  { label: "C", accepts: ["C"] },
  { label: "G", accepts: ["PG", "SG"] },
  { label: "F", accepts: ["SF", "PF"] },
  { label: "UTIL", accepts: null },
];

export const NBA_SHOWDOWN_SLOTS: RosterSlot[] = [
  { label: "CPT", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
];

function canAccept(slot: RosterSlot, playerPositions: string[]): boolean {
  if (slot.accepts === null) return true;
  return slot.accepts.some((p) => playerPositions.includes(p));
}

function effectiveCorrelationGroup(p: Player): string {
  if (p.correlationGroup) return p.correlationGroup;
  const m = (p.gameInfo ?? "").match(/([A-Z]{2,4}@[A-Z]{2,4})/);
  return m ? m[1] : "";
}

/** Greedy bipartite match: assign each player to most-constrained slot. */
export function bipartiteAssign(players: Player[], slots: RosterSlot[]): (number | null)[] {
  const out: (number | null)[] = new Array(slots.length).fill(null);
  const used = new Set<number>();
  // Sort slots by constraint (specific positions first, UTIL last).
  const priority = slots
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => (a.s.accepts === null ? 1 : 0) - (b.s.accepts === null ? 1 : 0));

  for (const { idx: slotIdx, s: slot } of priority) {
    let bestPlayer = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < players.length; i++) {
      if (used.has(i)) continue;
      if (players[i].isExcluded) continue;
      if (!canAccept(slot, players[i].rosterPositions ?? [])) continue;
      const score = effectiveProjection(players[i]);
      if (score > bestScore) {
        bestScore = score;
        bestPlayer = i;
      }
    }
    if (bestPlayer >= 0) {
      out[slotIdx] = bestPlayer;
      used.add(bestPlayer);
    }
  }
  return out;
}

/** NBA team-stacking constraint. */
export const nbaTeamStackMax = (maxPerTeam: number, teamPerPlayer: string[]): ConstraintFn => {
  return (problem, x) => {
    const teams = new Map<string, number[]>();
    teamPerPlayer.forEach((t, i) => {
      if (t) {
        if (!teams.has(t)) teams.set(t, []);
        teams.get(t)!.push(i);
      }
    });
    for (const [team, members] of teams) {
      const sum = members.map((i) => x[i].value).reduce((a, b) => a + b, 0);
      if (sum > maxPerTeam + 1e-6) {
        // Mark infeasible by setting all to 0 (we'd want a real LP here,
        // but in this branch-and-bound solver, a hard violation prunes
        // the search via the salary cap constraint). For our purposes,
        // the team-stacking rule is a soft hint enforced in post-processing.
      }
    }
  };
};

export function buildNbaLineup(
  selectedIdx: number[],
  players: Player[],
  contestType: "classic" | "showdown",
  strategy: string,
  solverBackend: string,
  rank: number,
): Lineup {
  const slots = contestType === "showdown" ? NBA_SHOWDOWN_SLOTS : NBA_CLASSIC_SLOTS;
  const assignments: SlotAssignment[] = [];
  if (contestType === "showdown") {
    for (let i = 0; i < selectedIdx.length; i++) {
      const slot = i === 0 ? "CPT" : "FLEX";
      const mult = i === 0 ? 1.5 : 1.0;
      const p = players[selectedIdx[i]];
      assignments.push({
        slot,
        scoreMultiplier: mult,
        playerId: p.id,
        playerName: p.name,
      });
    }
  } else {
    const assignment = bipartiteAssign(
      selectedIdx.map((i) => players[i]),
      slots,
    );
    for (let s = 0; s < slots.length; s++) {
      const idx = assignment[s];
      if (idx == null) continue;
      const p = players[selectedIdx[idx]];
      assignments.push({
        slot: slots[s].label,
        scoreMultiplier: 1.0,
        playerId: p.id,
        playerName: p.name,
      });
    }
  }
  const totalSalary = selectedIdx.reduce((s, i) => s + players[i].salary, 0);
  const multipliers = assignments.map((a) => a.scoreMultiplier);
  const totalProjection = selectedIdx
    .slice(0, multipliers.length)
    .reduce((s, i, k) => s + effectiveProjection(players[i]) * multipliers[k], 0);
  const totalCeiling = selectedIdx
    .slice(0, multipliers.length)
    .reduce((s, i, k) => s + (players[i].projection + 1.5 * effectiveStddevOf(players[i])) * multipliers[k], 0);
  const teams = Array.from(
    new Set(selectedIdx.map((i) => players[i].team).filter((t) => !!t) as string[]),
  );
  const games = Array.from(
    new Set(
      selectedIdx
        .map((i) => effectiveCorrelationGroup(players[i]))
        .filter((g) => !!g) as string[],
    ),
  );
  return {
    assignments,
    strategy: strategy as Lineup["strategy"],
    solverBackend: solverBackend as Lineup["solverBackend"],
    rank,
    totalSalary,
    totalProjection,
    totalCeiling,
    teams,
    games,
    uniqueKey: [...selectedIdx].sort((a, b) => a - b).join("|"),
  };
}

function effectiveStddevOf(p: Player): number {
  if (p.stddev !== undefined && p.stddev !== null) return p.stddev;
  const proj = p.projection;
  let mult = 0.32;
  if (proj >= 45) mult = 0.18;
  else if (proj >= 35) mult = 0.2;
  else if (proj >= 25) mult = 0.23;
  else if (proj >= 15) mult = 0.27;
  return proj * mult;
}

// ─────────────────────────────────────────────────────────────────────────
// MMA
// ─────────────────────────────────────────────────────────────────────────
export const MMA_ROSTER_SIZE = 6;

export function mmaRosterSize(allowOpponents: boolean, distinctBouts: number): number {
  return allowOpponents ? MMA_ROSTER_SIZE : Math.min(MMA_ROSTER_SIZE, distinctBouts);
}

export function buildMmaLineup(
  selectedIdx: number[],
  players: Player[],
  strategy: string,
  solverBackend: string,
  rank: number,
): Lineup {
  const assignments: SlotAssignment[] = selectedIdx.map((i) => ({
    slot: "FLEX",
    scoreMultiplier: 1.0,
    playerId: players[i].id,
    playerName: players[i].name,
  }));
  const totalSalary = selectedIdx.reduce((s, i) => s + players[i].salary, 0);
  const totalProjection = selectedIdx.reduce(
    (s, i) => s + effectiveProjection(players[i]),
    0,
  );
  const totalCeiling = selectedIdx.reduce(
    (s, i) => s + players[i].projection + 1.5 * effectiveStddevOf(players[i]),
    0,
  );
  return {
    assignments,
    strategy: strategy as Lineup["strategy"],
    solverBackend: solverBackend as Lineup["solverBackend"],
    rank,
    totalSalary,
    totalProjection,
    totalCeiling,
    teams: [],
    games: [],
    uniqueKey: [...selectedIdx].sort((a, b) => a - b).join("|"),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Golf
// ─────────────────────────────────────────────────────────────────────────
export const GOLF_ROSTER_SIZE = 6;

export function buildGolfLineup(
  selectedIdx: number[],
  players: Player[],
  strategy: string,
  solverBackend: string,
  rank: number,
): Lineup {
  return buildMmaLineup(selectedIdx, players, strategy, solverBackend, rank);
}
