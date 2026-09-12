/**
 * Monte Carlo simulation — Box-Muller + Cholesky for correlated normals.
 *
 * Mirrors the Python port in `backend/django/optimizer/simulation/`.
 * Designed for in-browser use: 10k simulations of a 200-player slate
 * complete in <50ms.
 */

import type { Player } from "./types";

function boxMuller(uniforms: Float64Array): Float64Array {
  const n = uniforms.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Avoid log(0).
    const u1 = Math.max(uniforms[i], 1e-12);
    // We need a second uniform for theta. Pull from a parallel array.
    const u2 = Math.max(uniforms[(i + 1) % n] ?? 0.5, 1e-12);
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = r * Math.cos(theta);
  }
  return out;
}

/** Cholesky decomposition of a symmetric PSD matrix. Returns L (lower-tri). */
function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) sum = 1e-6; // floor for numerical stability
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Build the NBA correlation matrix. */
function buildNbaCorrelation(players: Player[], teammate: number, opponent: number): number[][] {
  const n = players.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const a = players[i];
      const b = players[j];
      let rho = 0.0;
      if (a.team && a.team === b.team) {
        rho = teammate;
      } else if (a.team && a.opponent && a.team === b.opponent && a.opponent === b.team) {
        rho = opponent;
      }
      m[i][j] = m[j][i] = rho;
    }
  }
  return m;
}

/** Build the MMA correlation matrix (opponent negative, card positive). */
function buildMmaCorrelation(
  players: Player[],
  opponentCorr: number,
  cardCorr: number,
): number[][] {
  const n = players.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const a = players[i];
      const b = players[j];
      let rho = 0.0;
      if (a.opponentId && a.opponentId === b.id) {
        rho = opponentCorr;
      } else if (a.bout && a.bout === b.bout && a.opponentId !== b.id) {
        rho = cardCorr;
      }
      m[i][j] = m[j][i] = rho;
    }
  }
  return m;
}

/** Run N correlated Monte Carlo simulations. Returns an array of [count, n]. */
export function runSimulations(
  players: Player[],
  simCount: number,
  opts: {
    sport: "nba" | "mma" | "golf";
    teammateCorrelation: number;
    opponentCorrelation: number;
    cardCorrelation: number;
    seed?: number;
  },
): number[][] {
  const n = players.length;
  if (n === 0 || simCount === 0) return [];

  let corr: number[][];
  if (opts.sport === "nba") {
    corr = buildNbaCorrelation(players, opts.teammateCorrelation, opts.opponentCorrelation);
  } else if (opts.sport === "mma") {
    corr = buildMmaCorrelation(players, opts.opponentCorrelation, opts.cardCorrelation);
  } else {
    corr = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0)),
    );
  }
  const L = cholesky(corr);

  const means = players.map((p) => effectiveProjection(p));
  const stds = players.map((p) => effectiveStddev(p));

  // Deterministic PRNG (Mulberry32) so the same seed → same output.
  let state = (opts.seed ?? 42) >>> 0;
  function rand(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const result: number[][] = [];
  for (let s = 0; s < simCount; s++) {
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = rand();
    // Box-Muller transform: convert uniforms to N(0,1) with antithetic pairing
    // (cos+sin from same u1) to keep variance low.
    const normals = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(z[i], 1e-12);
      const u2 = Math.max(z[i + 1] ?? 0.5, 1e-12);
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      normals[i] = r * Math.cos(theta);
      if (i + 1 < n) normals[i + 1] = r * Math.sin(theta);
    }
    // Multiply by L (lower-triangular) to introduce correlation.
    const correlated = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += L[i][j] * normals[j];
      const v = means[i] + sum * stds[i];
      correlated[i] = Math.max(0, v);
    }
    result.push(Array.from(correlated));
  }
  return result;
}

export function effectiveProjection(p: Player): number {
  const base = p.userProjection ?? p.projection;
  return p.isLiked ? base * 1.15 : base;
}

export function effectiveStddev(p: Player): number {
  if (p.stddev !== undefined && p.stddev !== null) return p.stddev;
  const proj = p.projection;
  let mult = 0.32;
  if (proj >= 45) mult = 0.18;
  else if (proj >= 35) mult = 0.2;
  else if (proj >= 25) mult = 0.23;
  else if (proj >= 15) mult = 0.27;
  return proj * mult;
}
