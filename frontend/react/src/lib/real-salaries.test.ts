import { describe, expect, it } from "vitest";

import type { Player } from "@/types";
import { poolHasRealSalaries } from "./real-salaries";

/** A player as the ESPN live layer builds him: no salary at all. */
function espnShaped(overrides: Partial<Player> = {}): Player {
  return {
    id: "nba-123",
    name: "Live Player",
    sport: "nba",
    salary: 0,
    projection: 21.4,
    ...overrides,
  };
}

/** A player as the DraftKings draftables import builds him. */
function dkShaped(overrides: Partial<Player> = {}): Player {
  return {
    id: "dk-100",
    name: "Imported Player",
    sport: "nfl",
    salary: 9_400,
    projection: 18.2,
    salary_source: "dk",
    ...overrides,
  };
}

describe("poolHasRealSalaries", () => {
  it("an ESPN-shaped pool has no real salaries", () => {
    expect(poolHasRealSalaries([espnShaped(), espnShaped({ id: "nba-9" })])).toBe(false);
  });

  it("an ESPN-shaped player carries a salary of 0", () => {
    expect(espnShaped().salary).toBe(0);
    expect(espnShaped().salary_source).toBeUndefined();
  });

  it("a DraftKings-imported pool has real salaries", () => {
    expect(poolHasRealSalaries([dkShaped()])).toBe(true);
  });

  it("a nonzero salary counts as real even without the dk source tag", () => {
    expect(
      poolHasRealSalaries([espnShaped({ salary: 5_200 })]),
    ).toBe(true);
  });

  it("an empty pool has no real salaries", () => {
    expect(poolHasRealSalaries([])).toBe(false);
  });

  it("one dk player in a live pool is enough", () => {
    expect(poolHasRealSalaries([espnShaped(), dkShaped()])).toBe(true);
  });
});
