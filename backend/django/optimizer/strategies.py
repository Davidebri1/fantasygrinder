"""Five optimization strategies, ported from the Flutter app.

Strategy → objective-score transform (per player, before MILP solve):

- MONTE_CARLO: sample N correlated Monte Carlo slates, solve each, collect
  uniques, return top-K. Each simulation's per-player score is a random
  draw from the player's effective distribution.

- MAX_PROJECTION: use each player's effective_projection as the score. Run
  one solve, then perturb ±5% and re-solve N times to generate diversity.

- CONTRARIAN: same as Monte Carlo but divide each simulated score by
  ``sqrt(projected_ownership / 100)`` — low-owned players who boom gain
  leverage, high-owned chalk players lose it.

- BALANCED: optimize per-dollar-of-salary — score = projection / (salary
  / 1000). One solve + ±8% perturbation for diversity.

- SALARY_CAP: maximize a weighted blend favoring salary spend (70%) over
  projection (30%). One solve + ±8% perturbation.

Perturbation rules mirror the Dart reference's per-strategy amounts.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .schema import OptimizerSettings, Player, Strategy


# ───────────────────────────────────────────────────────────────────────────
# Objective scorers
# ───────────────────────────────────────────────────────────────────────────
def score_max_projection(
    players: Sequence[Player],
    *,
    seed: int | None = None,
) -> list[float]:
    """Score = effective projection. Used by MAX_PROJECTION as base."""
    return [p.effective_projection for p in players]


def score_balanced(players: Sequence[Player]) -> list[float]:
    """Score = projection / (salary / 1000). BALANCED strategy base."""
    out = []
    for p in players:
        if p.salary > 0:
            out.append(p.effective_projection / (p.salary / 1000.0))
        else:
            out.append(0.0)
    return out


def score_salary_cap(players: Sequence[Player], weight_salary: float = 0.7) -> list[float]:
    """Score = salary_weight × (salary/1000) + projection_weight × projection."""
    w_s = weight_salary
    w_p = 1.0 - weight_salary
    return [w_s * (p.salary / 1000.0) + w_p * p.effective_projection for p in players]


def score_contrarian(simulated_row: np.ndarray, players: Sequence[Player]) -> list[float]:
    """Convert a simulated score vector into a leverage score."""
    leverage = []
    for i, p in enumerate(players):
        ownership = max(p.projected_ownership, 0.1) / 100.0
        leverage.append(simulated_row[i] / math.sqrt(ownership))
    return leverage


# ───────────────────────────────────────────────────────────────────────────
# Deterministic perturbation
# ───────────────────────────────────────────────────────────────────────────
def perturb(
    scores: Sequence[float],
    *,
    amount: float,
    seed: int,
) -> list[float]:
    """Multiply each score by ``1 + U(-amount, +amount)`` deterministically."""
    rng = np.random.default_rng(seed)
    out = []
    for s in scores:
        factor = 1.0 + rng.uniform(-amount, amount)
        out.append(float(s) * factor)
    return out


# ───────────────────────────────────────────────────────────────────────────
# Strategy → score-vector generator(s)
# ───────────────────────────────────────────────────────────────────────────
@dataclass(slots=True)
class StrategyResult:
    """One iteration of a strategy = a list of per-player scores for the MILP solver."""

    scores: list[float]
    iteration: int
    description: str = ""


@dataclass(slots=True)
class StrategyPipeline:
    """A generator that yields :class:`StrategyResult`s to feed into MILP iterations."""

    strategy: Strategy

    def iter(
        self,
        players: Sequence[Player],
        settings: OptimizerSettings,
        simulated_slate: np.ndarray | None = None,
    ) -> "list[StrategyResult]":
        """Return the sequence of score vectors to optimize over.

        For Monte Carlo and Contrarian: one score vector per simulated row.
        For others: 1 + ceil(num_lineups/2) perturbations of the base.
        """
        if self.strategy == Strategy.MONTE_CARLO:
            return self._iter_monte_carlo(players, settings, simulated_slate, leverage=False)
        if self.strategy == Strategy.CONTRARIAN:
            return self._iter_monte_carlo(players, settings, simulated_slate, leverage=True)
        if self.strategy == Strategy.MAX_PROJECTION:
            return self._iter_deterministic(
                score_max_projection(players), amount=0.05, settings=settings, base_label="max_projection"
            )
        if self.strategy == Strategy.BALANCED:
            return self._iter_deterministic(
                score_balanced(players), amount=0.08, settings=settings, base_label="balanced"
            )
        if self.strategy == Strategy.SALARY_CAP:
            return self._iter_deterministic(
                score_salary_cap(players), amount=0.08, settings=settings, base_label="salary_cap"
            )
        raise ValueError(f"Unknown strategy: {self.strategy}")

    def _iter_monte_carlo(
        self,
        players: Sequence[Player],
        settings: OptimizerSettings,
        simulated_slate: np.ndarray | None,
        *,
        leverage: bool,
    ) -> list[StrategyResult]:
        if simulated_slate is None or simulated_slate.shape[0] == 0:
            return []
        # Use the requested number of simulations (truncate if slate is shorter).
        n = min(settings.simulation_count, simulated_slate.shape[0])
        out: list[StrategyResult] = []
        for i in range(n):
            row = simulated_slate[i]
            if leverage:
                scores = score_contrarian(row, players)
            else:
                scores = list(row.tolist())
            out.append(
                StrategyResult(
                    scores=scores,
                    iteration=i,
                    description="monte_carlo" if not leverage else "contrarian",
                )
            )
        return out

    def _iter_deterministic(
        self,
        base_scores: Sequence[float],
        *,
        amount: float,
        settings: OptimizerSettings,
        base_label: str,
    ) -> list[StrategyResult]:
        """One base solve + ceil(num_lineups/2) perturbations."""
        count = max(1, (settings.num_lineups + 1) // 2)
        out = [
            StrategyResult(
                scores=list(base_scores),
                iteration=0,
                description=base_label,
            )
        ]
        seed_base = settings.seed if settings.seed is not None else 0
        for i in range(1, count):
            seed = _perturb_seed(seed_base, i)
            out.append(
                StrategyResult(
                    scores=perturb(base_scores, amount=amount, seed=seed),
                    iteration=i,
                    description=f"{base_label}_perturbed",
                )
            )
        return out


def _perturb_seed(base: int, iteration: int) -> int:
    """Derive a per-iteration perturbation seed from a base seed."""
    h = hashlib.sha256(f"{base}:{iteration}".encode()).digest()
    return int.from_bytes(h[:8], "big", signed=False) % (2**31)
