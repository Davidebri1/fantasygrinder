import { describe, it, expect } from "vitest";

import { projectDave, welchT, type GameLog } from "./dave-projection";

/** Helper: build game logs from [score, factors] pairs. */
function games(rows: [number, Record<string, boolean | number | string>][]): GameLog[] {
  return rows.map(([score, factors], i) => ({
    date: "2026-10-" + String(1 + (i % 27)).padStart(2, "0"),
    score,
    factors,
  }));
}

/** Clean boom/bust: low half [2,4,4,6], high half [18,20,20,22], all high
 *  games at home, all low games away. Medians split cleanly (ties at 4 and
 *  20 stay inside their halves). */
const BOOM_BUST: [number, Record<string, boolean | number | string>][] = [
  [2, { isHome: false }],
  [4, { isHome: false }],
  [4, { isHome: false }],
  [6, { isHome: false }],
  [18, { isHome: true }],
  [20, { isHome: true }],
  [20, { isHome: true }],
  [22, { isHome: true }],
];

describe("welchT (hand-computed)", () => {
  it("matches the hand-worked two-sample result", () => {
    // [18,20,20,22] vs [2,4,4,6]: both variances 8/3, so
    // t = 16 / sqrt(8/12 + 8/12) = 16 / (2/sqrt(3)) = 8*sqrt(3) = 13.856...
    // df = (4/3)^2 / (2 * (2/3)^2 / 3) = 6.
    const { t, df } = welchT([18, 20, 20, 22], [2, 4, 4, 6]);
    expect(t).toBeCloseTo(13.8564, 3);
    expect(df).toBeCloseTo(6, 5);
  });

  it("returns t = 0 for identical samples", () => {
    const { t } = welchT([5, 5, 5], [5, 5, 5]);
    expect(t).toBe(0);
  });
});

describe("projectDave — clean boom/bust separation", () => {
  it("splits at the median and finds home/away as the factor", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.highMean).toBeCloseTo(20, 10);
    expect(r.lowMean).toBeCloseTo(4, 10);
    expect(r.factor).toBe("isHome");
    expect(r.sameMeans).toBe(false);
    expect(r.peeled).toEqual([]);
    expect(r.p).toBe(1);
  });

  it("P = 1 projects the high mean; P = 0 the low mean (his home-game example)", () => {
    const home = projectDave(games(BOOM_BUST), { isHome: true });
    expect(home.projection).toBeCloseTo(20, 10);

    const away = projectDave(games(BOOM_BUST), { isHome: false });
    expect(away.projection).toBeCloseTo(4, 10);
    expect(away.p).toBe(0);
  });

  it("handles the inverted direction: away games are the high games", () => {
    const rows: [number, Record<string, boolean | number | string>][] = [
      [2, { isHome: true }],
      [4, { isHome: true }],
      [4, { isHome: true }],
      [6, { isHome: true }],
      [18, { isHome: false }],
      [20, { isHome: false }],
      [20, { isHome: false }],
      [22, { isHome: false }],
    ];
    // The high side's condition is isHome = false.
    const away = projectDave(games(rows), { isHome: false });
    expect(away.factor).toBe("isHome");
    expect(away.p).toBe(1);
    expect(away.projection).toBeCloseTo(20, 10);

    const home = projectDave(games(rows), { isHome: true });
    expect(home.p).toBe(0);
    expect(home.projection).toBeCloseTo(4, 10);
  });

  it("detects a numeric factor and applies the midpoint rule", () => {
    const rows: [number, Record<string, boolean | number | string>][] = [
      [2, { passAttempts: 20, isHome: false }],
      [4, { passAttempts: 22, isHome: true }],
      [4, { passAttempts: 21, isHome: false }],
      [6, { passAttempts: 23, isHome: true }],
      [18, { passAttempts: 40, isHome: true }],
      [20, { passAttempts: 42, isHome: false }],
      [20, { passAttempts: 41, isHome: true }],
      [22, { passAttempts: 43, isHome: false }],
    ];
    // isHome is mixed (separation 0), passAttempts separates fully.
    const r = projectDave(games(rows), { passAttempts: 41 });
    expect(r.factor).toBe("passAttempts");
    expect(r.p).toBe(1); // 41 is above the midpoint 31.5
    expect(r.projection).toBeCloseTo(20, 10);

    const low = projectDave(games(rows), { passAttempts: 22 });
    expect(low.p).toBe(0);
    expect(low.projection).toBeCloseTo(4, 10);
  });

  it("detects a categorical factor (month)", () => {
    const rows: [number, Record<string, boolean | number | string>][] = [
      [2, { month: "September" }],
      [4, { month: "September" }],
      [4, { month: "September" }],
      [6, { month: "September" }],
      [18, { month: "December" }],
      [20, { month: "December" }],
      [20, { month: "December" }],
      [22, { month: "December" }],
    ];
    const r = projectDave(games(rows), { month: "December" });
    expect(r.factor).toBe("month");
    expect(r.p).toBe(1);
    expect(r.projection).toBeCloseTo(20, 10);
  });
});

describe("projectDave — the even-split floor (P = 0.5)", () => {
  it("uses P = 0.5 when the upcoming factor condition is unknown", () => {
    const r = projectDave(games(BOOM_BUST), {});
    expect(r.factor).toBe("isHome"); // still detected
    expect(r.p).toBe(0.5);
    expect(r.projection).toBeCloseTo(12, 10);
  });

  it("hand-checks the 90% interval at P = 0.5", () => {
    // var = 0.25*(8/3) + 0.25*(8/3) + 0.25*(16)^2 = 4/3 + 64 = 65.3333
    // sd = 8.0829, half width = 1.6449 * 8.0829 = 13.2957
    const r = projectDave(games(BOOM_BUST), {});
    expect(r.low90).toBeCloseTo(12 - 13.2957, 3);
    expect(r.high90).toBeCloseTo(12 + 13.2957, 3);
  });

  it("uses P = 0.5 when nothing separates the halves", () => {
    // isHome mixed in both halves, no other factors.
    const rows: [number, Record<string, boolean | number | string>][] = [
      [2, { isHome: false }],
      [4, { isHome: true }],
      [4, { isHome: false }],
      [6, { isHome: true }],
      [18, { isHome: false }],
      [20, { isHome: true }],
      [20, { isHome: false }],
      [22, { isHome: true }],
    ];
    const r = projectDave(games(rows), { isHome: true });
    expect(r.factor).toBeNull();
    expect(r.p).toBe(0.5);
    expect(r.projection).toBeCloseTo(12, 10);
  });
});

describe("projectDave — same halves -> raw average", () => {
  it("projects the raw average when Welch says the halves are one population", () => {
    // Sorted scores [0, 2, 14, 16 | 16, 16.2, 16.4, 16.6]: both halves pass
    // the skew/kurtosis test, and Welch's t = 8.3 / 4.0845 = 2.03 < 2.1.
    const rows: [number, Record<string, boolean | number | string>][] = [
      [0, { isHome: false }],
      [2, { isHome: false }],
      [14, { isHome: false }],
      [16, { isHome: false }],
      [16, { isHome: true }],
      [16.2, { isHome: true }],
      [16.4, { isHome: true }],
      [16.6, { isHome: true }],
    ];
    const r = projectDave(games(rows), { isHome: true });
    expect(r.sameMeans).toBe(true);
    expect(r.p).toBe(0.5);
    expect(r.factor).toBeNull();
    // Raw average of all eight games: (0+2+14+16+16+16.2+16.4+16.6) / 8.
    expect(r.projection).toBeCloseTo(97.2 / 8, 10);
  });

  it("projects the raw average for a truly flat player", () => {
    const rows: [number, Record<string, boolean | number | string>][] =
      new Array(8).fill(null).map(() => [10, { isHome: false }]);
    const r = projectDave(games(rows), { isHome: true });
    expect(r.sameMeans).toBe(true);
    expect(r.projection).toBe(10);
  });
});

describe("projectDave — normality and peeling", () => {
  it("peels the multimodal outlier from a non-normal half and reports it", () => {
    // High half [18,19,20,45] has skew 1.14 > 1; peeling 45 leaves the
    // symmetric [18,19,20] (skew 0, kurt -1.5). The 45 sits at index 7.
    const rows: [number, Record<string, boolean | number | string>][] = [
      [2, {}],
      [4, {}],
      [4, {}],
      [6, {}],
      [18, {}],
      [19, {}],
      [20, {}],
      [45, {}],
    ];
    const r = projectDave(games(rows), {});
    expect(r.peeled).toEqual([7]);
    expect(r.normality.high).toBe(true);
    expect(r.highMean).toBeCloseTo(19, 10);
    expect(r.lowMean).toBeCloseTo(4, 10);
    // No factors at all -> even-split floor over the post-peel means.
    expect(r.p).toBe(0.5);
    expect(r.projection).toBeCloseTo(11.5, 10);
  });

  it("does not peel a normal half", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.peeled).toEqual([]);
    expect(r.normality.high).toBe(true);
    expect(r.normality.low).toBe(true);
  });
});

describe("projectDave — interval sanity", () => {
  it("always contains the projection, and widens with P = 0.5 uncertainty", () => {
    const certain = projectDave(games(BOOM_BUST), { isHome: true });
    expect(certain.low90).toBeLessThanOrEqual(certain.projection);
    expect(certain.high90).toBeGreaterThanOrEqual(certain.projection);

    const uncertain = projectDave(games(BOOM_BUST), {});
    expect(uncertain.high90 - uncertain.low90).toBeGreaterThan(
      certain.high90 - certain.low90,
    );
  });

  it("hand-checks the 90% interval at P = 1", () => {
    // var = 1*(8/3) + 0 + 0 = 8/3, sd = 1.6330, half width = 2.6859
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.low90).toBeCloseTo(20 - 2.6859, 3);
    expect(r.high90).toBeCloseTo(20 + 2.6859, 3);
  });
});

describe("projectDave — guards", () => {
  it("refuses fewer than 4 games", () => {
    expect(() => projectDave(games([[10, {}], [12, {}], [8, {}]]))).toThrow(
      /at least 4/,
    );
  });
});
