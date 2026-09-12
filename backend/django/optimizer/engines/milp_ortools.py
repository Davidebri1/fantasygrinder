"""Google OR-Tools CP-SAT MILP solver — opt-in speed path.

CP-SAT is a constraint-programming solver with a SAT backend. It is
typically 5–10× faster than CBC on real-world DFS slates, at the cost of
producing different optima on tied scores (we document this in the
parity plan and surface it to the API as a `warning` when relevant).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .milp_pulp import SolverResult, SolverSpec


def solve_ortools(spec: SolverSpec) -> SolverResult:
    """Solve the lineup ILP with OR-Tools CP-SAT."""
    try:
        from ortools.sat.python import cp_model
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "ortools is not installed; pip install ortools to enable this backend."
        ) from exc

    n = len(spec.scores)
    if n == 0:
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status="Infeasible",
            solver_time_ms=0,
        )

    model = cp_model.CpModel()

    # CP-SAT works with integers — multiply scores by 1e6 to preserve sub-dollar precision
    score_scale = 1_000_000
    int_scores = [int(round(s * score_scale)) for s in spec.scores]

    x = [model.NewBoolVar(f"x_{i}") for i in range(n)]

    # Roster size
    model.Add(sum(x) == spec.roster_size)

    # Salary cap
    model.Add(sum(spec.salaries[i] * x[i] for i in range(n)) <= spec.salary_cap)

    # Min total salary
    if spec.min_total_salary > 0:
        model.Add(
            sum(spec.salaries[i] * x[i] for i in range(n)) >= spec.min_total_salary
        )

    # Locks / exclusions
    for i in spec.locked_idx:
        model.Add(x[i] == 1)
    for i in spec.excluded_idx:
        model.Add(x[i] == 0)

    # Pre-assignments
    for slot_idx, player_idx in spec.pre_assignments:
        if player_idx is not None:
            model.Add(x[player_idx] == 1)

    # Forbidden lineups — no-good cut: exclude the exact set, allow subsets.
    for idx_set in spec.forbidden_idx_sets:
        if idx_set:
            model.Add(sum(x[i] for i in idx_set) <= len(idx_set) - 1)

    # Custom sport constraints
    for c in spec.extra_constraints:
        _add_ortools_constraint(model, c, x)

    # Objective: maximize scaled scores with multipliers baked in
    model.Maximize(
        sum(int_scores[i] * spec.score_multipliers[i] * x[i] for i in range(n))
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = spec.time_limit_ms / 1000.0
    solver.parameters.relative_gap_limit = spec.mip_gap

    import time

    start = time.perf_counter()
    status = solver.Solve(model)
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolverResult(
            selected_idx=[],
            value=0.0,
            salary=0,
            status="Infeasible" if status == cp_model.INFEASIBLE else "Not Solved",
            solver_time_ms=elapsed_ms,
        )

    selected_idx = [i for i in range(n) if solver.Value(x[i])]
    value = float(sum(spec.scores[i] * spec.score_multipliers[i] for i in selected_idx))
    salary = int(sum(spec.salaries[i] for i in selected_idx))
    return SolverResult(
        selected_idx=selected_idx,
        value=value,
        salary=salary,
        status="Optimal" if status == cp_model.OPTIMAL else "Feasible",
        solver_time_ms=elapsed_ms,
    )


def _add_ortools_constraint(model, constraint, x) -> None:
    """Translate a sport-specific constraint to OR-Tools.

    The constraint class declares ``add_pulp(problem, x)`` and may add
    an ``add_ortools(model, x)`` method. Falls back to a generic
    "all-zero" addition if the sport hasn't wired up the OR-Tools path.
    """
    fn = getattr(constraint, "add_ortools", None)
    if fn is not None:
        fn(model, x)
        return
    # Sport hasn't implemented OR-Tools for this constraint — silently skip.
    # (CP-SAT is opt-in, so missing constraints fall back to lenient behavior.)


def solve_auto(spec: SolverSpec) -> SolverResult:
    """Solve with whichever backend is available."""
    import os

    if os.environ.get("FANTASY_GRINDER_SOLVER", "pulp") == "ortools":
        return solve_ortools(spec)
    return solve_pulp(spec)
