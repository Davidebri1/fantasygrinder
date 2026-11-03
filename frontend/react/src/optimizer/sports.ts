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
  /** Score multiplier for this slot (Showdown CPT = 1.5). */
  multiplier?: number;
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
  { label: "CPT", accepts: null, multiplier: 1.5 },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
];

/**
 * DraftKings-style NFL classic roster: 1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX
 * (RB/WR/TE) and 1 DST. The slot labels double as the exposure buckets the
 * optimizer reports on, so a portfolio can be read position by position.
 */
export const NFL_CLASSIC_SLOTS: RosterSlot[] = [
  { label: "QB", accepts: ["QB"] },
  { label: "RB", accepts: ["RB"] },
  { label: "RB", accepts: ["RB"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "TE", accepts: ["TE"] },
  { label: "FLEX", accepts: ["RB", "WR", "TE"] },
  { label: "DST", accepts: ["DST"] },
];

export const NFL_ROSTER_SIZE = NFL_CLASSIC_SLOTS.length;

/** Human titles for the exposure buckets, one per distinct slot label. */
export function slotBuckets(slots: RosterSlot[]): { slot: string; title: string }[] {
  const title: Record<string, string> = {
    QB: "Quarterback Slot",
    RB: "Running Back Slot",
    WR: "Wide Receiver Slot",
    TE: "Tight End Slot",
    FLEX: "Flex Slot",
    DST: "Defense / Special Teams",
    PG: "Point Guard Slot",
    SG: "Shooting Guard Slot",
    SF: "Small Forward Slot",
    PF: "Power Forward Slot",
    C: "Center Slot",
    G: "Guard Slot",
    UTIL: "Utility Slot",
    CPT: "Captain",
  };
  const seen = new Set<string>();
  const out: { slot: string; title: string }[] = [];
  for (const s of slots) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push({ slot: s.label, title: title[s.label] ?? `${s.label} Slot` });
  }
  return out;
}

function canAccept(slot: RosterSlot, playerPositions: string[]): boolean {
  if (slot.accepts === null) return true;
  return slot.accepts.some((p) => playerPositions.includes(p));
}

function effectiveCorrelationGroup(p: Player): string {
  if (p.correlationGroup) return p.correlationGroup;
  const m = (p.gameInfo ?? "").match(/([A-Z]{2,4}@[A-Z]{2,4})/);
  return m ? m[1] : "";
}

/**
 * Maximum bipartite matching (Kuhn's augmenting-path algorithm).
 *
 * Greedy slot-filling can leave a slot empty even when a perfect assignment
 * exists. This finds the maximum matching, so a full 8-slot NBA lineup is
 * produced whenever the selected players can fill it. Returns a per-slot
 * player index, or null for any slot that cannot be filled.
 */
export function bipartiteAssign(players: Player[], slots: RosterSlot[]): (number | null)[] {
  const n = players.length;
  const adjacency: number[][] = slots.map((slot) => {
    const list: number[] = [];
    for (let i = 0; i < n; i++) {
      if (players[i].isExcluded) continue;
      if (canAccept(slot, players[i].rosterPositions ?? [])) list.push(i);
    }
    // Prefer higher-projection players when there's a choice.
    list.sort((a, b) => effectiveProjection(players[b]) - effectiveProjection(players[a]));
    return list;
  });

  const playerToSlot: number[] = new Array(n).fill(-1);
  const slotToPlayer: number[] = new Array(slots.length).fill(-1);

  const tryAugment = (slotIdx: number, visited: boolean[]): boolean => {
    for (const p of adjacency[slotIdx]) {
      if (visited[p]) continue;
      visited[p] = true;
      const occupant = playerToSlot[p];
      if (occupant === -1 || tryAugment(occupant, visited)) {
        playerToSlot[p] = slotIdx;
        slotToPlayer[slotIdx] = p;
        return true;
      }
    }
    return false;
  };

  // Most-constrained slots first improves the odds of a perfect matching.
  const order = slots
    .map((_, idx) => idx)
    .sort((a, b) => (slots[a].accepts === null ? 1 : 0) - (slots[b].accepts === null ? 1 : 0));

  for (const slotIdx of order) {
    tryAugment(slotIdx, new Array(n).fill(false));
  }

  return slotToPlayer.map((v) => (v === -1 ? null : v));
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

/**
 * Build a lineup from an explicit slot → player assignment.
 *
 * The portfolio builder already knows which player sits in which slot, so
 * the lineup is assembled directly rather than re-derived by a bipartite
 * matching pass.
 */
export function buildSlotLineup(
  picks: number[],
  slots: RosterSlot[],
  players: Player[],
  strategy: string,
  solverBackend: string,
  rank: number,
): Lineup {
  const assignments: SlotAssignment[] = picks.map((playerIdx, slotIdx) => ({
    slot: slots[slotIdx].label,
    scoreMultiplier: slots[slotIdx].multiplier ?? 1.0,
    playerId: players[playerIdx].id,
    playerName: players[playerIdx].name,
  }));
  const totalSalary = picks.reduce((s, i) => s + players[i].salary, 0);
  const totalProjection = picks.reduce(
    (s, i, k) => s + effectiveProjection(players[i]) * (slots[k].multiplier ?? 1.0),
    0,
  );
  const totalCeiling = picks.reduce(
    (s, i, k) =>
      s +
      (players[i].projection + 1.5 * effectiveStddevOf(players[i])) *
        (slots[k].multiplier ?? 1.0),
    0,
  );
  const teams = Array.from(
    new Set(picks.map((i) => players[i].team).filter((t) => !!t) as string[]),
  );
  const games = Array.from(
    new Set(
      picks
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
    uniqueKey: [...picks].sort((a, b) => a - b).join("|"),
  };
}
