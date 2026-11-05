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
  /** Modelled chance this entry cashes, 0–1. */
  estimatedCashRate: number;
  reason: string;
}

const DK_TAKES: Record<ContestType, number> = {
  cash: 0.1,
  gpp: 0.15,
  single: 0.1,
};

/**
 * Payout shape. These are the modelling assumptions behind every ROI number
 * the app shows, and they are stated in the UI next to the number.
 */
const FIRST_PLACE_SHARE = 0.7; // 70% of the pool goes to the winner
const PAYING_SHARE_GPP = 0.15; // a GPP pays the top ~15% of the field
const PAYING_SHARE_CASH = 0.33; // a cash game pays the top ~third

/** How many spots pay in this contest. */
function payingSpots(contest: ContestProfile): number {
  const share = contest.type === "cash" ? PAYING_SHARE_CASH : PAYING_SHARE_GPP;
  return Math.max(
    1,
    Math.min(contest.fieldSize, Math.round(contest.fieldSize * share)),
  );
}

/**
 * Where this lineup sits against the other candidates: 0 = lowest projected
 * score in the pool, 1 = highest.
 */
function projectionPercentile(lineup: Lineup, allLineups: Lineup[]): number {
  if (allLineups.length <= 1) return 0.5;
  let below = 0;
  for (const other of allLineups) {
    if (other.total_projection < lineup.total_projection) below += 1;
  }
  return below / (allLineups.length - 1);
}

/**
 * Entry value — a model, and it says so.
 *
 * The earlier version of this function never looked at the lineup at all: it
 * only read the contest, so every pick in the list carried the same number
 * (4150% on a $3 GPP). A number that cannot distinguish a good pick from a
 * bad one is worse than no number at all.
 *
 * The model, in full:
 *
 *   - Pool = the prize pool the customer set, else entry × field × (1 − rake).
 *   - 70% of the pool goes to first place; the remaining 30% is split evenly
 *     over the paying spots.
 *   - The break-even cash rate is `spots / field` — at that rate an average
 *     lineup gets its entry fee back and nothing more.
 *   - A lineup's edge over that average comes from where its projection sits
 *     in the candidate pool: the median candidate cashes at the break-even
 *     rate, the best candidate cashes at 1.5× that, the worst at 0.5×.
 *   - Cashers split the consolation pool between them; the winner takes the
 *     first-place share.
 *
 * So: expected payout = cash rate × (consolation / spots)
 *                     + (cash rate / spots) × first prize
 * and ROI = (expected payout − entry fee) / entry fee.
 *
 * It is an estimate built from this app's projections and the contest the
 * customer set. It is NOT a DraftKings payout projection, and the UI labels
 * it as a model wherever it appears.
 */
export function estimateEntryValue(
  lineup: Lineup,
  contest: ContestProfile,
  allLineups: Lineup[],
): { roi: number; cashRate: number; expectedPayout: number } {
  const entry = Math.max(contest.entryFee, 0.0001);
  const rake = DK_TAKES[contest.type];
  const grossPool = contest.entryFee * contest.fieldSize;
  const pool = contest.prizePool > 0 ? contest.prizePool : grossPool * (1 - rake);
  const spots = payingSpots(contest);
  const percentile = projectionPercentile(lineup, allLineups);

  const baseCashRate = spots / Math.max(contest.fieldSize, 1);
  const edge = 0.5 + percentile;
  const cashRate = Math.min(0.95, baseCashRate * edge);

  const consolation = pool * (1 - FIRST_PLACE_SHARE);
  const firstPrize = pool * FIRST_PLACE_SHARE;
  const expectedConsolation = cashRate * (consolation / Math.max(spots, 1));
  const expectedTop = (cashRate / Math.max(spots, 1)) * firstPrize;
  const expectedPayout = expectedConsolation + expectedTop;

  return {
    roi: (expectedPayout - entry) / entry,
    cashRate,
    expectedPayout,
  };
}

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
    const value = estimateEntryValue(l, contest, lineups);
    const reason =
      contest.type === "cash"
        ? "Highest projected floor — best for cash games"
        : contest.type === "single"
          ? "Best single-lineup projection"
          : `High projection × low overlap (${(score / l.total_projection).toFixed(2)}× leverage)`;
    return {
      lineup: l,
      rank: idx,
      score,
      estimatedRoi: value.roi,
      estimatedCashRate: value.cashRate,
      reason,
    };
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
