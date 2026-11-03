/**
 * Portfolio builder — produces N distinct, legal, well-ranked lineups.
 *
 * The old path solved for ONE optimal lineup, then re-solved with that
 * lineup forbidden, inside an 8-second budget. On a live slate that budget
 * expired after a handful of solves, so asking for 150 lineups returned 5.
 * This module replaces that loop with a proper portfolio search:
 *
 *   1. An exact branch-and-bound finds the true best legal lineup.
 *   2. A best-first expansion walks the swap neighbourhood of the best
 *      lineups found so far, always expanding the highest-scoring one
 *      first. Because the queue is a max-heap on score, lineups come out
 *      in descending order of quality.
 *   3. If the pool still cannot fill the request, randomised greedy fills
 *      top the portfolio up so the caller always gets the full count.
 *
 * Every lineup produced is legal by construction: one player per slot,
 * no player used twice, and total salary within the cap.
 */

import type { Player, StackRule } from "./types";

/**
 * How many distinct starting lineups the expansion is seeded with.
 *
 * More seeds means a more spread-out portfolio and a better chance of
 * holding an exposure cap. Each seed is one extra branch-and-bound solve,
 * which costs a few milliseconds.
 */
const SEED_COUNT = 8;

export interface PortfolioSlot {
  label: string;
  /** null = accepts any position. */
  accepts: string[] | null;
  /** Score multiplier for this slot (Showdown CPT = 1.5). */
  multiplier?: number;
}

export interface PortfolioLineup {
  /** Player index per slot, aligned with the `slots` array. */
  picks: number[];
  score: number;
  salary: number;
}

export interface PortfolioStats {
  requested: number;
  produced: number;
  /** How many lineups the expansion step generated children for. */
  expansions: number;
  /** Total candidates pushed onto the priority queue. */
  candidatesPushed: number;
  duplicatesDropped: number;
  /** Lineups rejected because they broke the exposure cap. */
  exposureRejected: number;
  /** Lineups produced by the randomised top-up. */
  randomizedFill: number;
  /** Slots dropped because no player in the pool could fill them. */
  droppedSlots: number;
  elapsedMs: number;
  /** True when the exact search proved the #1 lineup optimal. */
  exactFound: boolean;
  /** True when the exposure cap had to be relaxed to reach the full count. */
  exposureRelaxed: boolean;
  /** Lineups rejected because they broke a stacking rule. */
  stackRejected: number;
  /** Stacking rules that had to be dropped to reach the requested count. */
  relaxedStackRules: RelaxedStackRule[];
}

/**
 * A stacking rule that had to be given up to reach the requested count.
 *
 * The count is the requirement, a rule is the goal. When the two cannot
 * both be met the rule is dropped and reported, never applied silently.
 */
export interface RelaxedStackRule {
  scope: "team" | "game";
  id: string;
  min: number;
  max: number;
  /** "impossible" = no lineup on this slate could ever hold the rule. */
  reason: "impossible" | "count";
}

export interface PortfolioOpts {
  players: Player[];
  /** Objective score per player, aligned with `players`. */
  scores: number[];
  slots: PortfolioSlot[];
  salaryCap: number;
  /** How many distinct lineups to produce. */
  count: number;
  lockedIdx?: Set<number>;
  excludedIdx?: Set<number>;
  /**
   * Max exposure as a percentage — no single player may appear in more
   * than this share of the finished portfolio. 100 = no limit.
   */
  maxExposurePct?: number;
  /**
   * Extra legality check for a whole lineup — e.g. MMA cannot hold both
   * fighters from the same bout. Illegal lineups are skipped, not counted.
   */
  isLegal?: (picks: number[]) => boolean;
  /**
   * Stacking rules every lineup has to satisfy.
   *
   * A lineup that breaks one is rejected outright, exactly the way an
   * illegal MMA pick is rejected — the rule is never quietly repaired.
   */
  stackRules?: StackRule[];
  /** Candidates kept per slot. */
  candidateLimit?: number;
  /** How many candidates per slot are tried on each expansion. */
  expansionWidth?: number;
  seed?: number;
  timeBudgetMs?: number;
  maxExpansions?: number;
  maxQueue?: number;
}

interface HeapNode {
  score: number;
  salary: number;
  picks: number[];
  /** Insertion order — stable tiebreak so equal lineups keep a canonical order. */
  seq: number;
}

function keyOf(picks: number[]): string {
  return [...picks].sort((a, b) => a - b).join("|");
}

function canAccept(slot: PortfolioSlot, positions: string[]): boolean {
  if (slot.accepts === null) return true;
  return slot.accepts.some((p) => positions.includes(p));
}

/** Simple binary max-heap on score, with insertion-order tiebreak. */
class MaxHeap {
  private items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: HeapNode): void {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.gt(a[i], a[parent])) {
        [a[i], a[parent]] = [a[parent], a[i]];
        i = parent;
      } else break;
    }
  }

  pop(): HeapNode | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < a.length && this.gt(a[l], a[best])) best = l;
        if (r < a.length && this.gt(a[r], a[best])) best = r;
        if (best === i) break;
        [a[i], a[best]] = [a[best], a[i]];
        i = best;
      }
    }
    return top;
  }

  /**
   * Drop the lowest-scoring entries so the heap is at most `limit` long.
   *
   * Trims down to a low-water mark rather than exactly to the limit, so the
   * cost is amortised instead of being paid on every single push.
   */
  trim(limit: number): void {
    if (this.items.length <= limit) return;
    const a = this.items;
    const sorted = [...a].sort((x, y) => (this.gt(x, y) ? -1 : 1));
    this.items = sorted.slice(0, Math.floor(limit * 0.7));
  }

  private gt(x: HeapNode, y: HeapNode): boolean {
    if (x.score !== y.score) return x.score > y.score;
    return x.seq < y.seq;
  }
}

/**
 * Exact branch-and-bound for the single best legal lineup.
 *
 * Slots are filled most-constrained-first, candidates are tried
 * highest-score-first, and two bounds prune the search:
 *   - score bound: current score + the best score each remaining slot could
 *     still contribute;
 *   - cost bound: current salary + the cheapest legal fill for the rest.
 */
function findBestLineup(
  players: Player[],
  scores: number[],
  slots: PortfolioSlot[],
  cap: number,
  slotCandidates: number[][],
  lockedPicks: Map<number, number>,
  excludedIdx: Set<number>,
  nodeCap: number,
  timeLimitMs: number,
): { picks: number[]; score: number; salary: number } | null {
  const slotCount = slots.length;
  const depthOf = new Array(slotCount).fill(-1);
  const order = slotCandidates
    .map((c, idx) => ({ idx, c }))
    .sort((a, b) => a.c.length - b.c.length)
    .map((x) => x.idx);
  order.forEach((slotIdx, depth) => (depthOf[slotIdx] = depth));

  // `slotCandidates` arrives indexed by slot; the search fills slots in
  // depth order, so re-index it by depth before using it.
  const candidatesByDepth = order.map((slotIdx) => slotCandidates[slotIdx]);

  const slotMaxScore = order.map((_, depth) => {
    const list = candidatesByDepth[depth];
    return list.length > 0 ? scores[list[0]] : 0;
  });
  const slotMinSalary = order.map((_, depth) => {
    const list = candidatesByDepth[depth];
    if (list.length === 0) return Number.POSITIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    for (const i of list) min = Math.min(min, players[i].salary);
    return min;
  });
  const minFillCost = new Array(slotCount + 1).fill(0);
  for (let d = slotCount - 1; d >= 0; d--) minFillCost[d] = minFillCost[d + 1] + slotMinSalary[d];

  let bestScore = -Infinity;
  let bestPicks: number[] | null = null;
  let nodes = 0;
  const deadline = performance.now() + timeLimitMs;

  const used = new Array(players.length).fill(false);
  const current = new Array(slotCount).fill(-1);

  // Every player, strongest first. Used for the pool bound below.
  const sortedByScore = players
    .map((_, i) => i)
    .filter((i) => !excludedIdx.has(i) && !lockedPicks.has(i))
    .sort((a, b) => scores[b] - scores[a]);

  const greedy = (): { picks: number[]; score: number; salary: number } | null => {
    const picks = new Array(slotCount).fill(-1);
    const taken = new Array(players.length).fill(false);
    let salary = 0;
    let score = 0;
    for (const [slotIdx, playerIdx] of lockedPicks) {
      picks[slotIdx] = playerIdx;
      taken[playerIdx] = true;
      salary += players[playerIdx].salary;
      score += scores[playerIdx] * (slots[slotIdx].multiplier ?? 1);
    }
    for (let d = 0; d < slotCount; d++) {
      const slotIdx = order[d];
      if (picks[slotIdx] !== -1) continue;
      for (const p of candidatesByDepth[d]) {
        if (taken[p]) continue;
        if (salary + players[p].salary > cap) continue;
        picks[slotIdx] = p;
        taken[p] = true;
        salary += players[p].salary;
        score += scores[p] * (slots[slotIdx].multiplier ?? 1);
        break;
      }
      if (picks[slotIdx] === -1) return null; // no legal greedy fill
    }
    return { picks, score, salary };
  };

  /**
   * A second greedy that spends from the bottom up.
   *
   * The strongest-player fill can bust the salary cap on its own — eight
   * stars can simply cost more than the budget. Without an incumbent the
   * branch-and-bound cannot prune and the search degenerates, so a cheap
   * legal fill is always seeded as well.
   */
  const cheapGreedy = (): { picks: number[]; score: number; salary: number } | null => {
    const picks = new Array(slotCount).fill(-1);
    const taken = new Array(players.length).fill(false);
    let salary = 0;
    let score = 0;
    for (const [slotIdx, playerIdx] of lockedPicks) {
      picks[slotIdx] = playerIdx;
      taken[playerIdx] = true;
      salary += players[playerIdx].salary;
      score += scores[playerIdx] * (slots[slotIdx].multiplier ?? 1);
    }
    for (let d = 0; d < slotCount; d++) {
      const slotIdx = order[d];
      if (picks[slotIdx] !== -1) continue;
      const options = candidatesByDepth[d]
        .filter((p) => !taken[p])
        .sort((a, b) => players[a].salary - players[b].salary);
      const pick = options.find((p) => salary + players[p].salary <= cap);
      if (pick === undefined) return null;
      picks[slotIdx] = pick;
      taken[pick] = true;
      salary += players[pick].salary;
      score += scores[pick] * (slots[slotIdx].multiplier ?? 1);
    }
    return { picks, score, salary };
  };

  const seed = greedy() ?? cheapGreedy();
  // The greedy fill can fail on its own — eight strong players can simply
  // cost more than the cap. That must not stop the search: run it anyway
  // with no incumbent and let the branch-and-bound find a legal lineup.
  if (seed) {
    bestScore = seed.score;
    bestPicks = seed.picks;
  }

  const dfs = (depth: number, salary: number, score: number): void => {
    if (nodes >= nodeCap || performance.now() > deadline) return;
    nodes += 1;

    if (depth === slotCount) {
      if (score > bestScore) {
        bestScore = score;
        bestPicks = current.slice();
      }
      return;
    }

    // Score bound. Two valid upper bounds are available and the tighter one
    // is used:
    //   - per-slot: the best score each remaining slot could still take.
    //     Tight when positions matter, loose when every slot is FLEX.
    //   - pool: the best R distinct unused players, ignoring positions.
    //     Tight when every slot is FLEX.
    let ubSlots = score;
    for (let d = depth; d < slotCount; d++) ubSlots += slotMaxScore[d];
    let ubPool = score;
    let remainingSlots = slotCount - depth;
    for (const idx of sortedByScore) {
      if (used[idx]) continue;
      ubPool += scores[idx];
      remainingSlots -= 1;
      if (remainingSlots <= 0) break;
    }
    const ub = Math.min(ubSlots, ubPool);
    if (ub <= bestScore + 1e-9) return;

    // Cost bound — the cheapest legal fill for the remaining slots.
    if (salary + minFillCost[depth] > cap) return;

    const slotIdx = order[depth];
    if (current[slotIdx] !== -1) {
      dfs(depth + 1, salary, score);
      return;
    }
    const mult = slots[slotIdx].multiplier ?? 1;

    for (const p of candidatesByDepth[depth]) {
      if (used[p]) continue;
      const sal = players[p].salary;
      if (salary + sal > cap) continue;
      used[p] = true;
      current[slotIdx] = p;
      dfs(depth + 1, salary + sal, score + scores[p] * mult);
      current[slotIdx] = -1;
      used[p] = false;
    }
  };

  dfs(0, 0, 0);
  if (!bestPicks) return null;
  const salary = bestPicks.reduce((s, p) => s + (p >= 0 ? players[p].salary : 0), 0);
  return { picks: bestPicks, score: bestScore, salary };
}

/** Deterministic PRNG so a seeded run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The correlation group a player belongs to.
 *
 * This mirrors the helper in sports.ts, which cannot be imported from here
 * without changing a file this module does not own. Same two-step
 * fallback: the player's own group, else the game key parsed out of the
 * free-text game info.
 */
function effectiveCorrelationGroup(p: Player): string {
  if (p.correlationGroup) return p.correlationGroup;
  const m = (p.gameInfo ?? "").match(/([A-Z]{2,4}@[A-Z]{2,4})/);
  return m ? m[1] : "";
}

/** A rule with its membership resolved up front, so checks stay cheap. */
interface CompiledRule {
  rule: StackRule;
  /** 1 when the player at that index belongs to the rule's group. */
  members: Uint8Array;
  /** The indexes of the players that belong to the group. */
  memberIdx: number[];
}

/** The rules in force, with the membership of every player resolved. */
interface StackChecker {
  rules: CompiledRule[];
  /** The rule indexes each player belongs to. */
  playerRules: number[][];
}

/**
 * Merge the rules and resolve the membership of every group.
 *
 * Two rules about the same group are one rule: the strictest minimum and
 * the strictest maximum win.
 */
function compileStackRules(
  players: Player[],
  rules: StackRule[],
  excludedIdx: Set<number>,
): CompiledRule[] {
  const merged = new Map<
    string,
    { scope: "team" | "game"; id: string; min: number; max: number }
  >();
  for (const r of rules) {
    const id = (r.id ?? "").trim();
    const key = `${r.scope}:${id.toUpperCase()}`;
    const min = Math.max(0, r.min ?? 0);
    const max = r.max ?? Infinity;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { scope: r.scope, id, min, max });
    } else {
      existing.min = Math.max(existing.min, min);
      existing.max = Math.min(existing.max, max);
    }
  }

  const out: CompiledRule[] = [];
  for (const m of merged.values()) {
    const want = m.id.toUpperCase();
    const members = new Uint8Array(players.length);
    const memberIdx: number[] = [];
    for (let i = 0; i < players.length; i++) {
      if (excludedIdx.has(i)) continue;
      const key =
        m.scope === "team"
          ? (players[i].team ?? "").trim().toUpperCase()
          : effectiveCorrelationGroup(players[i]).trim().toUpperCase();
      if (!key || key !== want) continue;
      members[i] = 1;
      memberIdx.push(i);
    }
    out.push({ rule: { scope: m.scope, id: m.id, min: m.min, max: m.max }, members, memberIdx });
  }
  return out;
}

/** Bundle the rules with the per-player lookup used to count them. */
function makeStackChecker(rules: CompiledRule[], playerCount: number): StackChecker {
  const playerRules: number[][] = Array.from({ length: playerCount }, () => []);
  rules.forEach((r, idx) => {
    for (const p of r.memberIdx) playerRules[p].push(idx);
  });
  return { rules, playerRules };
}

/**
 * Whether a candidate lineup breaks a stacking rule.
 *
 * A minimum that is not met and a maximum that is exceeded are both breaks
 * — they are hard constraints, not preferences.
 */
function breaksStackRule(checker: StackChecker, picks: number[]): boolean {
  if (checker.rules.length === 0) return false;
  const counts = new Array(checker.rules.length).fill(0);
  for (const p of picks) {
    if (p < 0) continue;
    for (const ri of checker.playerRules[p]) counts[ri] += 1;
  }
  for (let i = 0; i < checker.rules.length; i++) {
    const rule = checker.rules[i].rule;
    const count = counts[i];
    if (count > rule.max || (rule.min > 0 && count < rule.min)) return true;
  }
  return false;
}

export function buildPortfolio(opts: PortfolioOpts): {
  lineups: PortfolioLineup[];
  /** The slots actually used — a slot with no candidate is dropped. */
  slots: PortfolioSlot[];
  stats: PortfolioStats;
} {
  const started = performance.now();
  const {
    players,
    scores,
    slots,
    salaryCap,
    count,
    lockedIdx = new Set<number>(),
    excludedIdx = new Set<number>(),
    maxExposurePct = 100,
    isLegal,
    stackRules = [],
    candidateLimit = 40,
    expansionWidth = 24,
    seed = 42,
    timeBudgetMs = 6_000,
    maxExpansions = 4_000,
    maxQueue = 60_000,
  } = opts;

  const stats: PortfolioStats = {
    requested: count,
    produced: 0,
    expansions: 0,
    candidatesPushed: 0,
    duplicatesDropped: 0,
    exposureRejected: 0,
    randomizedFill: 0,
    droppedSlots: 0,
    elapsedMs: 0,
    exactFound: false,
    exposureRelaxed: false,
    stackRejected: 0,
    relaxedStackRules: [],
  };

  if (count <= 0 || slots.length === 0) {
    stats.elapsedMs = Math.round(performance.now() - started);
    return { lineups: [], slots: [], stats };
  }

  // ── Candidates per slot, strongest first.
  const candidatesForSlot: number[][] = slots.map((slot) => {
    const list: number[] = [];
    for (let i = 0; i < players.length; i++) {
      if (excludedIdx.has(i)) continue;
      if (players[i].salary <= 0) continue;
      const positions = players[i].rosterPositions ?? players[i].positions ?? [];
      if (!canAccept(slot, positions)) continue;
      list.push(i);
    }
    list.sort((a, b) => scores[b] - scores[a]);
    return list;
  });

  /**
   * The truncated lists drive the search near the optimum, where only the
   * strongest players matter. The top-up needs the opposite: it has to fill
   * a roster inside the salary cap, which means it has to be able to reach
   * the cheap end of every slot.
   */
  const slotCandidatesFull: number[][] = candidatesForSlot.map((list) =>
    list.length > candidateLimit ? list.slice(0, candidateLimit) : list,
  );
  const slotCandidatesAll: number[][] = candidatesForSlot;

  // A slot nobody can fill (no DST on an NFL slate, no centre on an NBA
  // slate) must not sink the whole run. Drop it and keep the rest — an
  // eight-man lineup beats no lineup.
  const usableSlotIdx = slots
    .map((_, i) => i)
    .filter((i) => candidatesForSlot[i].length > 0);
  if (usableSlotIdx.length === 0) {
    stats.elapsedMs = Math.round(performance.now() - started);
    stats.produced = 0;
    return { lineups: [], slots: [], stats };
  }

  // ── Locked players are placed first, into the first slot that accepts them.
  const lockedPicks = new Map<number, number>();
  const lockedTaken = new Set<number>();
  for (const idx of lockedIdx) {
    if (idx < 0 || idx >= players.length) continue;
    if (excludedIdx.has(idx)) continue;
    const positions = players[idx].rosterPositions ?? players[idx].positions ?? [];
    for (let s = 0; s < usableSlotIdx.length; s++) {
      if (lockedPicks.has(s)) continue;
      if (lockedTaken.has(idx)) continue;
      if (canAccept(slots[usableSlotIdx[s]], positions)) {
        lockedPicks.set(s, idx);
        lockedTaken.add(idx);
        break;
      }
    }
  }

  // A locked player must not also appear in a candidate list.
  const activeSlotIdx = usableSlotIdx.filter(
    (i) => candidatesForSlot[i].filter((p) => !lockedTaken.has(p)).length > 0,
  );
  if (activeSlotIdx.length === 0) {
    stats.elapsedMs = Math.round(performance.now() - started);
    stats.produced = 0;
    return { lineups: [], slots: [], stats };
  }
  const droppedSlots = slots.length - activeSlotIdx.length;
  const activeSlots = activeSlotIdx.map((i) => slots[i]);
  const slotCandidates = activeSlotIdx.map((i) =>
    slotCandidatesFull[i].filter((p) => !lockedTaken.has(p)),
  );
  /** The full candidate list per active slot, for the randomised top-up. */
  const slotCandidatesUnbounded = activeSlotIdx.map((i) =>
    slotCandidatesAll[i].filter((p) => !lockedTaken.has(p)),
  );

  // ── Stacking rules.
  //
  // A rule is a hard constraint: a lineup that breaks one is rejected the
  // same way an illegal MMA pick is rejected — never quietly repaired. A
  // rule no lineup could ever hold is dropped before the search starts, so
  // the solver does not burn its budget hunting for something that does
  // not exist.
  const compiledRules = compileStackRules(players, stackRules, excludedIdx);
  const relaxedStackRules: RelaxedStackRule[] = [];
  const lockedPlayersInPlay = [...lockedPicks.values()];
  const survivingRules: CompiledRule[] = [];
  for (const c of compiledRules) {
    let lockedCount = 0;
    for (const idx of lockedPlayersInPlay) if (c.members[idx]) lockedCount += 1;
    // A lineup can never hold more players from a group than the roster
    // has slots, or more than the group actually has.
    const possible = Math.min(c.memberIdx.length, activeSlots.length);
    if (lockedCount > c.rule.max) {
      // The locked players already break the maximum.
      relaxedStackRules.push({
        scope: c.rule.scope,
        id: c.rule.id,
        min: c.rule.min,
        max: c.rule.max,
        reason: "impossible",
      });
      continue;
    }
    if (c.rule.min > 0 && (c.rule.min > possible || c.rule.min > c.rule.max)) {
      // The minimum asks for more players than the slate can hold, or it
      // contradicts the group's own maximum. The maximum still stands.
      relaxedStackRules.push({
        scope: c.rule.scope,
        id: c.rule.id,
        min: c.rule.min,
        max: c.rule.max,
        reason: "impossible",
      });
      survivingRules.push({
        rule: { ...c.rule, min: 0 },
        members: c.members,
        memberIdx: c.memberIdx,
      });
      continue;
    }
    survivingRules.push(c);
  }
  let stackChecker = makeStackChecker(survivingRules, players.length);

  // ── The order the slots are filled in.
  //
  // Most-constrained slot first, so a legal fill is likely. Slots that can
  // take a player from a group with a minimum move to the front: the fill
  // cannot stack a group it never looks at, so if every slot that fits the
  // stacked team sits at the back of the order the minimum is unreachable
  // and every attempt fails the same way.
  const baseFillOrder = slotCandidatesUnbounded
    .map((c, idx) => ({ idx, c }))
    .sort((a, b) => a.c.length - b.c.length)
    .map((x) => x.idx);
  const fillOrder = (() => {
    const minRules = stackChecker.rules
      .filter((r) => r.rule.min > 0)
      .sort((a, b) => b.rule.min - a.rule.min);
    if (minRules.length === 0) return baseFillOrder;
    const ordered: number[] = [];
    const seen = new Set<number>();
    for (const r of minRules) {
      for (const slotIdx of baseFillOrder) {
        if (seen.has(slotIdx)) continue;
        if (!slotCandidatesUnbounded[slotIdx].some((p) => r.members[p])) continue;
        seen.add(slotIdx);
        ordered.push(slotIdx);
      }
    }
    for (const slotIdx of baseFillOrder) if (!seen.has(slotIdx)) ordered.push(slotIdx);
    return ordered;
  })();

  // The cheapest player in each slot. The fill reserves this much salary
  // for the slots it has not reached yet, so it cannot spend itself into a
  // corner where the remaining slots cannot be paid for.
  const fillCheapest = fillOrder.map((slotIdx) => {
    let m = Infinity;
    for (const p of slotCandidatesUnbounded[slotIdx]) {
      if (players[p].salary < m) m = players[p].salary;
    }
    return m;
  });

  /**
   * The best greedy lineup that satisfies the stacking rules.
   *
   * The exact search solves the pool, not the rules, so its answer is
   * normally illegal once a stack is asked for. The expansion needs a legal
   * starting point, or it spends its whole budget walking a neighbourhood
   * of lineups it has to throw away.
   */
  const buildStackSeed = (
    avoid: Set<number>,
  ): { picks: number[]; score: number; salary: number } | null => {
    const rules = stackChecker.rules;
    const picks = new Array(activeSlots.length).fill(-1);
    const taken = new Set<number>();
    const ruleCounts = new Array(rules.length).fill(0);
    let salary = 0;
    let score = 0;

    for (const [slotIdx, playerIdx] of lockedPicks) {
      picks[slotIdx] = playerIdx;
      taken.add(playerIdx);
      salary += players[playerIdx].salary;
      score += scores[playerIdx] * (activeSlots[slotIdx].multiplier ?? 1);
      for (let ri = 0; ri < rules.length; ri++) {
        if (rules[ri].members[playerIdx]) ruleCounts[ri] += 1;
      }
    }

    for (let pos = 0; pos < fillOrder.length; pos++) {
      const slotIdx = fillOrder[pos];
      if (picks[slotIdx] !== -1) continue;
      const mult = activeSlots[slotIdx].multiplier ?? 1;
      let reserved = 0;
      for (let k = pos + 1; k < fillOrder.length; k++) reserved += fillCheapest[k];
      const options = slotCandidatesUnbounded[slotIdx].filter(
        (p) =>
          !taken.has(p) &&
          !avoid.has(p) &&
          salary + players[p].salary + reserved <= salaryCap &&
          // A group that is already at its maximum takes no more players.
          !rules.some((r, ri) => r.members[p] && ruleCounts[ri] + 1 > r.rule.max),
      );
      if (options.length === 0) return null;
      // A group the lineup still owes comes first: a stack that is only
      // half filled is not a stack.
      let chosen = -1;
      for (let ri = 0; ri < rules.length; ri++) {
        const r = rules[ri];
        if (r.rule.min <= 0 || ruleCounts[ri] >= r.rule.min) continue;
        const member = options.filter((p) => r.members[p])[0];
        if (member !== undefined) {
          chosen = member;
          break;
        }
      }
      if (chosen < 0) chosen = options[0];
      picks[slotIdx] = chosen;
      taken.add(chosen);
      salary += players[chosen].salary;
      score += scores[chosen] * mult;
      for (let ri = 0; ri < rules.length; ri++) {
        if (rules[ri].members[chosen]) ruleCounts[ri] += 1;
      }
    }

    for (let ri = 0; ri < rules.length; ri++) {
      const r = rules[ri];
      if (r.rule.min > 0 && ruleCounts[ri] < r.rule.min) return null;
      if (ruleCounts[ri] > r.rule.max) return null;
    }
    return { picks, score, salary };
  };

  // ── 1. Exact best lineup.
  const exact = findBestLineup(
    players,
    scores,
    activeSlots,
    salaryCap,
    slotCandidates,
    lockedPicks,
    excludedIdx,
    400_000,
    Math.min(2_000, timeBudgetMs),
  );
  // The exact search solves the pool, not the rules, so its answer only
  // counts as optimal when it also satisfies every stacking rule.
  stats.exactFound = exact !== null && !breaksStackRule(stackChecker, exact.picks);
  if (droppedSlots > 0) {
    stats.droppedSlots = droppedSlots;
  }

  const heap = new MaxHeap();
  /** Keys already pushed onto the queue — stops the same child being queued twice. */
  const queued = new Set<string>();
  /** Keys already accepted into the output. */
  const selectedKeys = new Set<string>();
  const selected: PortfolioLineup[] = [];
  const exposureCount = new Map<number, number>();

  let seq = 0;
  let bestEverScore = -Infinity;

  /**
   * Seed the search with several distinct starting lineups.
   *
   * One starting lineup is not enough. The best-first expansion then walks a
   * single neighbourhood, every lineup ends up sharing the same core, and an
   * exposure cap cannot survive that. Each extra seed is the best lineup that
   * avoids one more of the best lineup's players, so the seeds sit in
   * different parts of the space and the portfolio can spread out.
   */
  const lockedPlayers = new Set(lockedPicks.values());
  const seeds: { picks: number[]; score: number; salary: number }[] = [];
  if (stackChecker.rules.length > 0) {
    // A stack changes what the search is solving for, so the seeds have to
    // be legal under the rules. The pool optimum is not: it was found
    // without the stack in mind.
    const banned = new Set<number>();
    const first = buildStackSeed(banned);
    if (first) {
      seeds.push(first);
      const ranked = first.picks
        .filter((p) => p >= 0 && !lockedPlayers.has(p))
        .sort((a, b) => scores[b] - scores[a]);
      for (let k = 1; k < SEED_COUNT && ranked.length > 0; k++) {
        banned.add(ranked[Math.min(k - 1, ranked.length - 1)]);
        const seed = buildStackSeed(banned);
        if (!seed) break;
        seeds.push(seed);
      }
    }
  } else if (exact) {
    seeds.push(exact);
    const ranked = exact.picks
      .filter((p) => p >= 0 && !lockedPlayers.has(p))
      .sort((a, b) => scores[b] - scores[a]);
    const banned = new Set<number>();
    for (let k = 1; k < SEED_COUNT && ranked.length > 0; k++) {
      banned.add(ranked[Math.min(k - 1, ranked.length - 1)]);
      const seed = findBestLineup(
        players,
        scores,
        activeSlots,
        salaryCap,
        slotCandidates,
        lockedPicks,
        new Set([...excludedIdx, ...banned]),
        400_000,
        Math.min(600, timeBudgetMs),
      );
      if (!seed) break;
      seeds.push(seed);
    }
  }

  for (const seed of seeds) {
    const key = keyOf(seed.picks);
    if (queued.has(key)) continue;
    queued.add(key);
    if (seed.score > bestEverScore) bestEverScore = seed.score;
    heap.push({ score: seed.score, salary: seed.salary, picks: seed.picks, seq: seq++ });
  }

  // Exposure is measured against the size of the finished portfolio, not
  // against the lineups accepted so far. A player may appear in at most
  // `maxExposurePct` of the requested lineup count.
  const exposureLimitCount =
    maxExposurePct >= 100 ? Infinity : Math.max(1, Math.floor((maxExposurePct / 100) * count));
  /**
   * The cap actually in force. It starts at the user's cap and is relaxed
   * only if the portfolio cannot otherwise reach the requested count — the
   * count is the requirement, the cap is the goal.
   */
  let effectiveLimit = exposureLimitCount;

  const breachesExposure = (picks: number[]): boolean => {
    if (!Number.isFinite(effectiveLimit)) return false;
    for (const p of picks) {
      const c = exposureCount.get(p) ?? 0;
      if (c + 1 > effectiveLimit) return true;
    }
    return false;
  };

  /**
   * Repair an over-exposed lineup by swapping the offending player for the
   * next legal alternative in the same slot.
   *
   * Discarding these lineups instead would starve the portfolio — the best
   * lineups all share the same stars, so most of them breach the cap. This
   * is the same thing a human does: swap the player you have too much of.
   */
  const repairExposure = (
    picks: number[],
    score: number,
    salary: number,
  ): { picks: number[]; score: number; salary: number } | null => {
    const cur = picks.slice();
    let curScore = score;
    let curSalary = salary;
    for (let s = 0; s < activeSlots.length; s++) {
      const player = cur[s];
      if (player < 0) continue;
      if ((exposureCount.get(player) ?? 0) + 1 <= effectiveLimit) continue;
      const inUse = new Set(cur);
      let replacement = -1;
      for (const cand of slotCandidates[s]) {
        if (inUse.has(cand)) continue;
        if ((exposureCount.get(cand) ?? 0) + 1 > effectiveLimit) continue;
        const newSalary = curSalary - players[player].salary + players[cand].salary;
        if (newSalary > salaryCap) continue;
        replacement = cand;
        curSalary = newSalary;
        break;
      }
      if (replacement < 0) return null;
      const mult = activeSlots[s].multiplier ?? 1;
      curScore = curScore - scores[player] * mult + scores[replacement] * mult;
      cur[s] = replacement;
    }
    return { picks: cur, score: curScore, salary: curSalary };
  };

  // ── 2. Best-first expansion of the swap neighbourhood.
  //
  // The optimum itself has no improving swap, so the search has to be
  // allowed to walk *downhill* — but only a little. Every candidate must
  // stay within REGRET_LIMIT of the best lineup found, which is what keeps
  // a 150-lineup portfolio tight around the optimum instead of drifting
  // into random builds.
  const REGRET_LIMIT = 0.2;
  // The expansion only has to find the strongest lineups near the optimum.
  // The randomised top-up does the rest of the work and is much cheaper per
  // lineup, so the search does not need the whole budget.
  const deadline = performance.now() + Math.min(2_500, timeBudgetMs);
  const floor = (bestEverScore: number) => bestEverScore * (1 - REGRET_LIMIT);
  while (selected.length < count && heap.size > 0 && stats.expansions < maxExpansions) {
    if (performance.now() > deadline) break;
    const node = heap.pop()!;
    const key = keyOf(node.picks);
    if (selectedKeys.has(key)) {
      stats.duplicatesDropped += 1;
      continue;
    }

    const exposureBlocked = breachesExposure(node.picks);
    const stackBroken = breaksStackRule(stackChecker, node.picks);
    const illegal = stackBroken || (isLegal ? !isLegal(node.picks) : false);

    if (exposureBlocked) {
      // Try to bring the lineup back inside the budget rather than drop it.
      const repaired = repairExposure(node.picks, node.score, node.salary);
      if (repaired) {
        const repairedKey = keyOf(repaired.picks);
        if (!queued.has(repairedKey) && !selectedKeys.has(repairedKey)) {
          queued.add(repairedKey);
          heap.push({
            score: repaired.score,
            salary: repaired.salary,
            picks: repaired.picks,
            seq: seq++,
          });
        }
      }
      stats.exposureRejected += 1;
    } else if (illegal) {
      if (stackBroken) stats.stackRejected += 1;
      else stats.duplicatesDropped += 1;
    } else {
      selectedKeys.add(key);
      selected.push({ picks: node.picks, score: node.score, salary: node.salary });
      if (node.score > bestEverScore) bestEverScore = node.score;
      for (const p of node.picks) {
        exposureCount.set(p, (exposureCount.get(p) ?? 0) + 1);
      }
      stats.expansions += 1;
    }

    if (selected.length >= count) break;

    // Children: swap one slot's player for the next-best legal alternative.
    // A rejected lineup is still expanded — one of its neighbours may be
    // within the exposure budget where it is not.
    const inUse = new Set(node.picks);
    const scoreFloor = floor(bestEverScore);
    for (let s = 0; s < activeSlots.length; s++) {
      const current = node.picks[s];
      if (current < 0) continue;
      if (lockedPicks.has(s)) continue; // locked slots are fixed
      const mult = activeSlots[s].multiplier ?? 1;
      const currentScore = scores[current] * mult;
      const currentSalary = players[current].salary;
      let tried = 0;
      for (const c of slotCandidates[s]) {
        if (tried >= expansionWidth) break;
        if (c === current) continue;
        if (inUse.has(c)) continue;
        // Do not propose a player who is already at their exposure cap —
        // the neighbourhood has to stay inside the budget or the portfolio
        // fills up with lineups that will only be thrown away.
        if (!Number.isFinite(effectiveLimit)) {
          // no cap
        } else if ((exposureCount.get(c) ?? 0) + 1 > effectiveLimit) {
          continue;
        }
        const newSalary = node.salary - currentSalary + players[c].salary;
        if (newSalary > salaryCap) continue;
        const newScore = node.score - currentScore + scores[c] * mult;
        // Only lineups within the regret band of the best lineup are kept.
        if (newScore < scoreFloor) continue;
        tried += 1;
        const picks = node.picks.slice();
        picks[s] = c;
        const childKey = keyOf(picks);
        if (queued.has(childKey)) continue;
        queued.add(childKey);
        heap.push({ score: newScore, salary: newSalary, picks, seq: seq++ });
        stats.candidatesPushed += 1;
        if (heap.size > maxQueue) heap.trim(maxQueue);
      }
    }
  }

  // ── 3. Randomised top-up so the caller always gets the full count.
  //
  // The exposure cap is a goal and the lineup count is a requirement. If the
  // cap cannot be held for every lineup, it is relaxed in steps so the
  // portfolio still reaches the number the user asked for — a portfolio of
  // 105 lineups when 150 were requested is not a usable answer.
  const randomFill = (limit: number, rules: CompiledRule[]) => {
    effectiveLimit = limit;
    const rand = mulberry32(seed);
    const attempts = Math.max(2_000, count * 60);
    const checker = makeStackChecker(rules, players.length);

    /** Where in the fill order a rule's group can still be used. */
    const rulePositions = rules.map((r) => {
      const out: number[] = [];
      for (let pos = 0; pos < fillOrder.length; pos++) {
        const slotIdx = fillOrder[pos];
        if (slotCandidatesUnbounded[slotIdx].some((p) => r.members[p])) out.push(pos);
      }
      return out;
    });

    for (let attempt = 0; attempt < attempts && selected.length < count; attempt++) {
      if (performance.now() > deadline + 6_000) break;
      const picks = new Array(activeSlots.length).fill(-1);
      const taken = new Set<number>();
      let salary = 0;
      let score = 0;
      let ok = true;
      /** Players picked per rule so far. */
      const ruleCounts = new Array(rules.length).fill(0);

      for (const [slotIdx, playerIdx] of lockedPicks) {
        picks[slotIdx] = playerIdx;
        taken.add(playerIdx);
        salary += players[playerIdx].salary;
        score += scores[playerIdx] * (activeSlots[slotIdx].multiplier ?? 1);
        for (let ri = 0; ri < rules.length; ri++) {
          if (rules[ri].members[playerIdx]) ruleCounts[ri] += 1;
        }
      }

      for (let pos = 0; pos < fillOrder.length; pos++) {
        const slotIdx = fillOrder[pos];
        if (picks[slotIdx] !== -1) continue;
        const mult = activeSlots[slotIdx].multiplier ?? 1;
        // Salary still needed by the slots that come after this one.
        let reserved = 0;
        for (let k = pos + 1; k < fillOrder.length; k++) reserved += fillCheapest[k];

        // A minimum the lineup can no longer meet ends this attempt. The
        // fill has to fail rather than hand back a lineup that breaks a
        // rule — the same choice the search makes.
        let feasible = true;
        for (let ri = 0; ri < rules.length; ri++) {
          const r = rules[ri];
          if (r.rule.min <= 0) continue;
          const need = r.rule.min - ruleCounts[ri];
          if (need <= 0) continue;
          let slotsLeft = 0;
          for (const p of rulePositions[ri]) {
            if (p < pos) continue;
            if (picks[fillOrder[p]] !== -1) continue;
            slotsLeft += 1;
          }
          const membersLeft = r.memberIdx.length - ruleCounts[ri];
          if (need > slotsLeft || need > membersLeft) {
            feasible = false;
            break;
          }
        }
        if (!feasible) {
          ok = false;
          break;
        }

        const pool = slotCandidatesUnbounded[slotIdx].filter(
          (p) =>
            !taken.has(p) &&
            salary + players[p].salary + reserved <= salaryCap &&
            (!Number.isFinite(limit) ||
              (exposureCount.get(p) ?? 0) + 1 <= limit) &&
            // A group that is already at its maximum takes no more players.
            !rules.some((r, ri) => r.members[p] && ruleCounts[ri] + 1 > r.rule.max),
        );
        if (pool.length === 0) {
          ok = false;
          break;
        }

        // Fill a minimum the lineup still owes before anything else, so the
        // rule is met rather than patched up afterwards.
        let bestPick = -1;
        const urgent = rules
          .map((r, ri) => ({ ri, need: r.rule.min - ruleCounts[ri] }))
          .filter((u) => u.need > 0)
          .sort((a, b) => b.need - a.need);
        for (const u of urgent) {
          const cands = pool.filter((p) => rules[u.ri].members[p]);
          if (cands.length === 0) continue;
          const top = cands.slice(0, Math.min(cands.length, 8));
          bestPick = rand() < 0.75 ? top[0] : top[Math.floor(rand() * top.length)];
          break;
        }
        if (bestPick < 0) {
          // Take the strongest available pick most of the time, and one of
          // the next few the rest of the time — that is what keeps a large
          // portfolio from collapsing into the same handful of builds.
          const top = pool.slice(0, Math.min(pool.length, 8));
          bestPick = rand() < 0.75 ? top[0] : top[Math.floor(rand() * top.length)];
        }
        picks[slotIdx] = bestPick;
        taken.add(bestPick);
        salary += players[bestPick].salary;
        score += scores[bestPick] * mult;
        for (let ri = 0; ri < rules.length; ri++) {
          if (rules[ri].members[bestPick]) ruleCounts[ri] += 1;
        }
      }

      if (!ok) continue;
      const key = keyOf(picks);
      if (selectedKeys.has(key)) continue;
      if (isLegal && !isLegal(picks)) continue;
      if (breaksStackRule(checker, picks)) continue;
      if (breachesExposure(picks)) {
        stats.exposureRejected += 1;
        continue;
      }
      selectedKeys.add(key);
      selected.push({ picks, score, salary });
      for (const p of picks) {
        exposureCount.set(p, (exposureCount.get(p) ?? 0) + 1);
      }
      stats.randomizedFill += 1;
    }
  };

  if (selected.length < count) {
    randomFill(effectiveLimit, stackChecker.rules);
  }
  if (selected.length < count && Number.isFinite(exposureLimitCount)) {
    for (const factor of [1.25, 1.75, 2.5, Infinity]) {
      if (selected.length >= count) break;
      const relaxed =
        factor === Infinity
          ? Infinity
          : Math.max(exposureLimitCount, Math.floor(exposureLimitCount * factor));
      randomFill(relaxed, stackChecker.rules);
    }
    if (effectiveLimit !== exposureLimitCount) {
      stats.exposureRelaxed = true;
    }
  }

  // ── 4. Stack relaxation.
  //
  // The lineup count is the requirement; a stacking rule is the goal the
  // solver has to work around. If the rules cannot be held for every
  // lineup, the minimums are given up — a maximum that is exceeded is
  // never relaxed, because a lineup above the maximum is a different
  // lineup, not a worse one — and the reason is reported.
  if (selected.length < count) {
    const minRules = stackChecker.rules.filter((r) => r.rule.min > 0);
    if (minRules.length > 0) {
      for (const r of minRules) {
        relaxedStackRules.push({
          scope: r.rule.scope,
          id: r.rule.id,
          min: r.rule.min,
          max: r.rule.max,
          reason: "count",
        });
      }
      stackChecker = makeStackChecker(
        stackChecker.rules.filter((r) => r.rule.min <= 0),
        players.length,
      );
      randomFill(effectiveLimit, stackChecker.rules);
    }
  }

  // Final ordering: best score first, stable on ties.
  selected.sort((a, b) => b.score - a.score);

  stats.produced = selected.length;
  stats.relaxedStackRules = relaxedStackRules;
  stats.elapsedMs = Math.round(performance.now() - started);
  return { lineups: selected, slots: activeSlots, stats };
}
