/**
 * Daily lineup stacks — the groups on today's slate that lift each other.
 *
 * A stack is a small set of players who belong together: two teammates on
 * one side, the best players on both sides of one game, or two fighters in
 * one bout on an MMA card. Putting them in the same lineup concentrates the
 * upside that comes from them sharing the same night.
 *
 * This module only *proposes*. It never builds a lineup and never talks to
 * the solver. What it hands back for each proposal is a `StackRule` — the
 * constraint the engine writes into the build when the user picks it.
 *
 * Pure, no React, no I/O. The same slate in gives the same list out.
 */
import type { Player } from "@/types";
import type { StackRule } from "@/optimizer/types";

export type StackSport = "nba" | "nfl" | "mma" | "golf";

/** What kind of stack this is. */
export type StackKind = "team" | "game" | "card";

/**
 * The finer label. A card stack and a fight pair are both "card" scope, but
 * they are different things to a user, and the panel says so.
 */
export type StackVariant = "team" | "game" | "card" | "bout";

export interface StackCandidate {
  /** Stable id for React keys and for tracking which one is active. */
  id: string;
  /** What kind of stack this is. */
  kind: StackKind;
  /** Finer label — "bout" separates a fight pair from a card stack. */
  variant: StackVariant;
  /** Human title, e.g. "BOS 2-man stack" or "BOS@NE game stack". */
  name: string;
  /** The team abbreviation, or the game key, this stack is built on. */
  scopeId: string;
  /** scopeId is a team (true) or a game (false). */
  scope: "team" | "game";
  /** The players in the stack, best-scoring first. */
  players: Player[];
  /** Combined salary of the stack. */
  salary: number;
  /** Combined projected points of the stack. */
  projection: number;
  /** Projected points per $100 of salary. */
  value: number;
  /** The rule that gets written into the optimizer when this stack is used. */
  rule: StackRule;
}

export interface GenerateStacksOptions {
  /** How many stacks to return at most. Default 24. */
  limit?: number;
  /**
   * MMA only. A lineup normally cannot hold both fighters from one bout, so
   * fight pairs are only offered when the user allows opponents.
   */
  allowOpponents?: boolean;
}

/**
 * How many players a finished lineup holds. Used as the generous ceiling on
 * a stack rule — the rule is a guard rail, not a target.
 */
const ROSTER_SIZE: Record<StackSport, number> = {
  nba: 8,
  nfl: 9,
  mma: 6,
  golf: 6,
};

const DEFAULT_LIMIT = 24;

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Best score first. */
function byProjection(a: Player, b: Player): number {
  return (b.projection ?? 0) - (a.projection ?? 0);
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function salaryOf(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.salary ?? 0), 0);
}

function projectionOf(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.projection ?? 0), 0);
}

/**
 * Build one candidate from a chosen set of players. Everything the panel
 * shows is computed here so the list and the rule can never disagree.
 */
function buildCandidate(params: {
  variant: StackVariant;
  name: string;
  scope: "team" | "game";
  scopeId: string;
  players: Player[];
  sport: StackSport;
}): StackCandidate {
  const players = [...params.players].sort(byProjection);
  const salary = salaryOf(players);
  const projection = round(projectionOf(players), 2);
  const value = salary > 0 ? round((projection / salary) * 100, 2) : 0;
  const id = `${params.variant}:${params.scopeId}:${players.map((p) => p.id).sort().join("-")}`;

  return {
    id,
    kind:
      params.variant === "team" ? "team" : params.variant === "game" ? "game" : "card",
    variant: params.variant,
    name: params.name,
    scopeId: params.scopeId,
    scope: params.scope,
    players,
    salary,
    projection,
    value,
    rule: {
      scope: params.scope,
      id: params.scopeId,
      min: players.length,
      max: ROSTER_SIZE[params.sport],
    },
  };
}

/**
 * NBA / NFL — team stacks. The team's best player leads, and the stack is
 * that player plus their one or two best teammates.
 */
function teamStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [team, members] of groupBy(players, (p) => p.team)) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byProjection);
    for (const size of [2, 3]) {
      if (sorted.length < size) continue;
      out.push(
        buildCandidate({
          variant: "team",
          name: `${team} ${size}-man stack`,
          scope: "team",
          scopeId: team,
          players: sorted.slice(0, size),
          sport,
        }),
      );
    }
  }
  return out;
}

/**
 * NBA / NFL — game stacks. A game stack crosses the matchup: it always holds
 * the best player from each side, so the lineup carries both teams' upside.
 */
function gameStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [gameKey, members] of groupBy(players, (p) => p.correlation_group)) {
    const sides = [...groupBy(members, (p) => p.team).values()]
      .filter((side) => side.length > 0)
      .map((side) => [...side].sort(byProjection))
      .sort((a, b) => (b[0]?.projection ?? 0) - (a[0]?.projection ?? 0));
    if (sides.length < 2) continue;

    const [a, b] = sides;
    const core = [a[0], b[0]];
    const extras = [
      ...(a.length > 1 ? [a[1]] : []),
      ...(b.length > 1 ? [b[1]] : []),
    ].sort(byProjection);

    const variants: Player[][] = [
      core,
      [...core, ...extras.slice(0, 1)],
      [...core, ...extras.slice(0, 2)],
    ];

    for (const picks of variants) {
      if (picks.length < 2) continue;
      out.push(
        buildCandidate({
          variant: "game",
          name: `${gameKey} game stack`,
          scope: "game",
          scopeId: gameKey,
          players: picks,
          sport,
        }),
      );
    }
  }
  return out;
}

/**
 * MMA — card stacks. The best few fighters on the same card. When the user
 * has not allowed opponents, a stack never holds both sides of one fight.
 */
function cardStacks(
  players: Player[],
  sport: StackSport,
  allowOpponents: boolean,
): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [cardId, members] of groupBy(players, (p) => p.correlation_group)) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(byProjection);
    for (const size of [2, 3]) {
      if (sorted.length < size) continue;
      const picks = pickCard(sorted, size, allowOpponents);
      if (picks.length < size) continue;
      const eventName = sorted.find((p) => p.game_info)?.game_info;
      out.push(
        buildCandidate({
          variant: "card",
          name: eventName ? `${eventName} card stack` : `Card ${cardId} stack`,
          scope: "game",
          scopeId: cardId,
          players: picks,
          sport,
        }),
      );
    }
  }
  return out;
}

/** Take the best fighters on a card, never two from the same fight. */
function pickCard(
  sorted: Player[],
  size: number,
  allowOpponents: boolean,
): Player[] {
  const picks: Player[] = [];
  const usedBouts = new Set<string>();
  for (const p of sorted) {
    if (picks.length >= size) break;
    const bout = p.bout ?? "";
    if (!allowOpponents && bout && usedBouts.has(bout)) continue;
    picks.push(p);
    if (bout) usedBouts.add(bout);
  }
  return picks;
}

/**
 * MMA — fight pairs. Both fighters from one bout. Only offered when the user
 * allows opponents, because a lineup normally cannot hold both of them.
 *
 * The rule for a fight pair is written against the card, not the fight: the
 * engine counts a "game" rule by correlation group, and on an MMA card every
 * fighter shares the same one. Two fighters from the card is the strongest
 * statement the rule shape can make about a fight.
 */
function boutStacks(players: Player[], sport: StackSport): StackCandidate[] {
  const out: StackCandidate[] = [];
  for (const [boutKey, fighters] of groupBy(players, (p) => p.bout)) {
    if (fighters.length !== 2) continue;
    const cardId = fighters.find((p) => p.correlation_group)?.correlation_group;
    if (!cardId) continue;
    out.push(
      buildCandidate({
        variant: "bout",
        name: boutKey,
        scope: "game",
        scopeId: cardId,
        players: fighters,
        sport,
      }),
    );
  }
  return out;
}

/**
 * Scan the slate and return the best stack candidates, best combined
 * projection first.
 *
 * Golf has no stacks: every player is on their own hole, so there is no team
 * and no game to build around. It returns an empty list.
 */
export function generateStacks(
  players: Player[],
  sport: StackSport,
  options: GenerateStacksOptions = {},
): StackCandidate[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const allowOpponents = options.allowOpponents ?? false;
  if (sport === "golf") return [];

  const eligible = players.filter((p) => p.sport === sport && !p.is_excluded);

  let candidates: StackCandidate[];
  if (sport === "mma") {
    // Fight pairs come first so that a fight pair survives deduplication
    // against a card stack holding the same two fighters — the fight is the
    // more specific of the two.
    candidates = [];
    if (allowOpponents) candidates = candidates.concat(boutStacks(eligible, sport));
    candidates = candidates.concat(cardStacks(eligible, sport, allowOpponents));
  } else {
    candidates = teamStacks(eligible, sport).concat(gameStacks(eligible, sport));
  }

  // Same scope and the same players is the same stack, however it was found.
  const seen = new Set<string>();
  const unique: StackCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.scope}:${candidate.scopeId}:${candidate.players
      .map((p) => p.id)
      .sort()
      .join("-")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  unique.sort(
    (a, b) =>
      b.projection - a.projection ||
      b.value - a.value ||
      a.name.localeCompare(b.name),
  );
  return unique.slice(0, Math.max(0, limit));
}
