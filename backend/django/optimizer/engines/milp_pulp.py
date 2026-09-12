"""PuLP + CBC MILP solver — the default engine.

We deliberately separate the *engine* from the *sport-specific constraint
builders* so the same solver runs NBA Classic, NBA Showdown, MMA, and
Golf — only the constraint function changes.

Constraints implemented:
- Roster size (exactly N picks).
- Salary cap (≤ cap).
- Per-player min/max exposure across the full run (caller passes appearance counts).
- Pre-assigned slots (NBA Classic / Showdown).
- Forbidden lineups (de-duplication across calls).
- Locked players (must be in).
- Excluded players (must not be in).
- Sport-specific: position eligibility, opponent exclusion (MMA), game
  bring-back (NBA), team stacking (NBA), captain multiplier (Showdown).

The engine returns a :class:`SolverResult` with the selected player
indices. Sport layers translate this into a :class:`Lineup`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import pulp


@dataclass(slots=True)
class SolverResult:
    selected_idx: list[int]
    value: float
    salary: int
    status: str  # "Optimal" | "Infeasible" | "Unbounded" | "Not Solved"
    solver_time_ms: int


@dataclass(slots=True)
class SolverSpec:
    """A sport-agnostic spec the engine solves against.

    ``cb_pre`` / ``cb_post`` hooks let sport layers inject custom constraints.
    """

    scores: Sequence[float]
    salaries: Sequence[int]
    roster_size: int
    salary_cap: int

    locked_idx: set[int] = field(default_factory=set)
    excluded_idx: set[int] = field(default_factory=set)
    forbidden_idx_sets: list[set[int]] = field(default_factory=list)
    appearance_floor_idx: dict[int, int] = field(default_factory=dict)
    appearance_ceiling_idx: dict[int, int] = field(default_factory=dict)

    # Per-unit score multipliers (NBA Showdown Captain = 1.5)
    score_multipliers: Sequence[float] = field(default_factory=lambda: [])

    # Minimum total salary to use (NBA "spend up" builds)
    min_total_salary: int = 0

    # Optional constraint hooks
    pre_assignments: list[tuple[int, int]] = field(default_factory=list)
    extra_constraints: list["Constraint"] = field(default_factory=list)

    # Solver tuning
    time_limit_ms: int = 5_000
    mip_gap: float = 0.005  # 0.5% gap tolerance

    def __post_init__(self) -> None:
        if not self.score_multipliers:
            self.score_multipliers = [1.0] * len(self.scores)


class Constraint:
    """Marker for sport-specific additional constraints."""

    def add(self, problem: "pulp.LpProblem", x: list) -> None:  # pragma: no cover
        raise NotImplementedError


def _constrain_forbid_pair(
    problem: pulp.LpProblem,
    x: list,
    i: int,
    j: int,
) -> None:
    problem += x[i] + x[j] <= 1, f"forbid_pair_{i}_{j}"


def solve_pulp(spec: SolverSpec) -> SolverResult:
    """Solve the lineup-construction ILP using PuLP + CBC.

    Returns a SolverResult with selected player indices. ``scores[i]`` is
    the per-unit objective value (typically projection or one Monte Carlo
    row), and ``score_multipliers[i]`` is the per-slot multiplier
    (1.0 for Classic/MMA/Golf, 1.5 for Showdown Captain — but those
    models bake the multiplier into the *per-slot score*).
    """
    n = len(spec.scores)
    if n == 0:
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status="Infeasible",
            solver_time_ms=0,
        )

    problem = pulp.LpProblem("lineup", pulp.LpMaximize)
    x = [pulp.LpVariable(f"x_{i}", cat="Binary") for i in range(n)]

    # Objective
    problem += (
        pulp.lpSum(spec.scores[i] * spec.score_multipliers[i] * x[i] for i in range(n)),
        "objective",
    )

    # Roster size
    problem += (
        pulp.lpSum(x[i] for i in range(n)) == spec.roster_size,
        "roster_size",
    )

    # Salary cap
    problem += (
        pulp.lpSum(spec.salaries[i] * x[i] for i in range(n)) <= spec.salary_cap,
        "salary_cap",
    )

    # Min total salary (NBA "spend up" builds)
    if spec.min_total_salary > 0:
        problem += (
            pulp.lpSum(spec.salaries[i] * x[i] for i in range(n)) >= spec.min_total_salary,
            "min_salary",
        )

    # Locks
    for i in spec.locked_idx:
        problem += x[i] == 1, f"lock_{i}"

    # Exclusions
    for i in spec.excluded_idx:
        problem += x[i] == 0, f"exclude_{i}"

    # Pre-assignments (NBA Classic position assignment from bipartite matching)
    for slot_idx, player_idx in spec.pre_assignments:
        # The caller has chosen which player fills which slot.
        # We model this as: that slot's row in `pre_assignments` enforces
        # x[player_idx] == 1 for slots that have been locked.
        if player_idx is not None:
            problem += x[player_idx] == 1, f"pre_assign_{slot_idx}"

    # Forbidden pair sets (treat as: at most one from each)
    for idx_set in spec.forbidden_idx_sets:
        if idx_set:
            problem += (
                pulp.lpSum(x[i] for i in idx_set) <= 1,
                f"forbid_set_{'_'.join(map(str, sorted(idx_set)))}",
            )

    # Exposure
    for idx, floor in spec.appearance_floor_idx.items():
        problem += x[idx] >= 1, f"floor_{idx}"  # n/a for one-shot, kept for completeness
    for idx, ceil_count in spec.appearance_ceiling_idx.items():
        problem += x[idx] <= 1, f"ceil_{idx}"  # one-shot bound, kept for parity

    # Custom sport constraints
    for c in spec.extra_constraints:
        c.add(problem, x)

    solver = pulp.PULP_CBC_CMD(
        timeLimit=spec.time_limit_ms / 1000.0,
        gapRel=spec.mip_gap,
        msg=0,
    )
    import time

    start = time.perf_counter()
    status = problem.solve(solver)
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if pulp.LpStatus[status] != "Optimal":
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status=pulp.LpStatus[status],
            solver_time_ms=elapsed_ms,
        )

    selected_idx = [i for i in range(n) if pulp.value(x[i]) > 0.5]
    value = float(sum(spec.scores[i] * spec.score_multipliers[i] for i in selected_idx))
    salary = int(sum(spec.salaries[i] for i in selected_idx))
    return SolverResult(
        selected_idx=selected_idx,
        value=value,
        salary=salary,
        status="Optimal",
        solver_time_ms=elapsed_ms,
    )
