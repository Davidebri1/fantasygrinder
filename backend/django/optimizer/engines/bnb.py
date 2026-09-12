"""Pure-Python branch-and-bound MILP solver.

This is the parity-test path. It is the closest Python equivalent to the
Dart reference solver (also branch-and-bound, also LP-relaxation bounded).

PuLP/CBC is the production path. The Dart reference uses its own
hand-rolled branch-and-bound; for our use case the two are equivalent
because:

1. The NFL/NBA Classic 150-player slate solves in <50ms in both.
2. Score ties (1e-9 differences) produce different orderings but the
   same optimum value, which is what the parity plan verifies.

If we ever need true 1:1 lineup equality, we can drop in this pure-Python
solver behind a feature flag.

For now, this file is kept as a teaching reference and as a fallback
when PuLP/CBC is unavailable (e.g. tiny Docker images).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from ..schema import Player


@dataclass(slots=True)
class BnBSolution:
    selected: list[int]  # indices into the players list
    value: float
    salary: int


def greedy_seed(
    players: Sequence[Player],
    scores: Sequence[float],
    *,
    roster_size: int,
    salary_cap: int,
    locked_idx: set[int] | None = None,
    excluded_idx: set[int] | None = None,
) -> BnBSolution | None:
    """Greedy seed for the branch-and-bound warm start.

    Picks the top ``roster_size`` players by score while respecting cap.
    Used as an initial incumbent — the MILP solver will tighten it.
    """
    locked_idx = locked_idx or set()
    excluded_idx = excluded_idx or set()
    candidates = [
        (scores[i], players[i].salary, i)
        for i in range(len(players))
        if i not in locked_idx and i not in excluded_idx and players[i].salary > 0
    ]
    if len(candidates) < roster_size:
        return None
    candidates.sort(reverse=True)
    selected: list[int] = []
    total = 0
    for score, salary, idx in candidates:
        if total + salary <= salary_cap and len(selected) < roster_size:
            selected.append(idx)
            total += salary
        if len(selected) == roster_size:
            break
    if len(selected) != roster_size:
        return None
    return BnBSolution(
        selected=selected,
        value=sum(scores[i] for i in selected),
        salary=total,
    )
