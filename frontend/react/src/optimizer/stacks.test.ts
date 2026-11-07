/**
 * Stack generation tests.
 *
 * These guard the promises the panel makes to the user: a team stack really
 * is one team, a game stack really does cross the matchup, a fight pair only
 * shows up when the user allows opponents, and golf never pretends to have
 * a stack.
 */
import { describe, expect, it } from "vitest";

import { generateStacks } from "@/optimizer/stacks";
import type { Player } from "@/types";

function nbaPlayer(over: Partial<Player> & Pick<Player, "id" | "name" | "salary" | "projection">): Player {
  return {
    sport: "nba",
    team: "BOS",
    opponent: "NE",
    correlation_group: "BOS@NE",
    roster_positions: ["PG"],    ...over,
  };
}

/** Two teams, three games, so team stacks and game stacks both have room. */
const nbaPool: Player[] = [
  nbaPlayer({ id: "b1", name: "Brown", salary: 9000, projection: 52, team: "BOS", roster_positions: ["PG"] }),
  nbaPlayer({ id: "b2", name: "Bird", salary: 7000, projection: 44, team: "BOS", roster_positions: ["SG"] }),
  nbaPlayer({ id: "b3", name: "Blue", salary: 5000, projection: 30, team: "BOS", roster_positions: ["SF"] }),
  nbaPlayer({ id: "b4", name: "Vale", salary: 4000, projection: 20, team: "BOS", roster_positions: ["PF"] }),
  nbaPlayer({ id: "n1", name: "Nole", salary: 9500, projection: 58, team: "NE", correlation_group: "BOS@NE", roster_positions: ["PG"] }),
  nbaPlayer({ id: "n2", name: "Nunez", salary: 8000, projection: 41, team: "NE", correlation_group: "BOS@NE", roster_positions: ["SG"] }),
  nbaPlayer({ id: "n3", name: "Nash", salary: 6000, projection: 33, team: "NE", correlation_group: "BOS@NE", roster_positions: ["C"] }),
  nbaPlayer({ id: "l1", name: "Loud", salary: 8800, projection: 49, team: "LAL", opponent: "GSW", correlation_group: "LAL@GSW", roster_positions: ["PG"] }),
  nbaPlayer({ id: "l2", name: "Lowe", salary: 7200, projection: 38, team: "LAL", opponent: "GSW", correlation_group: "LAL@GSW", roster_positions: ["SG"] }),
  nbaPlayer({ id: "l3", name: "Lund", salary: 5200, projection: 27, team: "LAL", opponent: "GSW", correlation_group: "LAL@GSW", roster_positions: ["SF"] }),
];

const mmaPool: Player[] = [
  {
    id: "f1",
    name: "Fighter One",
    sport: "mma",
    salary: 8000,
    projection: 22,
    correlation_group: "card-1",
    bout: "Fighter One vs Fighter Two",
    roster_positions: ["FLEX"],  },
  {
    id: "f2",
    name: "Fighter Two",
    sport: "mma",
    salary: 7500,
    projection: 19,
    correlation_group: "card-1",
    bout: "Fighter One vs Fighter Two",
    roster_positions: ["FLEX"],  },
  {
    id: "f3",
    name: "Fighter Three",
    sport: "mma",
    salary: 6000,
    projection: 17,
    correlation_group: "card-1",
    bout: "Fighter Three vs Fighter Four",
    roster_positions: ["FLEX"],  },
  {
    id: "f4",
    name: "Fighter Four",
    sport: "mma",
    salary: 5500,
    projection: 14,
    correlation_group: "card-1",
    bout: "Fighter Three vs Fighter Four",
    roster_positions: ["FLEX"],  },
];

const golfPool: Player[] = [
  {
    id: "g1",
    name: "Golfer One",
    sport: "golf",
    salary: 9000,
    projection: 18,
    correlation_group: "tour-1",
    roster_positions: ["FLEX"],  },
];

describe("generateStacks — NBA/NFL", () => {
  it("puts only one team's players in a team stack, best player first", () => {
    const stacks = generateStacks(nbaPool, "nba");
    const teamStacks = stacks.filter((s) => s.kind === "team");
    expect(teamStacks.length).toBeGreaterThan(0);

    for (const stack of teamStacks) {
      const teams = new Set(stack.players.map((p) => p.team));
      expect(teams.size).toBe(1);
      expect(stack.scopeId).toBe([...teams][0]);
    }

    const bos = teamStacks.find((s) => s.scopeId === "BOS" && s.players.length === 3);
    expect(bos).toBeDefined();
    expect(bos?.players.map((p) => p.id)).toEqual(["b1", "b2", "b3"]);
    // The team's single best scorer leads the stack.
    expect(bos?.players[0].projection).toBe(52);
  });

  it("puts players from both sides of the game in a game stack", () => {
    const stacks = generateStacks(nbaPool, "nba");
    const gameStacks = stacks.filter((s) => s.kind === "game");
    expect(gameStacks.length).toBeGreaterThan(0);

    for (const stack of gameStacks) {
      const teams = new Set(stack.players.map((p) => p.team));
      expect(teams.size).toBeGreaterThan(1);
      const groups = new Set(stack.players.map((p) => p.correlation_group));
      expect(groups.size).toBe(1);
      expect(stack.scopeId).toBe([...groups][0]);
    }

    const twoMan = gameStacks.find((s) => s.players.length === 2);
    expect(twoMan?.players.map((p) => p.id).sort()).toEqual(["b1", "n1"]);
  });

  it("gives a team stack a team rule with the stack size as the minimum", () => {
    const stacks = generateStacks(nbaPool, "nba");
    const stack = stacks.find((s) => s.kind === "team" && s.scopeId === "BOS" && s.players.length === 2);
    expect(stack).toBeDefined();
    expect(stack?.rule.scope).toBe("team");
    expect(stack?.rule.id).toBe("BOS");
    expect(stack?.rule.min).toBe(2);
    expect(stack?.rule.max).toBeGreaterThanOrEqual(stack?.rule.min ?? 0);
  });

  it("gives a game stack a game rule keyed on the game", () => {
    const stacks = generateStacks(nbaPool, "nba");
    const stack = stacks.find((s) => s.kind === "game" && s.scopeId === "BOS@NE");
    expect(stack).toBeDefined();
    expect(stack?.rule.scope).toBe("game");
    expect(stack?.rule.id).toBe("BOS@NE");
    expect(stack?.rule.min).toBe(stack?.players.length);
    expect(stack?.rule.max).toBeGreaterThanOrEqual(stack?.rule.min ?? 0);
  });

  it("does not emit the same stack twice", () => {
    const stacks = generateStacks(nbaPool, "nba");
    const keys = stacks.map((s) => s.id);
    expect(new Set(keys).size).toBe(keys.length);

    const sets = stacks.map((s) => s.players.map((p) => p.id).sort().join("-"));
    expect(new Set(sets).size).toBe(sets.length);
  });

  it("leaves out players the user excluded", () => {
    const pool = nbaPool.map((p) =>
      p.id === "b2" ? { ...p, is_excluded: true } : p,
    );
    const stacks = generateStacks(pool, "nba");
    expect(stacks.some((s) => s.players.some((p) => p.id === "b2"))).toBe(false);
  });

  it("ranks stacks by combined projection, best first", () => {
    const stacks = generateStacks(nbaPool, "nba");
    for (let i = 1; i < stacks.length; i += 1) {
      expect(stacks[i - 1].projection).toBeGreaterThanOrEqual(stacks[i].projection);
    }
  });

  it("caps the number of stacks returned", () => {
    const stacks = generateStacks(nbaPool, "nba", { limit: 3 });
    expect(stacks.length).toBeLessThanOrEqual(3);
  });
});

describe("generateStacks — MMA", () => {
  it("only produces fight pairs when opponents are allowed", () => {
    const withoutOpponents = generateStacks(mmaPool, "mma");
    expect(withoutOpponents.some((s) => s.variant === "bout")).toBe(false);

    const withOpponents = generateStacks(mmaPool, "mma", { allowOpponents: true });
    const pairs = withOpponents.filter((s) => s.variant === "bout");
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.players).toHaveLength(2);
      expect(pair.players[0].bout).toBe(pair.players[1].bout);
    }
  });

  it("always produces card stacks", () => {
    const stacks = generateStacks(mmaPool, "mma");
    expect(stacks.some((s) => s.kind === "card")).toBe(true);
  });

  it("keeps both sides of one fight out of a card stack when opponents are not allowed", () => {
    const stacks = generateStacks(mmaPool, "mma");
    for (const stack of stacks) {
      const bouts = stack.players.map((p) => p.bout);
      expect(new Set(bouts).size).toBe(bouts.length);
    }
  });
});

describe("generateStacks — golf", () => {
  it("produces no stacks", () => {
    expect(generateStacks(golfPool, "golf")).toEqual([]);
  });
});
