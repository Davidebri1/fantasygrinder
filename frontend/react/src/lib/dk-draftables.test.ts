import { describe, it, expect } from "vitest";

import { parseDraftables } from "./dk-draftables";

const fixture = {
  draftables: [
    {
      // Away side, normal entry.
      draftableId: 100,
      displayName: "Trevor Lawrence",
      position: "QB",
      salary: 15900,
      status: "None",
      isDisabled: false,
      playerImage160: "https://example.com/tl.png",
      teamAbbreviation: "JAX",
      competition: { name: "JAX @ BAL", startTime: "2026-11-06T01:15:00Z" },
      draftStatAttributes: [
        { id: 90, value: "20.7" },
        { id: -2, value: "18th" },
      ],
    },
    {
      // Home side, injury status, no FPPG attribute at all.
      draftableId: 101,
      displayName: "Lamar Jackson",
      position: "QB",
      salary: 9000,
      status: "OUT",
      isDisabled: false,
      teamAbbreviation: "BAL",
      competition: { name: "JAX @ BAL", startTime: "2026-11-06T01:15:00Z" },
      draftStatAttributes: [{ id: -2, value: "11th" }],
    },
    {
      // Disabled — must be skipped.
      draftableId: 102,
      displayName: "Invisible Man",
      position: "WR",
      salary: 2000,
      isDisabled: true,
      teamAbbreviation: "JAX",
      competition: { name: "JAX @ BAL" },
      draftStatAttributes: [{ id: 90, value: "12.0" }],
    },
  ],
};

describe("parseDraftables", () => {
  it("maps a normal draftable entry onto the Player shape", () => {
    const players = parseDraftables(JSON.stringify(fixture), "nfl");
    const tl = players.find((p) => p.id === "dk-100");
    expect(tl).toBeDefined();
    expect(tl!.name).toBe("Trevor Lawrence");
    expect(tl!.salary).toBe(15900);
    // Projection comes from the FPPG attribute (id 90).
    expect(tl!.projection).toBe(20.7);
    expect(tl!.projection_source).toBe("dk");
    expect(tl!.salary_source).toBe("dk");
    expect(tl!.sport).toBe("nfl");
    expect(tl!.positions).toEqual(["QB"]);
    expect(tl!.roster_positions).toEqual(["QB", "UTIL"]);
    expect(tl!.game_info).toBe("JAX @ BAL");
    expect(tl!.game_time).toBe("2026-11-06T01:15:00Z");
    expect(tl!.photo_url).toBe("https://example.com/tl.png");
  });

  it("parses the opponent for the away side and the home side", () => {
    const players = parseDraftables(JSON.stringify(fixture), "nfl");
    const away = players.find((p) => p.team === "JAX");
    const home = players.find((p) => p.team === "BAL");
    expect(away!.opponent).toBe("BAL");
    expect(home!.opponent).toBe("JAX");
  });

  it("maps a missing FPPG to a projection of 0", () => {
    const players = parseDraftables(JSON.stringify(fixture), "nfl");
    const lamar = players.find((p) => p.id === "dk-101");
    expect(lamar!.projection).toBe(0);
  });

  it("keeps an injury status and drops a status of None", () => {
    const players = parseDraftables(JSON.stringify(fixture), "nfl");
    const lamar = players.find((p) => p.id === "dk-101");
    const tl = players.find((p) => p.id === "dk-100");
    expect(lamar!.injury_status).toBe("OUT");
    expect(tl!.injury_status).toBeNull();
  });

  it("skips disabled entries", () => {
    const players = parseDraftables(JSON.stringify(fixture), "nfl");
    expect(players).toHaveLength(2);
    expect(players.some((p) => p.id === "dk-102")).toBe(false);
  });

  it("throws a plain message when no players can be read", () => {
    expect(() => parseDraftables(JSON.stringify({ draftables: [] }), "nfl")).toThrow(
      /No players found/,
    );
    expect(() => parseDraftables("not json", "nfl")).toThrow(/not valid DraftKings JSON/);
  });
});
