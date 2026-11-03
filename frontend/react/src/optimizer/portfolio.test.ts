/**
 * Portfolio builder acceptance tests.
 *
 * The bug these guard against: the optimizer used to re-solve the MILP inside
 * an 8-second wall-clock budget, so asking for 150 lineups returned a
 * handful. These tests assert the full requested count comes back, that every
 * lineup is legal, and that the #1 lineup really is the optimum.
 */
import { describe, expect, it } from "vitest";

import { runOptimize } from "@/optimizer";
import { NBA_CLASSIC_SLOTS, NFL_CLASSIC_SLOTS } from "@/optimizer/sports";
import type { OptimizerSettings, Player } from "@/optimizer/types";

/** Deterministic PRNG so a failing test is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function nbaSlate(size: number): Player[] {
  const rand = rng(7);
  const positions = ["PG", "SG", "SF", "PF", "C"];
  const teams = ["BOS", "LAL", "GSW", "MIA", "NYK", "PHI", "DEN", "DAL"];
  const out: Player[] = [];
  for (let i = 0; i < size; i++) {
    const pos = positions[i % positions.length];
    const projection = Math.round(8 + rand() * 45);
    out.push({
      id: `p${i}`,
      name: `Player ${i}`,
      sport: "nba",
      salary: 3000 + Math.round(rand() * 7000),
      projection,
      team: teams[i % teams.length],
      opponent: teams[(i + 3) % teams.length],
      positions: [pos],
      rosterPositions: pos === "PG" || pos === "SG" ? [pos, "G"] : pos === "SF" || pos === "PF" ? [pos, "F"] : [pos],
      correlationGroup: `${teams[i % teams.length]}@${teams[(i + 3) % teams.length]}`,
    });
  }
  return out;
}

function nflSlate(size: number, withDst = true): Player[] {
  const rand = rng(11);
  const teams = ["BUF", "BAL", "PHI", "WAS", "DET", "MIN"];
  const out: Player[] = [];
  const spec: Array<[string, string[]]> = [
    ["QB", ["QB"]],
    ["RB", ["RB", "FLEX"]],
    ["WR", ["WR", "FLEX"]],
    ["TE", ["TE", "FLEX"]],
  ];
  for (let i = 0; i < size; i++) {
    const [pos, slots] = spec[i % spec.length];
    out.push({
      id: `n${i}`,
      name: `Player ${i}`,
      sport: "nfl",
      salary: 2800 + Math.round(rand() * 5500),
      projection: Math.round(5 + rand() * 25),
      team: teams[i % teams.length],
      opponent: teams[(i + 2) % teams.length],
      positions: [pos],
      rosterPositions: slots,
      correlationGroup: `${teams[i % teams.length]}@${teams[(i + 2) % teams.length]}`,
    });
  }
  if (withDst) {
    // One defence unit per team, as a DraftKings slate carries.
    teams.forEach((team, i) => {
      out.push({
        id: `n-dst-${i}`,
        name: `${team} Defense`,
        sport: "nfl",
        salary: 2200 + Math.round(rand() * 2000),
        projection: Math.round(4 + rand() * 6),
        team,
        opponent: teams[(i + 2) % teams.length],
        positions: ["DST"],
        rosterPositions: ["DST"],
        correlationGroup: `${team}@${teams[(i + 2) % teams.length]}`,
      });
    });
  }
  return out;
}

function settings(over: Partial<OptimizerSettings> = {}): OptimizerSettings {
  return {
    sport: "nba",
    strategy: "maxProjection",
    salaryCap: 50_000,
    numLineups: 20,
    simulationCount: 1_000,
    uniqueLineups: true,
    seed: 42,
    ...over,
  } as OptimizerSettings;
}

/** Every lineup must be legal: right slot count, no player twice, cap respected. */
function assertLegal(
  lineups: ReturnType<typeof runOptimize>["lineups"],
  players: Player[],
  slotCount: number,
  cap: number,
) {
  const seen = new Set<string>();
  for (const lineup of lineups) {
    expect(lineup.assignments).toHaveLength(slotCount);
    const ids = lineup.assignments.map((a) => a.playerId);
    expect(new Set(ids).size).toBe(slotCount);
    expect(lineup.totalSalary).toBeLessThanOrEqual(cap);
    expect(seen.has(lineup.uniqueKey)).toBe(false);
    seen.add(lineup.uniqueKey);
  }
}

describe("portfolio builder — complete lineup counts", () => {
  it("returns the full requested count for NBA (150 of 150)", () => {
    const players = nbaSlate(150);
    const result = runOptimize(settings({ numLineups: 150 }), players);
    expect(result.lineups).toHaveLength(150);
    assertLegal(result.lineups, players, NBA_CLASSIC_SLOTS.length, 50_000);
  });

  it("returns the full requested count for NBA (500 of 500)", () => {
    const players = nbaSlate(220);
    const result = runOptimize(settings({ numLineups: 500 }), players);
    expect(result.lineups).toHaveLength(500);
    assertLegal(result.lineups, players, NBA_CLASSIC_SLOTS.length, 50_000);
  });

  it("returns the full requested count for NFL (150 of 150)", () => {
    const players = nflSlate(140);
    const result = runOptimize(settings({ sport: "nfl", numLineups: 150 }), players);
    expect(result.lineups).toHaveLength(150);
    assertLegal(result.lineups, players, NFL_CLASSIC_SLOTS.length, 50_000);
  });

  it("drops a roster slot nobody can fill instead of returning nothing", () => {
    // No defence units on the slate — the DST slot cannot be filled, so the
    // lineup is eight strong instead of nine.
    const players = nflSlate(140, false);
    const result = runOptimize(settings({ sport: "nfl", numLineups: 150 }), players);
    expect(result.lineups.length).toBeGreaterThan(0);
    expect(result.lineups[0].assignments).toHaveLength(NFL_CLASSIC_SLOTS.length - 1);
    expect(result.warnings.join(" ")).toMatch(/roster slot/);
  });

  it("returns every lineup the pool can support at 2000 (never silently truncates)", () => {
    const players = nbaSlate(220);
    const result = runOptimize(settings({ numLineups: 2000 }), players);
    // The pool is finite, so the count is bounded — but it must be far above
    // the old handful, and any shortfall must be reported in the warnings.
    expect(result.lineups.length).toBeGreaterThan(500);
    expect(result.telemetry?.shortBy).toBe(result.telemetry?.requested! - result.lineups.length);
    if (result.lineups.length < 2000) {
      expect(result.warnings.join(" ")).toMatch(/produced \d+/);
    }
  });

  it("ranks lineups by descending projection", () => {
    const players = nbaSlate(150);
    const result = runOptimize(settings({ numLineups: 150 }), players);
    const scores = result.lineups.map((l) => l.totalProjection);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(result.lineups[0].rank).toBe(1);
  });

  it("finds the true optimum on a small pool (brute-force cross-check)", () => {
    const players = nbaSlate(24);
    const cap = 50_000;

    // Brute force every legal combination of 8 distinct players.
    // A set is only legal if it can fill PG, SG, SF, PF, C, G (PG or SG),
    // F (SF or PF) and UTIL.
    const legal = (picks: number[]): boolean => {
      const count = (pos: string) =>
        picks.filter((i) => (players[i].rosterPositions ?? []).includes(pos)).length;
      const pg = count("PG");
      const sg = count("SG");
      const sf = count("SF");
      const pf = count("PF");
      const c = count("C");
      return pg >= 1 && sg >= 1 && sf >= 1 && pf >= 1 && c >= 1 && pg + sg >= 2 && sf + pf >= 2;
    };

    let best = -Infinity;
    const n = players.length;
    const recurse = (start: number, salary: number, score: number, depth: number) => {
      if (depth === NBA_CLASSIC_SLOTS.length) {
        if (salary <= cap && legal(chosen)) best = Math.max(best, score);
        return;
      }
      for (let i = start; i < n; i++) {
        const s = salary + players[i].salary;
        if (s > cap) continue;
        chosen.push(i);
        recurse(i + 1, s, score + players[i].projection, depth + 1);
        chosen.pop();
      }
    };
    const chosen: number[] = [];
    recurse(0, 0, 0, 0);

    const result = runOptimize(settings({ numLineups: 10 }), players);
    expect(result.lineups[0].totalProjection).toBeCloseTo(best, 6);
  });

  it("honours the exposure cap", () => {
    const players = nbaSlate(150);
    const result = runOptimize(settings({ numLineups: 100, maxExposure: 40 }), players);
    expect(result.lineups).toHaveLength(100);
    const counts = new Map<string, number>();
    for (const lineup of result.lineups) {
      for (const a of lineup.assignments) {
        counts.set(a.playerId, (counts.get(a.playerId) ?? 0) + 1);
      }
    }
    for (const c of counts.values()) {
      expect(c / result.lineups.length).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it("keeps the full count when an exposure cap is set", () => {
    // The cap is a goal; the count is a requirement. A cap that quietly
    // trimmed the portfolio would be the old "5 out of 150" bug wearing a
    // different hat.
    const players = nflSlate(200);
    for (const maxExposure of [70, 50, 35]) {
      const result = runOptimize(
        settings({ sport: "nfl", numLineups: 150, maxExposure }),
        players,
      );
      expect(result.lineups).toHaveLength(150);
      const counts = new Map<string, number>();
      for (const lineup of result.lineups) {
        for (const a of lineup.assignments) {
          counts.set(a.playerId, (counts.get(a.playerId) ?? 0) + 1);
        }
      }
      for (const c of counts.values()) {
        expect(c / result.lineups.length).toBeLessThanOrEqual(maxExposure / 100 + 1e-9);
      }
    }
  });

  it("spreads the portfolio instead of repeating one build", () => {
    // A portfolio of 150 lineups that are all the same nine players is not
    // a portfolio. The projection spread has to be real.
    const players = nflSlate(200);
    const result = runOptimize(
      settings({ sport: "nfl", numLineups: 150, maxExposure: 50 }),
      players,
    );
    expect(result.lineups).toHaveLength(150);
    const projections = result.lineups.map((l) => l.totalProjection);
    const spread = Math.max(...projections) - Math.min(...projections);
    expect(spread).toBeGreaterThan(1);
  });

  it("repeats the single optimum when unique lineups are off", () => {
    const players = nbaSlate(60);
    const result = runOptimize(settings({ numLineups: 25, uniqueLineups: false }), players);
    expect(result.lineups).toHaveLength(25);
    expect(new Set(result.lineups.map((l) => l.uniqueKey)).size).toBe(1);
  });
});

/**
 * Stacking rules — the correlation lever a tournament portfolio needs.
 *
 * A rule is a hard constraint: the lineup either holds the players the rule
 * asks for, or it is not produced. A rule that cannot be met has to be
 * reported by name, never applied silently.
 */
describe("portfolio builder — stacking rules", () => {
  /** Rename a team across the slate so a rule can point at a known group. */
  function renameTeam(players: Player[], from: string, to: string): Player[] {
    return players.map((p) => {
      if (p.team !== from) return p;
      return {
        ...p,
        team: to,
        correlationGroup: p.correlationGroup?.replace(`${from}@`, `${to}@`),
      };
    });
  }

  /** The correlation group a player counts towards, matching the engine. */
  function groupOf(p: Player): string {
    if (p.correlationGroup) return p.correlationGroup;
    const m = (p.gameInfo ?? "").match(/([A-Z]{2,4}@[A-Z]{2,4})/);
    return m ? m[1] : "";
  }

  /** How many players of a lineup come from a given team. */
  function teamCount(lineup: { assignments: { playerId: string }[] }, byId: Map<string, Player>, team: string): number {
    return lineup.assignments.filter((a) => byId.get(a.playerId)?.team === team).length;
  }

  it("puts at least two players from the stacked team in every lineup", () => {
    const players = renameTeam(nbaSlate(150), "BOS", "AAA");
    const result = runOptimize(
      settings({
        numLineups: 20,
        stackRules: [{ scope: "team", id: "AAA", min: 2, max: 6 }],
      }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const lineup of result.lineups) {
      expect(teamCount(lineup, byId, "AAA")).toBeGreaterThanOrEqual(2);
    }
    expect(result.warnings.join(" ")).not.toMatch(/Stack rule/);
  });

  it("never puts more than the allowed number of players from a team in a lineup", () => {
    const players = renameTeam(nbaSlate(150), "BOS", "AAA");
    const result = runOptimize(
      settings({
        numLineups: 20,
        stackRules: [{ scope: "team", id: "AAA", min: 0, max: 1 }],
      }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const lineup of result.lineups) {
      expect(teamCount(lineup, byId, "AAA")).toBeLessThanOrEqual(1);
    }
    expect(result.warnings.join(" ")).not.toMatch(/Stack rule/);
  });

  it("counts game rules by correlation group", () => {
    const base = nbaSlate(150);
    const gameKey = base.find((p) => p.team === "MIA")?.correlationGroup ?? "";
    expect(gameKey).not.toBe("");
    // Half of the group carries the game in the free-text game info only,
    // so the engine has to fall back to parsing it out.
    let seen = 0;
    const players = base.map((p) => {
      if (p.team !== "MIA") return p;
      seen += 1;
      if (seen % 2 !== 0) return p;
      return {
        ...p,
        correlationGroup: undefined,
        gameInfo: `${gameKey} at United Center`,
      };
    });
    const result = runOptimize(
      settings({
        numLineups: 20,
        stackRules: [{ scope: "game", id: gameKey, min: 2, max: 4 }],
      }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const lineup of result.lineups) {
      const inGame = lineup.assignments.filter((a) => {
        const p = byId.get(a.playerId);
        return p ? groupOf(p) === gameKey : false;
      }).length;
      expect(inGame).toBeGreaterThanOrEqual(2);
    }
    expect(result.warnings.join(" ")).not.toMatch(/Stack rule/);
  });

  it("keeps the full count and names a rule that cannot be met", () => {
    const base = nbaSlate(150);
    // Only two players carry the ZZZ badge, so five of them can never be
    // in the same lineup.
    const players = base.map((p, i) =>
      i < 2 ? { ...p, team: "ZZZ", correlationGroup: "ZZZ@NE" } : p,
    );
    const result = runOptimize(
      settings({
        numLineups: 20,
        stackRules: [{ scope: "team", id: "ZZZ", min: 5, max: 6 }],
      }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const warnings = result.warnings.join(" ");
    expect(warnings).toMatch(/ZZZ/);
    expect(warnings).toMatch(/min 5/);
  });

  it("applies the legacy minimum per team as a stacking rule", () => {
    const players = renameTeam(nbaSlate(150), "BOS", "AAA");
    const result = runOptimize(
      settings({ numLineups: 20, globalMinPlayersPerTeam: 1 }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const byId = new Map(players.map((p) => [p.id, p]));
    const teamsInPool = new Set(
      players.map((p) => p.team).filter((t): t is string => !!t),
    );
    for (const lineup of result.lineups) {
      // Eight slots, eight teams in the slate: every lineup has to hold
      // one player from each of them.
      const teams = new Set(
        lineup.assignments.map((a) => byId.get(a.playerId)?.team),
      );
      expect(teams.size).toBe(teamsInPool.size);
      for (const team of teamsInPool) {
        expect(teamCount(lineup, byId, team)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("applies the legacy per-team controls as stacking rules", () => {
    const players = renameTeam(nbaSlate(150), "BOS", "AAA");
    const result = runOptimize(
      settings({ numLineups: 20, globalMaxPlayersPerTeam: 1 }),
      players,
    );
    expect(result.lineups).toHaveLength(20);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const lineup of result.lineups) {
      const teams = new Set(
        lineup.assignments.map((a) => byId.get(a.playerId)?.team),
      );
      for (const team of teams) {
        expect(teamCount(lineup, byId, team as string)).toBeLessThanOrEqual(1);
      }
    }
  });
});
