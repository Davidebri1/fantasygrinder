/**
 * Dave's projection model — implemented exactly as written in
 * "docs/DFS Projection Model.md" (the source of truth, verbatim).
 *
 * The method, in his words and ours:
 *
 * 1. Split a player's completed games into HIGH and LOW halves by score.
 *    His doc: "this cut off can be decided any way you like" — we use the
 *    median (the defensible choice: no score dominates the cut, and the two
 *    halves stay balanced as games accumulate). Every game is classified:
 *    with an odd count the middle game joins the LOW half, respecting the
 *    floor side he emphasises.
 *
 * 2. Mean of each half, "regardless of opponent".
 *
 * 3. Normality per half, computed directly (no stats library): skewness and
 *    excess kurtosis from the half's central moments. A half is flagged
 *    non-normal when |skew| > 1 or |excess kurtosis| > 2 — thresholds chosen
 *    to be honest at these tiny sample sizes (a half of 3 symmetric points
 *    has excess kurtosis -1.5, so it passes; anything visibly lumpy fails).
 *    If a half is non-normal, peel the single most extreme point (largest
 *    |z| — his "multimodal data, the peaks that don't belong"), re-test, and
 *    repeat at most twice per half. Peeled games are reported by index.
 *
 * 4. THE FACTOR. For each factor key present in the data, measure how
 *    strongly it separates the high half from the low half:
 *      - boolean factor:  P(present | high) vs P(present | low)
 *      - categorical:     best single value v, P(v | high) vs P(v | low)
 *      - numeric factor:  standardised mean difference (Cohen's d between
 *        the halves' factor values), squashed to a 0..1 scale via d/(d+1)
 *        so it can be ranked against probability separations.
 *    Pick the single factor with the largest separation (his doc: "you
 *    simply pick one of them (not multiple) and test that"). Ties break
 *    alphabetically for determinism.
 *
 * 5. P for the upcoming game — the probability the HIGH side's factor
 *    condition holds in the upcoming game, from its known conditions:
 *      - boolean/categorical: the upcoming value matches the high side's
 *        condition -> P = 1; it does not -> P = 0; the condition is not
 *        known for the upcoming game -> P = 0.5.
 *      - numeric: let the midpoint be halfway between the halves' factor
 *        means. The upcoming value on the high half's side of the midpoint
 *        -> P = 1; on the low side -> P = 0; exactly at the midpoint or
 *        unknown -> P = 0.5.
 *    If the halves are the same population (step 6) or nothing separates
 *    them, P = 0.5 — his "even split ... as the floor": "half high half low
 *    = total projection".
 *
 * 6. SAMENESS. Welch's t-test implemented directly (t statistic +
 *    Welch-Satterthwaite degrees of freedom, sample variances). His doc:
 *    "you test them against one another for sameness; they shouldn't be the
 *    same. if they are, you project using the raw average of the two
 *    samples." We treat |t| < 2.1 as "same" (about the two-sided 95%
 *    critical value at these small degrees of freedom) so the projection is
 *    the raw average of all (post-peel) games and no factor is applied.
 *
 * 7. PROJECTION = highMean x P + lowMean x (1 - P), exactly his formula
 *    ("High scoring: high outlier group average x % probability of
 *    occurrence in upcoming game + normal group average x (1 - %)"), using
 *    the post-peel means. The 90% confidence interval combines the two
 *    halves' variances weighted by P and (1-P), plus the between-half term
 *    P(1-P)(highMean - lowMean)^2 — the variance of a two-component
 *    mixture. That between-half term is what lets the interval respect
 *    boom/bust, which is the entire point of the model; without it a P of
 *    0.5 across two very different halves would report an absurdly narrow
 *    interval. The multiplier is the normal 90% quantile (1.645); with
 *    halves this small that is anticonservative, which we state rather than
 *    hide.
 */

/** One completed game. score = DraftKings fantasy points for that game;
 *  factors = objective conditions of that game (isHome, month, passAttempts...). */
export interface GameLog {
  date: string;
  score: number;
  factors: Record<string, boolean | number | string | undefined>;
}

export interface DaveProjection {
  /** highMean x P + lowMean x (1 - P), post-peel. */
  projection: number;
  low90: number;
  high90: number;
  highMean: number;
  lowMean: number;
  /** The factor key that won separation, or null (same halves / none found). */
  factor: string | null;
  /** Probability of the high side's factor condition in the upcoming game. */
  p: number;
  /** Original indices of games peeled as multimodal outliers. */
  peeled: number[];
  /** Welch's t said the two halves are one population -> raw-average path. */
  sameMeans: boolean;
  /** Post-peel verdict per half: true = passed the skew/kurtosis test. */
  normality: { high: boolean; low: boolean };
  /** How the winning factor separates the halves (null when no factor used). */
  factorDetail: {
    /** The condition that marks the HIGH side (numeric: the midpoint rule). */
    condition: string;
    highFraction: number;
    lowFraction: number;
  } | null;
}

/** |t| below this -> the halves are the same population (see module doc). */
const SAME_T = 2.1;
/** Normality thresholds: |skew| > 1 or |excess kurtosis| > 2 -> non-normal. */
const SKEW_LIMIT = 1;
const KURT_LIMIT = 2;
/** At most two peels per half ("repeat at most twice"). */
const MAX_PEELS = 2;
/** Normal 90% quantile for the interval. */
const Z90 = 1.6449;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n - 1 denominator). */
function sampleVariance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

/** Central-moment skewness and excess kurtosis, computed directly. */
function skewKurt(xs: number[]): { skew: number; kurt: number } {
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= xs.length;
  m3 /= xs.length;
  m4 /= xs.length;
  if (m2 === 0) return { skew: 0, kurt: 0 };
  return { skew: m3 / Math.pow(m2, 1.5), kurt: m4 / (m2 * m2) - 3 };
}

function isNormal(xs: number[]): boolean {
  const { skew, kurt } = skewKurt(xs);
  return Math.abs(skew) <= SKEW_LIMIT && Math.abs(kurt) <= KURT_LIMIT;
}

/** Welch's t statistic and Welch-Satterthwaite df, computed directly. */
export function welchT(a: number[], b: number[]): { t: number; df: number } {
  const nA = a.length;
  const nB = b.length;
  const mA = mean(a);
  const mB = mean(b);
  const vA = sampleVariance(a);
  const vB = sampleVariance(b);
  const se2 = vA / nA + vB / nB;
  if (se2 === 0) return { t: 0, df: Math.min(nA, nB) - 1 };
  const df =
    (se2 * se2) /
    ((vA / nA) * (vA / nA) / (nA - 1) + (vB / nB) * (vB / nB) / (nB - 1));
  return { t: (mA - mB) / Math.sqrt(se2), df };
}

interface Split {
  low: { game: GameLog; index: number }[];
  high: { game: GameLog; index: number }[];
}

/**
 * Median split. His doc: "this cut off can be decided any way you like".
 * Every game is classified — with an odd count the middle game joins the
 * LOW half (the floor side).
 */
function medianSplit(games: GameLog[]): Split {
  const sorted = games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => a.game.score - b.game.score);
  const mid = Math.floor(sorted.length / 2);
  const lowEnd = sorted.length % 2 === 0 ? mid : mid + 1;
  return { low: sorted.slice(0, lowEnd), high: sorted.slice(lowEnd) };
}

/**
 * Peel the multimodal outlier (largest |z|) from a non-normal half, at most
 * MAX_PEELS times, never shrinking the half below 3 points (a 3-point
 * symmetric half is the smallest that can pass the normality test).
 */
function peelOutliers(
  entries: { game: GameLog; index: number }[],
): { kept: { game: GameLog; index: number }[]; peeled: number[] } {
  const kept = [...entries];
  const peeled: number[] = [];
  for (let pass = 0; pass < MAX_PEELS; pass++) {
    if (kept.length <= 3) break;
    if (isNormal(kept.map((e) => e.game.score))) break;
    const m = mean(kept.map((e) => e.game.score));
    const sd = Math.sqrt(sampleVariance(kept.map((e) => e.game.score)));
    let worst = 0;
    let worstZ = -1;
    kept.forEach((e, i) => {
      const z = sd === 0 ? 0 : Math.abs(e.game.score - m) / sd;
      if (z > worstZ) {
        worstZ = z;
        worst = i;
      }
    });
    peeled.push(kept[worst].index);
    kept.splice(worst, 1);
  }
  return { kept, peeled };
}

interface FactorCandidate {
  key: string;
  /** Separation on a 0..1 scale (see module doc). */
  sep: number;
  highFraction: number;
  lowFraction: number;
  /** Evaluated against the upcoming game's value: true / false / unknown. */
  holds(value: boolean | number | string | undefined): boolean | undefined;
  describe(): string;
}

function detectFactorCandidates(
  low: { game: GameLog; index: number }[],
  high: { game: GameLog; index: number }[],
): FactorCandidate[] {
  const keys = new Set<string>();
  for (const e of [...low, ...high]) {
    for (const k of Object.keys(e.game.factors)) keys.add(k);
  }
  const out: FactorCandidate[] = [];
  for (const key of Array.from(keys).sort()) {
    const lowDef = low
      .map((e) => e.game.factors[key])
      .filter((v) => v !== undefined);
    const highDef = high
      .map((e) => e.game.factors[key])
      .filter((v) => v !== undefined);
    if (lowDef.length < 1 || highDef.length < 1) continue;
    const all = [...lowDef, ...highDef];
    if (all.every((v) => typeof v === "boolean")) {
      // P(present) per half; orient the condition to the high side.
      const fH = highDef.filter(Boolean).length / highDef.length;
      const fL = lowDef.filter(Boolean).length / lowDef.length;
      const condTrue = fH >= fL;
      const sep = Math.abs(fH - fL);
      if (sep <= 0) continue;
      out.push({
        key,
        sep,
        highFraction: condTrue ? fH : 1 - fH,
        lowFraction: condTrue ? fL : 1 - fL,
        holds: (v) =>
          v === undefined ? undefined : condTrue ? v === true : v === false,
        describe: () => key + "=" + condTrue,
      });
    } else if (all.every((v) => typeof v === "number")) {
      const mH = mean(highDef.map(Number));
      const mL = mean(lowDef.map(Number));
      const vH = sampleVariance(highDef.map(Number));
      const vL = sampleVariance(lowDef.map(Number));
      const pooled = Math.sqrt(
        ((highDef.length - 1) * vH + (lowDef.length - 1) * vL) /
          (highDef.length + lowDef.length - 2),
      );
      if (mH === mL) continue;
      const d = pooled === 0 ? Infinity : Math.abs(mH - mL) / pooled;
      const sep = d === Infinity ? 1 : d / (d + 1); // squashed to 0..1
      const highAbove = mH > mL;
      const mid = (mH + mL) / 2;
      const fracAbove = (defs: (boolean | number | string)[]) =>
        defs.filter((v) => Number(v) > mid).length / defs.length;
      out.push({
        key,
        sep,
        highFraction: highAbove ? fracAbove(highDef) : 1 - fracAbove(highDef),
        lowFraction: highAbove ? fracAbove(lowDef) : 1 - fracAbove(lowDef),
        holds: (v) => {
          if (v === undefined || typeof v !== "number") return undefined;
          if (v === mid) return undefined; // exactly at the midpoint -> uncertain
          return highAbove ? v > mid : v < mid;
        },
        describe: () =>
          key +
          " " +
          (highAbove ? ">" : "<") +
          " " +
          mid.toFixed(2) +
          " (high mean " +
          mH.toFixed(2) +
          " vs low " +
          mL.toFixed(2) +
          ")",
      });
    } else {
      // Categorical: the best single value, oriented to the high side.
      const values = Array.from(new Set(all.map(String))).sort();
      let best: { v: string; sep: number } | null = null;
      for (const v of values) {
        const fH =
          highDef.filter((x) => String(x) === v).length / highDef.length;
        const fL =
          lowDef.filter((x) => String(x) === v).length / lowDef.length;
        const sep = Math.abs(fH - fL);
        if (!best || sep > best.sep) best = { v, sep };
      }
      if (!best || best.sep <= 0) continue;
      const bv = best.v;
      const fH =
        highDef.filter((x) => String(x) === bv).length / highDef.length;
      const fL =
        lowDef.filter((x) => String(x) === bv).length / lowDef.length;
      const condIsValue = fH >= fL;
      out.push({
        key,
        sep: best.sep,
        highFraction: condIsValue ? fH : 1 - fH,
        lowFraction: condIsValue ? fL : 1 - fL,
        holds: (v) =>
          v === undefined
            ? undefined
            : condIsValue
              ? String(v) === bv
              : String(v) !== bv,
        describe: () => key + "=" + bv,
      });
    }
  }
  return out;
}

/**
 * Project the next game from completed game logs, per the module doc.
 * upcoming = the objective conditions already known about the next game
 * (isHome, month, ...). Throws when there are fewer than 4 games — the
 * median split needs two halves of at least two.
 */
export function projectDave(
  games: GameLog[],
  upcoming: Record<string, boolean | number | string | undefined> = {},
): DaveProjection {
  if (games.length < 4) {
    throw new Error(
      "Dave's method needs at least 4 completed games to split into halves; got " +
        games.length +
        ".",
    );
  }
  const split = medianSplit(games);
  const lowPeeled = peelOutliers(split.low);
  const highPeeled = peelOutliers(split.high);
  const peeled = [...lowPeeled.peeled, ...highPeeled.peeled].sort(
    (a, b) => a - b,
  );

  const lowScores = lowPeeled.kept.map((e) => e.game.score);
  const highScores = highPeeled.kept.map((e) => e.game.score);
  const lowMean = mean(lowScores);
  const highMean = mean(highScores);
  const lowVar = sampleVariance(lowScores);
  const highVar = sampleVariance(highScores);

  const normality = {
    high: isNormal(highScores),
    low: isNormal(lowScores),
  };

  // Sameness: Welch's t-test, implemented directly (see module doc).
  const { t } = welchT(highScores, lowScores);
  const sameMeans = Math.abs(t) < SAME_T;

  const build = (p: number): DaveProjection => {
    // Within-half variances weighted by P and (1-P), plus the between-half
    // boom/bust term — the variance of a two-component mixture.
    const variance =
      p * p * highVar +
      (1 - p) * (1 - p) * lowVar +
      p * (1 - p) * Math.pow(highMean - lowMean, 2);
    const halfWidth = Z90 * Math.sqrt(variance);
    const projection = highMean * p + lowMean * (1 - p);
    return {
      projection,
      low90: projection - halfWidth,
      high90: projection + halfWidth,
      highMean,
      lowMean,
      factor: null,
      p,
      peeled,
      sameMeans,
      normality,
      factorDetail: null,
    };
  };

  if (sameMeans) {
    // His doc: "if they are, you project using the raw average of the two
    // samples." Raw average of all post-peel games; even-split floor.
    const raw = mean([...lowScores, ...highScores]);
    return { ...build(0.5), projection: raw, factor: null };
  }

  const candidates = detectFactorCandidates(lowPeeled.kept, highPeeled.kept);
  const winner = candidates.reduce<FactorCandidate | null>((acc, c) => {
    if (!acc || c.sep > acc.sep) return c;
    return acc;
  }, null);

  if (!winner) {
    // Nothing separates the halves -> his even-split floor.
    return build(0.5);
  }

  const holds = winner.holds(upcoming[winner.key]);
  const p = holds === undefined ? 0.5 : holds ? 1 : 0;

  return {
    ...build(p),
    factor: winner.key,
    factorDetail: {
      condition: winner.describe(),
      highFraction: winner.highFraction,
      lowFraction: winner.lowFraction,
    },
    p,
  };
}
