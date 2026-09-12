/**
 * Sample slates bundled into the static build. The customer sees real
 * player pools on first load — no DB import, no server call.
 */
import type { Player } from "./types";

const PROJECTIONS_SEED = 42;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const NBA_TEAMS: Array<[string, string, number, string[]]> = [
  ["LAL", "GSW", 0, ["LeBron James", "Anthony Davis", "Austin Reaves", "D'Angelo Russell", "Rui Hachimura"]],
  ["GSW", "LAL", 1, ["Stephen Curry", "Klay Thompson", "Andrew Wiggins", "Draymond Green", "Chris Paul"]],
  ["BOS", "MIA", 2, ["Jayson Tatum", "Jaylen Brown", "Derrick White", "Jrue Holiday", "Kristaps Porzingis"]],
  ["MIA", "BOS", 3, ["Jimmy Butler", "Bam Adebayo", "Tyler Herro", "Terry Rozier", "Caleb Martin"]],
  ["NYK", "PHI", 4, ["Jalen Brunson", "Julius Randle", "OG Anonoby", "Josh Hart", "Donte DiVincenzo"]],
  ["PHI", "NYK", 5, ["Joel Embiid", "Tyrese Maxey", "Tobias Harris", "Kelly Oubre Jr", "DeAnthony Melton"]],
];

const NBA_SALARY_BUCKETS = [3500, 4000, 4500, 5000, 5500, 6000, 7000, 8500, 10500];
const NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C"];

function rosterPositionsFor(pos: string): string[] {
  if (pos === "PG" || pos === "SG") return [pos, "G", "UTIL"];
  if (pos === "SF" || pos === "PF") return [pos, "F", "UTIL"];
  return [pos, "UTIL"];
}

export function buildNbaSample(): Player[] {
  const rand = rng(PROJECTIONS_SEED);
  const out: Player[] = [];
  for (const [teamA, teamB, idx, names] of NBA_TEAMS) {
    for (let offset = 0; offset < names.length; offset++) {
      const pos = NBA_POSITIONS[offset % 5];
      const team = offset < 5 ? teamA : teamB;
      const opponent = offset < 5 ? teamB : teamA;
      out.push({
        id: `nba-${idx}-${offset}`,
        name: names[offset],
        sport: "nba",
        salary: NBA_SALARY_BUCKETS[Math.floor(rand() * NBA_SALARY_BUCKETS.length)],
        projection: Math.round(15 + rand() * 45),
        team,
        opponent,
        gameInfo: `${teamA}@${teamB} 7:00pm ET`,
        positions: [pos],
        rosterPositions: rosterPositionsFor(pos),
        correlationGroup: `${teamA}@${teamB}`,
        projectedOwnership: Math.round(2 + rand() * 33),
      });
    }
  }
  return out;
}

const MMA_FIGHTERS: Array<[string, string, string]> = [
  ["Jon Jones", "Stipe Miocic", "Heavyweight"],
  ["Islam Makhachev", "Arman Tsarukyan", "Lightweight"],
  ["Sean O'Malley", "Merab Dvalishvili", "Bantamweight"],
  ["Alex Pereira", "Jiri Prochazka", "Light Heavyweight"],
  ["Dustin Poirier", "Max Holloway", "Lightweight"],
  ["Zhang Weili", "Tatiana Suarez", "Women's Strawweight"],
];
const MMA_SALARY_BUCKETS = [4500, 5500, 6500, 7500, 8500, 9500];

export function buildMmaSample(): Player[] {
  const rand = rng(PROJECTIONS_SEED + 1);
  const out: Player[] = [];
  MMA_FIGHTERS.forEach((pair, i) => {
    const [a, b, div] = pair;
    out.push({
      id: `mma-${i}-0`,
      name: a,
      sport: "mma",
      salary: MMA_SALARY_BUCKETS[Math.floor(rand() * MMA_SALARY_BUCKETS.length)],
      projection: Math.round(40 + rand() * 50),
      opponentId: `mma-${i}-1`,
      bout: `${a} vs ${b}`,
      projectedOwnership: Math.round(5 + rand() * 35),
    });
    out.push({
      id: `mma-${i}-1`,
      name: b,
      sport: "mma",
      salary: MMA_SALARY_BUCKETS[Math.floor(rand() * MMA_SALARY_BUCKETS.length)],
      projection: Math.round(40 + rand() * 50),
      opponentId: `mma-${i}-0`,
      bout: `${a} vs ${b}`,
      projectedOwnership: Math.round(5 + rand() * 35),
    });
    void div;
  });
  return out;
}

const GOLF_PLAYERS = [
  "Scottie Scheffler", "Rory McIlroy", "Jon Rahm", "Brooks Koepka",
  "Xander Schauffele", "Viktor Hovland", "Justin Thomas", "Collin Morikawa",
  "Tommy Fleetwood", "Wyndham Clark", "Ludvig Aberg", "Patrick Cantlay",
];
const GOLF_SALARY_BUCKETS = [6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000];

export function buildGolfSample(): Player[] {
  const rand = rng(PROJECTIONS_SEED + 2);
  return GOLF_PLAYERS.map((name, i) => ({
    id: `golf-${i}`,
    name,
    sport: "golf",
    salary: GOLF_SALARY_BUCKETS[Math.floor(rand() * GOLF_SALARY_BUCKETS.length)],
    projection: Math.round(45 + rand() * 50),
    projectedOwnership: Math.round(2 + rand() * 28),
  }));
}
