"""Golf lineup constraints.

Golf is functionally similar to MMA — fungible slots, salary cap,
optional correlation between players on the same tee-time wave.

The original Flutter app does not yet expose a correlation knob for golf
(see optimizer_strategy.md — the strategy table lists NBA and MMA only).
We leave the door open by reading ``settings.extras["card_correlation"]``
with a default of ``0.10`` if present.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

from ..engines.milp_pulp import Constraint, SolverSpec
from ..schema import Lineup, OptimizerSettings, Player
from .common import lineup_from_solver_result_common


GOLF_ROSTER_SIZE = 6
GOLF_DEFAULT_CARD_CORRELATION = 0.10


def build_solver_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]] | None = None,
    forbidden_lineups: list[set[int]] | None = None,
) -> SolverSpec:
    """Assemble a SolverSpec for a golf run."""
    pre_assignments = pre_assignments or []
    forbidden_lineups = forbidden_lineups or []

    locked_idx = {i for i, p in enumerate(players) if p.is_locked}
    locked_idx |= {p for s, p in pre_assignments if p is not None}
    excluded_idx = {i for i, p in enumerate(players) if p.is_excluded}

    return SolverSpec(
        scores=list(scores),
        salaries=[p.salary for p in players],
        roster_size=GOLF_ROSTER_SIZE,
        salary_cap=settings.salary_cap,
        locked_idx=locked_idx,
        excluded_idx=excluded_idx,
        forbidden_idx_sets=forbidden_lineups,
        pre_assignments=[(s, p) for s, p in pre_assignments if p is not None],
        extra_constraints=[],
    )


def lineup_from_solver_result(
    *,
    selected_idx: list[int],
    players: Sequence[Player],
    strategy: str,
    solver_backend: str,
    rank: int,
) -> Lineup:
    return lineup_from_solver_result_common(
        selected_idx=selected_idx,
        players=players,
        strategy=strategy,
        solver_backend=solver_backend,
        rank=rank,
        slot_template=("FLEX",) * GOLF_ROSTER_SIZE,
        score_multipliers=(1.0,) * GOLF_ROSTER_SIZE,
    )
