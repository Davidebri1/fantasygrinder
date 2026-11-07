import { describe, expect, it } from "vitest";

import type { Player } from "@/types";
import {
  salaryDisplay,
  salaryEstimateDisplay,
  salaryIsReal,
} from "./real-salaries";

/** A player with a real published DraftKings price. */
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

/** A player with no published price: the field is empty, not filled. */
function noPriceShaped(overrides: Partial<Player> = {}): Player {
  return {
    id: "nba-123",
    name: "Live Player",
    sport: "nba",
    salary: 0,
    projection: 21.4,
    ...overrides,
  };
}

describe("salary provenance", () => {
  it("a DraftKings import is real — bare price, no apology", () => {
    const d = salaryDisplay(dkShaped());
    expect(salaryIsReal(dkShaped())).toBe(true);
    expect(d.text).toBe("$9,400");
    expect(d.real).toBe(true);
  });

  it("a player with no price shows Pending, never a number", () => {
    const p = noPriceShaped();
    expect(salaryIsReal(p)).toBe(false);
    expect(p.salary).toBe(0);
    expect(salaryDisplay(p).text).toBe("Pending");
  });

  it("the modelled price lives in its own field, not the salary field", () => {
    const p = noPriceShaped({ salary_estimate: 4_000 });
    expect(p.salary).toBe(0);
    expect(salaryEstimateDisplay(p).text).toBe("$4,000");
    expect(salaryEstimateDisplay(p).present).toBe(true);
  });

  it("a real price has no estimate to show", () => {
    expect(salaryEstimateDisplay(dkShaped({ salary_estimate: 4_000 })).present).toBe(
      false,
    );
  });

  it("a pool without prices shows Pending on every row", () => {
    const pool = [noPriceShaped(), noPriceShaped({ id: "nba-9" })];
    expect(pool.every((p) => salaryDisplay(p).text === "Pending")).toBe(true);
  });
});
