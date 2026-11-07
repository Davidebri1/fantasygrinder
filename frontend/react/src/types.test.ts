/**
 * Smoke tests: ensure the optimizer API + frontend utilities
 * round-trip the wire format correctly.
 */
import { describe, expect, it } from "vitest";

import {
  OBJECTIVES,
  SIMULATION_MODES,
  strategyFromParts,
  DEFAULT_NBA_SETTINGS,
} from "@/types";

describe("OBJECTIVES", () => {
  it("has exactly 3 deterministic objectives", () => {
    expect(OBJECTIVES).toHaveLength(3);
    expect(OBJECTIVES.map((o) => o.value)).toEqual([
      "maxProjection",
      "balanced",
      "salaryCap",
    ]);
  });

  it("each objective has a label and description", () => {
    for (const o of OBJECTIVES) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(10);
    }
  });
});

describe("SIMULATION_MODES", () => {
  it("has off / monteCarlo, and nothing that needs ownership data", () => {
    expect(SIMULATION_MODES.map((m) => m.value)).toEqual(["off", "monteCarlo"]);
  });
});

describe("strategyFromParts", () => {
  it("maps deterministic objectives to themselves", () => {
    expect(strategyFromParts("maxProjection", "off")).toBe("maxProjection");
    expect(strategyFromParts("balanced", "off")).toBe("balanced");
    expect(strategyFromParts("salaryCap", "off")).toBe("salaryCap");
  });

  it("simulation modes override the objective name in the engine", () => {
    expect(strategyFromParts("maxProjection", "monteCarlo")).toBe("monteCarlo");
  });
});

describe("DEFAULT_NBA_SETTINGS", () => {
  it("defaults to Max Projection (deterministic), not Monte Carlo", () => {
    expect(DEFAULT_NBA_SETTINGS.strategy).toBe("maxProjection");
  });

  it("starts with sensible defaults", () => {
    expect(DEFAULT_NBA_SETTINGS.salary_cap).toBe(50_000);
    expect(DEFAULT_NBA_SETTINGS.num_lineups).toBe(20);
    expect(DEFAULT_NBA_SETTINGS.contest_type).toBe("classic");
    expect(DEFAULT_NBA_SETTINGS.simulation_count).toBe(1_000);
    expect(DEFAULT_NBA_SETTINGS.teammate_correlation).toBeCloseTo(0.35, 5);
  });
});
