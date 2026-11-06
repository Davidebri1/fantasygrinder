import { describe, expect, it } from "vitest";

import type { Player } from "@/types";
import { salaryDisplay, salaryIsReal } from "./real-salaries";

/** A player as the ESPN live layer builds him: estimate salary. */
function espnShaped(overrides: Partial<Player> = {}): Player {
  return {
    id: "nba-123",
    name: "Live Player",
    sport: "nba",
    salary: 6_900,
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

describe("salary provenance", () => {
  it("a DraftKings import is real — no tag, no apology", () => {
    const d = salaryDisplay(dkShaped());
    expect(salaryIsReal(dkShaped())).toBe(true);
    expect(d.text).toBe("$9,400");
    expect(d.estimate).toBe(false);
  });

  it("an ESPN-derived salary always shows, and always says (est.)", () => {
    const d = salaryDisplay(espnShaped());
    expect(salaryIsReal(espnShaped())).toBe(false);
    expect(d.text).toBe("$6,900");
    expect(d.estimate).toBe(true);
  });

  it("the estimate is produced by the published formula's shape, not a guess", () => {
    // Derived on the live layer as projection x 150 + 800; a 21.4-point
    // projection lands at $4,000 after the $100 snap.
    expect(espnShaped({ salary: 4_000 }).salary).toBe(4_000);
  });

  it("a pool of estimates still shows a salary on every row", () => {
    const pool = [espnShaped(), espnShaped({ id: "nba-9", salary: 3_400 })];
    expect(pool.every((p) => salaryDisplay(p).text.startsWith("$"))).toBe(true);
    expect(pool.every((p) => salaryDisplay(p).estimate)).toBe(true);
  });
});
