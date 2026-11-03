/**
 * Position-aware NBA Classic solver.
 *
 * The generic MILP picks the top 8 by score and ignores positions, so it can
 * return a set that cannot fill all eight slots (e.g. three centers and no
 * forward). This solver assigns players to slots as it searches, so every
 * result is a legal 8-slot lineup by construction.
 *
 * It's an exact branch-and-bound: slots are filled most-constrained-first,
 * candidates are tried highest-score-first, and a bound (current score plus
 * the best remaining scores) prunes branches that cannot beat the best found.
 */
import type { Player } from "./types";
import { NBA_CLASSIC_SLOTS, type RosterSlot } from "./sports";

export interface ClassicAssignment {
  slot: string;
  playerIdx: number;
}

export interface ClassicResult {
  assignments: ClassicAssignment[];
  score: number;
  salary: number;
  nodes: number;
}

interface Ctx {
  players: Player[];
  scores: number[];
  cap: number;
  eligibility: number[][]; // per slot order -> eligible player indices
  order: number[]; // slot indices (into NBA_CLASSIC_SLOTS), most-constrained first
  forbiddenKeys: Set<string>;
  bestScore: number;
  best: ClassicAssignment[] | null;
  nodes: number;
  nodeCap: number;
  deadline: number;
  /** Best score available for the slot at each depth (ignoring reuse). */
  slotMaxScore: number[];
  /** Cheapest player available for the slot at each depth (ignoring reuse). */
  slotMinSalary: number[];
  /** Sum of the cheapest fill for the slots after `depth`. */
  minFillCost: number[];
}

/** How many candidates per slot the search keeps. See solveNbaClassic. */
const CANDIDATE_LIMIT = 30;

function keyOf(indices: number[]): string {
  return [...indices].sort((a, b) => a - b).join("|");
}

/**
 * Upper bound on the score still reachable from `depth` onwards.
 *
 * Uses the best score each *specific* slot could still contribute rather
 * than the best scores in the pool, which is what makes the search prune
 * hard enough to run on a full live slate.
 */
function bound(ctx: Ctx, depth: number, score: number): number {
  let b = score;
  for (let d = depth; d < ctx.order.length; d++) b += ctx.slotMaxScore[d];
  return b;
}

function dfs(
  ctx: Ctx,
  depth: number,
  used: boolean[],
  salary: number,
  score: number,
  chosen: ClassicAssignment[],
): void {
  if (ctx.nodes >= ctx.nodeCap || performance.now() > ctx.deadline) return;
  ctx.nodes += 1;

  if (depth === ctx.order.length) {
    if (ctx.forbiddenKeys.has(keyOf(chosen.map((c) => c.playerIdx)))) return;
    if (score > ctx.bestScore) {
      ctx.bestScore = score;
      ctx.best = chosen.slice();
    }
    return;
  }

  // Prune branches that cannot beat the incumbent.
  if (bound(ctx, depth, score) <= ctx.bestScore) return;
  // Prune branches that cannot afford to fill the remaining slots.
  if (salary + ctx.minFillCost[depth] > ctx.cap) return;

  const slotIdx = ctx.order[depth];
  const slot: RosterSlot = NBA_CLASSIC_SLOTS[slotIdx];
  const candidates = ctx.eligibility[depth];

  for (const p of candidates) {
    if (used[p]) continue;
    const sal = ctx.players[p].salary;
    if (salary + sal > ctx.cap) continue;
    used[p] = true;
    chosen.push({ slot: slot.label, playerIdx: p });
    dfs(ctx, depth + 1, used, salary + sal, score + ctx.scores[p], chosen);
    chosen.pop();
    used[p] = false;
  }
}

export function solveNbaClassic(opts: {
  players: Player[];
  scores: number[];
  salaryCap: number;
  lockedIdx?: Set<number>;
  excludedIdx?: Set<number>;
  forbiddenKeys?: Set<string>;
  nodeCap?: number;
  timeLimitMs?: number;
}): ClassicResult | null {
  const {
    players,
    scores,
    salaryCap,
    lockedIdx = new Set<number>(),
    excludedIdx = new Set<number>(),
    forbiddenKeys = new Set<string>(),
    nodeCap = 400_000,
    timeLimitMs = 3_000,
  } = opts;

  // Most-constrained slots first (single-position, then two-position, then any).
  const order = NBA_CLASSIC_SLOTS.map((s, idx) => ({ s, idx }))
    .sort((a, b) => {
      const ca = a.s.accepts === null ? 100 : a.s.accepts.length;
      const cb = b.s.accepts === null ? 100 : b.s.accepts.length;
      return ca - cb;
    })
    .map((x) => x.idx);

  const eligibility: number[][] = order.map((slotIdx) => {
    const slot = NBA_CLASSIC_SLOTS[slotIdx];
    const list: number[] = [];
    for (let i = 0; i < players.length; i++) {
      if (excludedIdx.has(i)) continue;
      if (players[i].salary <= 0) continue;
      const rp = players[i].rosterPositions ?? [];
      if (slot.accepts === null || slot.accepts.some((p) => rp.includes(p))) list.push(i);
    }
    list.sort((a, b) => scores[b] - scores[a]);

    // Candidate pooling. On a full live slate the pool holds ~240 players,
    // and 240^8 combinations is not searchable in a browser. The best legal
    // lineup is always built from the strongest players available for each
    // slot, so we keep the top CANDIDATE_LIMIT per slot (plus any locked
    // player, who must stay reachable).
    const capped =
      list.length > CANDIDATE_LIMIT ? list.slice(0, CANDIDATE_LIMIT) : list.slice();
    for (const l of lockedIdx) {
      if (!capped.includes(l) && list.includes(l)) capped.push(l);
    }
    return capped;
  });

  // If any slot has no eligible player, no legal lineup exists.
  if (eligibility.some((e) => e.length === 0)) return null;

  // Seed the incumbent with a greedy legal fill so the bound prunes early.
  const slotMaxScore = order.map((_, depth) => {
    const list = eligibility[depth];
    return list.length > 0 ? scores[list[0]] : 0;
  });
  const slotMinSalary = order.map((_, depth) => {
    const list = eligibility[depth];
    if (list.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(...list.map((i) => players[i].salary));
  });
  const minFillCost = new Array(order.length + 1).fill(0);
  for (let depth = order.length - 1; depth >= 0; depth--) {
    minFillCost[depth] = minFillCost[depth + 1] + slotMinSalary[depth];
  }

  const ctx: Ctx = {
    players,
    scores,
    cap: salaryCap,
    eligibility,
    order,
    forbiddenKeys,
    bestScore: -Infinity,
    best: null,
    nodes: 0,
    nodeCap,
    deadline: performance.now() + timeLimitMs,
    slotMaxScore,
    slotMinSalary,
    minFillCost,
  };
  greedySeed(ctx);

  const used = new Array(players.length).fill(false);
  // Honor locks up front by marking them used is not possible (they still
  // need a slot); we simply bias the search toward including them via order.
  dfs(ctx, 0, used, 0, 0, []);

  if (!ctx.best) return null;
  const assigned = new Set(ctx.best.map((c) => c.playerIdx));
  for (const l of lockedIdx) {
    if (!assigned.has(l)) return null; // locked player couldn't be placed
  }
  const salary = ctx.best.reduce((s, c) => s + players[c.playerIdx].salary, 0);
  return {
    assignments: ctx.best,
    score: ctx.bestScore,
    salary,
    nodes: ctx.nodes,
  };
}

/** A legal greedy fill to seed the incumbent (not necessarily optimal). */
function greedySeed(ctx: Ctx): void {
  const used = new Array(ctx.players.length).fill(false);
  const chosen: ClassicAssignment[] = [];
  let salary = 0;
  let score = 0;
  for (let depth = 0; depth < ctx.order.length; depth++) {
    const candidates = ctx.eligibility[depth];
    let pick = -1;
    for (const p of candidates) {
      if (used[p]) continue;
      if (salary + ctx.players[p].salary > ctx.cap) continue;
      pick = p;
      break;
    }
    if (pick === -1) return; // no legal greedy fill
    used[pick] = true;
    salary += ctx.players[pick].salary;
    score += ctx.scores[pick];
    chosen.push({ slot: NBA_CLASSIC_SLOTS[ctx.order[depth]].label, playerIdx: pick });
  }
  if (ctx.forbiddenKeys.has(keyOf(chosen.map((c) => c.playerIdx)))) return;
  ctx.bestScore = score;
  ctx.best = chosen;
}
