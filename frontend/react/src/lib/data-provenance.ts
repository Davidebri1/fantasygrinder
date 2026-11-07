/**
 * Data provenance — the one place that says what is real and what is modelled.
 *
 * Outlier pulls live player data from ESPN's public API. Everything
 * ESPN publishes is real: names, teams, positions, injuries, season averages,
 * live games, headshots.
 *
 * DraftKings DOES publish salaries and projections. The app reads them from
 * a DraftKings slate, and every player who has one carries that real price.
 *
 * Where a price is missing, the salary field stays EMPTY — it says Pending.
 * The modelled price, if there is one, lives in its own field
 * (salary_estimate) and its own column, which the user can hide with one
 * click. It never reaches the solver and never appears on a lineup.
 *
 * Ownership is not modelled at all. Real ownership comes from DraftKings
 * contest entry data; until that exists, there is no ownership figure and
 * nothing that depends on one.
 *
 * This module exists so that "what is real?" has exactly one answer, and that
 * answer is visible to the customer rather than buried in a source file.
 */

/** Where a number came from. */
export type Provenance =
  | "espn-live" /** published by ESPN, live */
  | "draftkings" /** published by DraftKings */
  | "modelled" /** computed by this app from ESPN data */
  | "user-set" /** typed in by the customer */
  | "derived"; /** computed by the optimizer from the values above */

export interface DataFact {
  /** What this number is. */
  label: string;
  /** Where it comes from, in plain words. */
  source: string;
  provenance: Provenance;
}

export const DATA_FACTS: DataFact[] = [
  {
    label: "Player stats, teams, positions, injuries, games, headshots",
    source: "Live from the ESPN public API",
    provenance: "espn-live",
  },
  {
    label: "Salaries",
    source:
      "DraftKings' own published prices. A player with no published price shows Pending — the field stays empty rather than holding an estimate.",
    provenance: "draftkings",
  },
  {
    label: "Estimated salaries",
    source:
      "Modelled, and kept in its own field (salary_estimate). It never reaches the solver and never appears on a lineup. Hide the column with one click.",
    provenance: "modelled",
  },
  {
    label: "Projections",
    source:
      "DraftKings' own published projections where the slate has them; otherwise modelled from this player's ESPN season averages.",
    provenance: "modelled",
  },
  {
    label: "Prize pool, field size, entry fee, bankroll",
    source: "You set these in the app",
    provenance: "user-set",
  },
  {
    label: "Lineups, exposure, stacks, ROI estimate",
    source: "Computed by the in-browser optimizer from the values above",
    provenance: "derived",
  },
];

/**
 * The standing notice for modelled numbers. Shown wherever projections
 * appear.
 */
export const ESTIMATE_NOTICE =
  "Salaries are DraftKings' own published prices; a player with no published price says Pending, and the modelled price sits in its own 'Est. salary' column. Projections are modelled from live ESPN data unless the slate carries DraftKings' own.";

/**
 * What the app says when a slate has no published prices at all. It is the
 * difference between a tool that will do its job and one that cannot.
 */
export const PRICES_MISSING_NOTICE =
  "This slate has no published DraftKings prices. Without a real price there is no salary cap to balance and no lineup worth entering. Import the DraftKings file for this slate, or wait for the DraftKings slate to load.";

/**
 * The notice for a sample roster. Loud on purpose: the customer must never
 * mistake a sample slate for a live one and enter lineups built from it.
 */
export const SAMPLE_NOTICE =
  "Sample roster — the live ESPN feed could not be reached, so this player pool is a bundled sample. Lineups built from it are for demonstration only. Do not enter them.";

/**
 * What the ROI number is and is not.
 */
export const ROI_NOTICE =
  "Est. ROI is a model estimate: this app's projections, your contest settings, and a payout model that puts 70% of the pool on first place. It is not a DraftKings payout projection and not a guarantee.";
