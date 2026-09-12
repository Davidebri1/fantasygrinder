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
  ["NYK", "PHI", 4, ["Jalen Brunson", "Julius Randle", "OG Anunoby", "Josh Hart", "Donte DiVincenzo"]],
  ["PHI", "NYK", 5, ["Joel Embiid", "Tyrese Maxey", "Tobias Harris", "Kelly Oubre Jr", "De'Anthony Melton"]],
];

// Player name → CDN headshot URL. Powers athlete photos without a search hop.
const NBA_HEADSHOT_URLS: Record<string, string> = {
  "LeBron James": "https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png",
  "Anthony Davis": "https://cdn.nba.com/headshots/nba/latest/1040x760/203076.png",
  "Austin Reaves": "https://cdn.nba.com/headshots/nba/latest/1040x760/1630559.png",
  "D'Angelo Russell": "https://cdn.nba.com/headshots/nba/latest/1040x760/1626156.png",
  "Rui Hachimura": "https://cdn.nba.com/headshots/nba/latest/1040x760/1629060.png",
  "Stephen Curry": "https://cdn.nba.com/headshots/nba/latest/1040x760/201939.png",
  "Klay Thompson": "https://cdn.nba.com/headshots/nba/latest/1040x760/202691.png",
  "Andrew Wiggins": "https://cdn.nba.com/headshots/nba/latest/1040x760/203952.png",
  "Draymond Green": "https://cdn.nba.com/headshots/nba/latest/1040x760/203110.png",
  "Chris Paul": "https://cdn.nba.com/headshots/nba/latest/1040x760/101108.png",
  "Jayson Tatum": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628369.png",
  "Jaylen Brown": "https://cdn.nba.com/headshots/nba/latest/1040x760/1627759.png",
  "Derrick White": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628401.png",
  "Jrue Holiday": "https://cdn.nba.com/headshots/nba/latest/1040x760/201950.png",
  "Kristaps Porzingis": "https://cdn.nba.com/headshots/nba/latest/1040x760/204001.png",
  "Jimmy Butler": "https://cdn.nba.com/headshots/nba/latest/1040x760/202710.png",
  "Bam Adebayo": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628389.png",
  "Tyler Herro": "https://cdn.nba.com/headshots/nba/latest/1040x760/1629639.png",
  "Terry Rozier": "https://cdn.nba.com/headshots/nba/latest/1040x760/1626179.png",
  "Caleb Martin": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628997.png",
  "Jalen Brunson": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628973.png",
  "Julius Randle": "https://cdn.nba.com/headshots/nba/latest/1040x760/203944.png",
  "OG Anunoby": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628384.png",
  "Josh Hart": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628404.png",
  "Donte DiVincenzo": "https://cdn.nba.com/headshots/nba/latest/1040x760/1628978.png",
  "Joel Embiid": "https://cdn.nba.com/headshots/nba/latest/1040x760/203954.png",
  "Tyrese Maxey": "https://cdn.nba.com/headshots/nba/latest/1040x760/1630178.png",
  "Tobias Harris": "https://cdn.nba.com/headshots/nba/latest/1040x760/202699.png",
  "Kelly Oubre Jr": "https://cdn.nba.com/headshots/nba/latest/1040x760/1626162.png",
  "De'Anthony Melton": "https://a.espncdn.com/i/headshots/nba/players/full/4066436.png",
};

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
      const headshotUrl = NBA_HEADSHOT_URLS[names[offset]];
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
        photoUrl: headshotUrl,
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
  ["Charles Oliveira", "Michael Chandler", "Lightweight"],
  ["Ilia Topuria", "Justin Gaethje", "Lightweight"],
  ["Dricus Du Plessis", "Sean Strickland", "Middleweight"],
  ["Israel Adesanya", "Khamzat Chimaev", "Middleweight"],
  ["Leon Edwards", "Belal Muhammad", "Welterweight"],
  ["Tom Aspinall", "Ciryl Gane", "Heavyweight"],
  ["Alexander Volkanovski", "Aljamain Sterling", "Featherweight"],
  ["Petr Yan", "Cory Sandhagen", "Bantamweight"],
  ["Amanda Nunes", "Kayla Harrison", "Women's Bantamweight"],
  ["Valentina Shevchenko", "Alexa Grasso", "Women's Flyweight"],
];
const MMA_SALARY_BUCKETS = [4500, 5500, 6500, 7500, 8500, 9500];

// ESPN CDN headshots — confirmed by athlete id for each fighter.
const MMA_HEADSHOT_URLS: Record<string, string> = {
  "Jon Jones": "https://a.espncdn.com/i/headshots/mma/players/full/2335639.png",
  "Stipe Miocic": "https://a.espncdn.com/i/headshots/mma/players/full/2504951.png",
  "Islam Makhachev": "https://a.espncdn.com/i/headshots/mma/players/full/3332412.png",
  "Arman Tsarukyan": "https://a.espncdn.com/i/headshots/mma/players/full/4419372.png",
  "Sean O'Malley": "https://a.espncdn.com/i/headshots/mma/players/full/4205093.png",
  "Merab Dvalishvili": "https://a.espncdn.com/i/headshots/mma/players/full/3948572.png",
  "Alex Pereira": "https://a.espncdn.com/i/headshots/mma/players/full/4705658.png",
  "Jiri Prochazka": "https://a.espncdn.com/i/headshots/mma/players/full/3156612.png",
  "Dustin Poirier": "https://a.espncdn.com/i/headshots/mma/players/full/2506549.png",
  "Max Holloway": "https://a.espncdn.com/i/headshots/mma/players/full/2614933.png",
  "Zhang Weili": "https://a.espncdn.com/i/headshots/mma/players/full/4350762.png",
  "Tatiana Suarez": "https://a.espncdn.com/i/headshots/mma/players/full/4020435.png",
  "Charles Oliveira": "https://a.espncdn.com/i/headshots/mma/players/full/2504169.png",
  "Michael Chandler": "https://a.espncdn.com/i/headshots/mma/players/full/2504988.png",
  "Ilia Topuria": "https://a.espncdn.com/i/headshots/mma/players/full/4350812.png",
  "Justin Gaethje": "https://a.espncdn.com/i/headshots/mma/players/full/3022345.png",
  "Dricus Du Plessis": "https://a.espncdn.com/i/headshots/mma/players/full/3166126.png",
  "Sean Strickland": "https://a.espncdn.com/i/headshots/mma/players/full/3093653.png",
  "Israel Adesanya": "https://a.espncdn.com/i/headshots/mma/players/full/4285679.png",
  "Khamzat Chimaev": "https://a.espncdn.com/i/headshots/mma/players/full/4684751.png",
  "Leon Edwards": "https://a.espncdn.com/i/headshots/mma/players/full/3152929.png",
  "Belal Muhammad": "https://a.espncdn.com/i/headshots/mma/players/full/3172112.png",
  "Tom Aspinall": "https://a.espncdn.com/i/headshots/mma/players/full/4010976.png",
  "Ciryl Gane": "https://a.espncdn.com/i/headshots/mma/players/full/4426000.png",
  "Alexander Volkanovski": "https://a.espncdn.com/i/headshots/mma/players/full/3949584.png",
  "Aljamain Sterling": "https://a.espncdn.com/i/headshots/mma/players/full/3031559.png",
  "Petr Yan": "https://a.espncdn.com/i/headshots/mma/players/full/4293517.png",
  "Cory Sandhagen": "https://a.espncdn.com/i/headshots/mma/players/full/4294504.png",
  "Amanda Nunes": "https://a.espncdn.com/i/headshots/mma/players/full/2516131.png",
  "Valentina Shevchenko": "https://a.espncdn.com/i/headshots/mma/players/full/2554705.png",
  "Alexa Grasso": "https://a.espncdn.com/i/headshots/mma/players/full/3136287.png",
  "Kayla Harrison": "https://a.espncdn.com/i/headshots/mma/players/full/4332765.png",
};

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
      photoUrl: MMA_HEADSHOT_URLS[a],
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
      photoUrl: MMA_HEADSHOT_URLS[b],
    });
    void div;
  });
  return out;
}

const GOLF_PLAYERS = [
  "Scottie Scheffler", "Rory McIlroy", "Jon Rahm", "Brooks Koepka",
  "Xander Schauffele", "Viktor Hovland", "Jordan Spieth", "Collin Morikawa",
  "Tommy Fleetwood", "Wyndham Clark", "Ludvig Aberg", "Patrick Cantlay",
  "Tony Finau", "Sam Burns", "Justin Rose", "Shane Lowry",
  "Sepp Straka", "Keegan Bradley", "Cameron Smith", "Joaquin Niemann",
  "Tyrrell Hatton", "Matt Fitzpatrick", "Russell Henley", "Sungjae Im",
  "Corey Conners", "Si Woo Kim", "Jason Day", "Adam Scott",
  "Sahith Theegala", "Max Homa", "Cameron Young", "Hideki Matsuyama",
];
const GOLF_SALARY_BUCKETS = [6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000];

// ESPN CDN headshots — confirmed by athlete id for each golfer.
const GOLF_HEADSHOT_URLS: Record<string, string> = {
  "Scottie Scheffler": "https://a.espncdn.com/i/headshots/golf/players/full/9478.png",
  "Rory McIlroy": "https://a.espncdn.com/i/headshots/golf/players/full/3470.png",
  "Jon Rahm": "https://a.espncdn.com/i/headshots/golf/players/full/9780.png",
  "Brooks Koepka": "https://a.espncdn.com/i/headshots/golf/players/full/6798.png",
  "Xander Schauffele": "https://a.espncdn.com/i/headshots/golf/players/full/10140.png",
  "Viktor Hovland": "https://a.espncdn.com/i/headshots/golf/players/full/4364873.png",
  "Jordan Spieth": "https://a.espncdn.com/i/headshots/golf/players/full/5467.png",
  "Collin Morikawa": "https://a.espncdn.com/i/headshots/golf/players/full/10592.png",
  "Tommy Fleetwood": "https://a.espncdn.com/i/headshots/golf/players/full/5539.png",
  "Wyndham Clark": "https://a.espncdn.com/i/headshots/golf/players/full/11119.png",
  "Ludvig Aberg": "https://a.espncdn.com/i/headshots/golf/players/full/4375972.png",
  "Patrick Cantlay": "https://a.espncdn.com/i/headshots/golf/players/full/6007.png",
  "Tony Finau": "https://a.espncdn.com/i/headshots/golf/players/full/2230.png",
  "Sam Burns": "https://a.espncdn.com/i/headshots/golf/players/full/9938.png",
  "Justin Rose": "https://a.espncdn.com/i/headshots/golf/players/full/569.png",
  "Shane Lowry": "https://a.espncdn.com/i/headshots/golf/players/full/4587.png",
  "Sepp Straka": "https://a.espncdn.com/i/headshots/golf/players/full/8961.png",
  "Keegan Bradley": "https://a.espncdn.com/i/headshots/golf/players/full/4513.png",
  "Cameron Smith": "https://a.espncdn.com/i/headshots/golf/players/full/9131.png",
  "Joaquin Niemann": "https://a.espncdn.com/i/headshots/golf/players/full/11099.png",
  "Tyrrell Hatton": "https://a.espncdn.com/i/headshots/golf/players/full/5553.png",
  "Matt Fitzpatrick": "https://a.espncdn.com/i/headshots/golf/players/full/9037.png",
  "Russell Henley": "https://a.espncdn.com/i/headshots/golf/players/full/5409.png",
  "Sungjae Im": "https://a.espncdn.com/i/headshots/golf/players/full/11382.png",
  "Corey Conners": "https://a.espncdn.com/i/headshots/golf/players/full/9126.png",
  "Si Woo Kim": "https://a.espncdn.com/i/headshots/golf/players/full/7081.png",
  "Jason Day": "https://a.espncdn.com/i/headshots/golf/players/full/1680.png",
  "Adam Scott": "https://a.espncdn.com/i/headshots/golf/players/full/388.png",
  "Sahith Theegala": "https://a.espncdn.com/i/headshots/golf/players/full/10980.png",
  "Max Homa": "https://a.espncdn.com/i/headshots/golf/players/full/8973.png",
  "Cameron Young": "https://a.espncdn.com/i/headshots/golf/players/full/4425906.png",
  "Hideki Matsuyama": "https://a.espncdn.com/i/headshots/golf/players/full/5860.png",
};

export function buildGolfSample(): Player[] {
  const rand = rng(PROJECTIONS_SEED + 2);
  return GOLF_PLAYERS.map((name, i) => ({
    id: `golf-${i}`,
    name,
    sport: "golf",
    salary: GOLF_SALARY_BUCKETS[Math.floor(rand() * GOLF_SALARY_BUCKETS.length)],
    projection: Math.round(45 + rand() * 50),
    projectedOwnership: Math.round(2 + rand() * 28),
    photoUrl: GOLF_HEADSHOT_URLS[name],
  }));
}

/**
 * Every sample athlete's headshot, keyed by lowercased name. The store
 * seeds this into the headshot cache on load so any player who appears
 * in a lineup — not just the pool — shows their photo instantly.
 */
export function sampleHeadshotCache(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, url] of Object.entries(NBA_HEADSHOT_URLS)) entries[name.toLowerCase()] = url;
  for (const [name, url] of Object.entries(MMA_HEADSHOT_URLS)) entries[name.toLowerCase()] = url;
  for (const [name, url] of Object.entries(GOLF_HEADSHOT_URLS)) entries[name.toLowerCase()] = url;
  return entries;
}
