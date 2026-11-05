/**
 * Data provenance — the one place that says what is real and what is modelled.
 *
 * Fantasy Grinder pulls live player data from ESPN's public API. Everything
 * ESPN publishes is real: names, teams, positions, injuries, season averages,
 * live games, headshots.
 *
 * ESPN does NOT publish DraftKings salaries, DraftKings projections, or
 * DraftKings ownership percentages. Those three numbers are modelled here so
 * the optimizer has something to optimize against — and the UI says so
 * wherever they appear. They are never presented as DraftKings facts.
 *
 * This module exists so that "what is real?" has exactly one answer, and that
 * answer is visible to the customer rather than buried in a source file.
 */

/** Where a number came from. */
export type Provenance =
  | "espn-live" /** published by ESPN, live */
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
    label: "Projections",
    source:
      "Modelled — DraftKings scoring applied to this player's ESPN season averages",
    provenance: "modelled",
  },
  {
    label: "Salaries",
    source:
      "Modelled — $150 per projected point plus $800, snapped to $100, clamped to $3,000–$11,500. Not DraftKings prices.",
    provenance: "modelled",
  },
  {
    label: "Ownership",
    source:
      "Modelled — a projection percentile, used only to find contrarian leverage. Not a DraftKings number.",
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
 * The standing notice for modelled numbers. Shown wherever projections,
 * salaries or ownership appear.
 */
export const ESTIMATE_NOTICE =
  "Projections, salaries and ownership are modelled from live ESPN data — they are estimates, not DraftKings numbers.";

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
