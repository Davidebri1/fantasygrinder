"""MMA lineup constraints.

MMA is the simplest sport for the MILP solver:

- All 6 roster slots are fungible (no PG/SG/etc.).
- Salary cap default $50k.
- Opponent exclusion: when ``allow_opponents=False`` (the default for GPP),
  at most one fighter per bout. Otherwise both opponents may appear.
- Per-fighter min/max exposure behaves identically to NBA.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from ..engines.milp_pulp import Constraint, SolverSpec
from ..schema import Lineup, OptimizerSettings, Player, SlotAssignment
from .common import lineup_from_solver_result_common


MMA_ROSTER_SIZE = 6


@dataclass(slots=True)
class OpponentExclusionConstraint(Constraint):
    """For each bout, at most one fighter may appear in the lineup."""

    bouts_per_player: list[str]

    def add(self, problem, x):
        bouts: dict[str, list[int]] = defaultdict(list)
        for i, b in enumerate(self.bouts_per_player):
            if b:
                bouts[b].append(i)
        for bout, members in bouts.items():
            problem += (
                __import__("pulp", fromlist=["lpSum"]).lpSum(x[i] for i in members) <= 1,
                f"opponent_excl_{bout}",
            )

    def add_ortools(self, model, x):
        bouts: dict[str, list[int]] = defaultdict(list)
        for i, b in enumerate(self.bouts_per_player):
            if b:
                bouts[b].append(i)
        for bout, members in bouts.items():
            model.Add(sum(x[i] for i in members) <= 1)


def build_solver_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]] | None = None,
    forbidden_lineups: list[set[int]] | None = None,
) -> SolverSpec:
    """Assemble a SolverSpec for an MMA run.

    When ``allow_opponents`` is ``False`` (the default), the effective
    roster size is reduced to the number of distinct bouts, since you
    can pick at most one fighter per bout. The 6-fighter slate requires
    allow_opponents=True.
    """
    pre_assignments = pre_assignments or []
    forbidden_lineups = forbidden_lineups or []

    locked_idx = {i for i, p in enumerate(players) if p.is_locked}
    locked_idx |= {p for s, p in pre_assignments if p is not None}
    excluded_idx = {i for i, p in enumerate(players) if p.is_excluded}

    roster_size = MMA_ROSTER_SIZE
    if not settings.extras.get("allow_opponents", False):
        distinct_bouts = {p.bout for p in players if p.bout}
        # Cap roster_size at the number of distinct bouts (opponent exclusion limit).
        roster_size = min(MMA_ROSTER_SIZE, len(distinct_bouts))

    spec = SolverSpec(
        scores=list(scores),
        salaries=[p.salary for p in players],
        roster_size=roster_size,
        salary_cap=settings.salary_cap,
        locked_idx=locked_idx,
        excluded_idx=excluded_idx,
        forbidden_idx_sets=forbidden_lineups,
        pre_assignments=[(s, p) for s, p in pre_assignments if p is not None],
        extra_constraints=[],
    )

    if not settings.extras.get("allow_opponents", False):
        bouts = [p.bout for p in players]
        spec.extra_constraints.append(OpponentExclusionConstraint(bouts_per_player=bouts))

    return spec


def lineup_from_solver_result(
    *,
    selected_idx: list[int],
    players: Sequence[Player],
    strategy: str,
    solver_backend: str,
    rank: int,
) -> Lineup:
    """Translate solver output into a Lineup for MMA (slots are fungible)."""
    return lineup_from_solver_result_common(
        selected_idx=selected_idx,
        players=players,
        strategy=strategy,
        solver_backend=solver_backend,
        rank=rank,
        slot_template=("FLEX",) * MMA_ROSTER_SIZE,
        score_multipliers=(1.0,) * MMA_ROSTER_SIZE,
    )
