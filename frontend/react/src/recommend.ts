/**
 * Smart Recommendations — "what should I enter?"
 *
 * The optimizer produces 20 candidate lineups. The customer asks "which
 * ones should I actually play?" — and the right answer depends on the
 * contest type, entry fee, and the user's max entries. This module
 * scores each candidate and returns the recommended N.
 *
 * Scoring model (intentionally simple, transparent, not a black box):
 *
 *   contest_type = "cash"   →  optimize raw projection (safety)
 *   contest_type = "gpp"    →  projection × diversity_bonus
 *                              where diversity = 1 - avg(overlap / 8)
 *                              across the rest of the entry set
 *   contest_type = "single" →  top projection only
 *
 * The function accepts the wire-format `Lineup` shape (snake_case)
 * because that's what the React store holds after the page converts
 * the in-browser optimizer output.
 */
import type { Lineup } from "@/types";

export type ContestType = "cash" | "gpp" | "single";

export interface ContestProfile {
  type: ContestType;
  entryFee: number;
  fieldSize: number;
  prizePool: number;
  bankroll: number;
}

export interface PickResult {
  lineup: Lineup;
  rank: number;
  score: number;
  estimatedRoi: number;
  reason: string;
}

const DK_TAKES: Record<ContestType, number> = {
  cash: 0.1,
  gpp: 0.15,
  single: 0.1,
};

function scoreLineup(lineup: Lineup, contest: ContestProfile, allLineups: Lineup[]): number {
  if (contest.type === "cash") {
    return lineup.total_projection;
  }
  if (contest.type === "single") {
    return lineup.total_projection;
  }
  // GPP: blend projection with uniqueness (low overlap with the rest of
  // the entry set = leverage on the field).
  const myPlayers = new Set(lineup.assignments.map((a) => a.player_id));
  let avgOverlap = 0;
  for (const other of allLineups) {
    if (other.unique_key === lineup.unique_key) continue;
    const otherPlayers = new Set(other.assignments.map((a) => a.player_id));
    let shared = 0;
    for (const p of myPlayers) if (otherPlayers.has(p)) shared += 1;
    avgOverlap += shared / Math.max(myPlayers.size, 1);
  }
  avgOverlap /= Math.max(allLineups.length - 1, 1);
  // Roster size drives how much overlap is possible — 8 for NBA, 9 for NFL.
  const diversity = 1 - avgOverlap / Math.max(myPlayers.size, 1);
  return lineup.total_projection * (1 + diversity);
}

function estimateRoi(lineup: Lineup, contest: ContestProfile): number {
  // Toy payout model: the median lineup wins the median payout
  // (entry_fee × fieldSize × (1 - rake)).
  const rake = DK_TAKES[contest.type];
  const grossPrizePool = contest.entryFee * contest.fieldSize;
  const netPrizePool = grossPrizePool * (1 - rake);
  const expectedPayout = netPrizePool * 0.05;
  const netProfit = expectedPayout - contest.entryFee;
  return netProfit / Math.max(contest.entryFee, 1);
}

export function recommendPicks(
  lineups: Lineup[],
  contest: ContestProfile,
  maxEntries: number = 20,
): PickResult[] {
  if (lineups.length === 0) return [];
  const affordableCount = Math.floor(contest.bankroll / Math.max(contest.entryFee, 1));
  const safeMax = Math.max(1, Math.min(maxEntries, lineups.length, affordableCount));

  const scored: PickResult[] = lineups.map((l, idx) => {
    const score = scoreLineup(l, contest, lineups);
    const roi = estimateRoi(l, contest);
    const reason =
      contest.type === "cash"
        ? "Highest projected floor — best for cash games"
        : contest.type === "single"
          ? "Best single-lineup projection"
          : `High projection × low overlap (${(score / l.total_projection).toFixed(2)}× leverage)`;
    return { lineup: l, rank: idx, score, estimatedRoi: roi, reason };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, safeMax);
}

export function buildContestPresets(sport: "nba" | "nfl" | "mma" | "golf"): ContestProfile[] {
  if (sport === "nba") {
    return [
      { type: "gpp", entryFee: 3, fieldSize: 1000, prizePool: 2500, bankroll: 30 },
      { type: "gpp", entryFee: 20, fieldSize: 500, prizePool: 9000, bankroll: 100 },
      { type: "cash", entryFee: 5, fieldSize: 100, prizePool: 475, bankroll: 50 },
      { type: "single", entryFee: 5, fieldSize: 100, prizePool: 475, bankroll: 10 },
    ];
  }
  if (sport === "nfl") {
    return [
      { type: "gpp", entryFee: 5, fieldSize: 1000, prizePool: 5000, bankroll: 50 },
      { type: "gpp", entryFee: 20, fieldSize: 500, prizePool: 10000, bankroll: 100 },
      { type: "cash", entryFee: 10, fieldSize: 100, prizePool: 950, bankroll: 50 },
      { type: "single", entryFee: 10, fieldSize: 100, prizePool: 950, bankroll: 10 },
    ];
  }
  if (sport === "mma") {
    return [
      { type: "gpp", entryFee: 5, fieldSize: 500, prizePool: 2200, bankroll: 50 },
      { type: "cash", entryFee: 3, fieldSize: 50, prizePool: 140, bankroll: 30 },
      { type: "single", entryFee: 3, fieldSize: 50, prizePool: 140, bankroll: 10 },
    ];
  }
  return [
    { type: "gpp", entryFee: 5, fieldSize: 800, prizePool: 3500, bankroll: 50 },
    { type: "cash", entryFee: 3, fieldSize: 80, prizePool: 220, bankroll: 30 },
    { type: "single", entryFee: 3, fieldSize: 80, prizePool: 220, bankroll: 10 },
  ];
}
