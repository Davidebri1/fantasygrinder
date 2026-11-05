/**
 * Tests for the entry-value model behind the "est. ROI" number.
 *
 * These exist because the previous model had a defect worth locking down: it
 * ignored the lineup entirely, so every pick in the list carried the same
 * ROI (4150% on a $3 GPP). A number that cannot tell a good pick from a bad
 * one is worse than no number, so the first test asserts that picks differ.
 */
import { describe, expect, it } from "vitest";

import {
  buildContestPresets,
  estimateEntryValue,
  recommendPicks,
  type ContestProfile,
} from "./recommend";
import type { Lineup } from "./types";

function lineup(rank: number, projection: number): Lineup {
  return {
    assignments: [
      { slot: "PG", score_multiplier: 1, player_id: `p${rank}a`, player_name: "A" },
      { slot: "SG", score_multiplier: 1, player_id: `p${rank}b`, player_name: "B" },
    ],
    strategy: "maxProjection",
    solver_backend: "pulp",
    rank,
    total_salary: 10_000,
    total_projection: projection,
    total_ceiling: projection * 1.1,
    teams: ["LAL"],
    games: ["LAL@SF"],
    unique_key: `key-${rank}`,
  };
}

const gpp: ContestProfile = {
  type: "gpp",
  entryFee: 20,
  fieldSize: 500,
  prizePool: 9000,
  bankroll: 100,
};

describe("estimateEntryValue", () => {
  it("gives different picks different numbers", () => {
    const pool = [
      lineup(1, 140),
      lineup(2, 120),
      lineup(3, 100),
      lineup(4, 80),
      lineup(5, 60),
    ];
    const best = estimateEntryValue(pool[0], gpp, pool);
    const worst = estimateEntryValue(pool[4], gpp, pool);
    expect(best.roi).not.toBeCloseTo(worst.roi, 5);
    expect(best.roi).toBeGreaterThan(worst.roi);
  });

  it("never returns an absurd ROI", () => {
    // The old model returned 4150% on a $3 GPP. A payout model that tops out
    // around 100% for a perfect entry is the ceiling we expect here.
    const pool = [lineup(1, 200), lineup(2, 150), lineup(3, 100)];
    const best = estimateEntryValue(pool[0], gpp, pool);
    expect(best.roi).toBeLessThan(5);
    expect(best.roi).toBeGreaterThan(-1);
  });

  it("keeps the modelled cash rate inside (0, 1)", () => {
    const pool = [lineup(1, 200), lineup(2, 150)];
    for (const l of pool) {
      const v = estimateEntryValue(l, gpp, pool);
      expect(v.cashRate).toBeGreaterThan(0);
      expect(v.cashRate).toBeLessThan(1);
    }
  });

  it("treats the median candidate as roughly break-even minus the rake", () => {
    // Ten candidates: the 5th and 6th sit at the median projection, so they
    // should be close to the break-even cash rate and close to break-even ROI.
    const pool = Array.from({ length: 10 }, (_, i) => lineup(i, 100 + i));
    const median = estimateEntryValue(pool[5], gpp, pool);
    expect(median.roi).toBeGreaterThan(-0.5);
    expect(median.roi).toBeLessThan(0.5);
  });
});

describe("recommendPicks", () => {
  it("returns picks whose ROI values are not all identical", () => {
    const pool = Array.from({ length: 8 }, (_, i) => lineup(i, 90 + i * 5));
    const picks = recommendPicks(pool, gpp, 8);
    const rois = new Set(picks.map((p) => p.estimatedRoi.toFixed(4)));
    expect(rois.size).toBeGreaterThan(1);
    for (const p of picks) {
      expect(p.estimatedCashRate).toBeGreaterThan(0);
      expect(p.estimatedCashRate).toBeLessThan(1);
    }
  });
});

describe("buildContestPresets", () => {
  it("returns presets that carry a prize pool for the payout model", () => {
    for (const sport of ["nba", "nfl", "mma", "golf"] as const) {
      for (const preset of buildContestPresets(sport)) {
        expect(preset.prizePool).toBeGreaterThan(0);
        expect(preset.entryFee).toBeGreaterThan(0);
        expect(preset.fieldSize).toBeGreaterThan(0);
      }
    }
  });
});
