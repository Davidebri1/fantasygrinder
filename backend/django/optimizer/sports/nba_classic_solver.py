"""NBA Classic slot-aware MILP solver.

Encodes the 8 NBA Classic roster slots (PG, SG, SF, PF, C, G, F, UTIL)
as direct constraints in the optimization problem rather than locking
specific players via pre-assignment. This lets the solver explore the
full solution space and produce *diverse* lineups in Monte Carlo mode.

Variables
---------
x[i] ∈ {0,1}   — player i is selected for the lineup
y[i,s] ∈ {0,1} — player i fills slot s

Constraints
-----------
- Σ_i x[i] = roster_size  (8 for Classic)
- Σ_i x[i] · salary_i ≤ salary_cap
- Σ_s y[i,s] = x[i]      (every selected player fills exactly one slot)
- Σ_i y[i,s] = 1          (every slot is filled by exactly one player)
- ∀s,i where slot s rejects player i: y[i,s] = 0
- Locks / exclusions propagate through x[i]

Objective
---------
maximize Σ_i x[i] · score[i]   (slot doesn't matter for projection)
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

import pulp

from ..engines.milp_pulp import SolverSpec, solve_pulp
from ..schema import (
    ContestType,
    OptimizerSettings,
    Player,
    Strategy,
)
from .nba import CLASSIC_SLOTS, RosterSlot, bipartite_assign


def solve_classic_with_slots(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    salary_cap: int,
    locked_idx: set[int] | None = None,
    excluded_idx: set[int] | None = None,
    forbidden_lineups: list[set[int]] | None = None,
    time_limit_ms: int = 5_000,
) -> tuple[list[int], float, int, str]:
    """Solve the NBA Classic 8-pick lineup ILP with slot constraints.

    Returns (selected_idx, value, salary, status).
    """
    locked_idx = locked_idx or set()
    excluded_idx = excluded_idx or set()
    forbidden_lineups = forbidden_lineups or []
    n = len(players)
    slots = CLASSIC_SLOTS

    problem = pulp.LpProblem("nba-classic", pulp.LpMaximize)

    x = [pulp.LpVariable(f"x_{i}", cat="Binary") for i in range(n)]
    y: list[list[pulp.LpVariable]] = [
        [pulp.LpVariable(f"y_{i}_{s}", cat="Binary") for s in range(len(slots))]
        for i in range(n)
    ]

    problem += pulp.lpSum(scores[i] * x[i] for i in range(n)), "objective"

    # Roster size
    problem += pulp.lpSum(x) == len(slots), "roster_size"

    # Salary cap
    problem += (
        pulp.lpSum(players[i].salary * x[i] for i in range(n)) <= salary_cap,
        "salary_cap",
    )

    # Each selected player fills exactly one slot.
    for i in range(n):
        problem += pulp.lpSum(y[i]) == x[i], f"player_{i}_one_slot"

    # Each slot filled by exactly one player.
    for s_idx in range(len(slots)):
        problem += pulp.lpSum(y[i][s_idx] for i in range(n)) == 1, f"slot_{s_idx}_filled"

    # Slot eligibility: y[i,s] = 0 when player can't fill slot s.
    for i in range(n):
        positions = players[i].roster_positions
        for s_idx, slot in enumerate(slots):
            if not slot.can_accept(positions):
                problem += y[i][s_idx] == 0, f"inelig_{i}_{s_idx}"

    # Locks
    for i in locked_idx:
        problem += x[i] == 1, f"lock_{i}"

    # Exclusions
    for i in excluded_idx:
        problem += x[i] == 0, f"exclude_{i}"

    # Forbidden pair constraints (de-dup against prior lineups)
    for idx_set in forbidden_lineups:
        if idx_set:
            problem += (
                pulp.lpSum(x[i] for i in idx_set) <= len(idx_set) - 1,
                f"forbid_{'_'.join(map(str, sorted(idx_set)))}",
            )

    solver = pulp.PULP_CBC_CMD(timeLimit=time_limit_ms / 1000.0, gapRel=0.005, msg=0)
    import time as _time

    start = _time.perf_counter()
    status = problem.solve(solver)
    elapsed_ms = int((_time.perf_counter() - start) * 1000)

    if pulp.LpStatus[status] != "Optimal":
        return [], 0.0, 0, pulp.LpStatus[status], elapsed_ms

    selected_idx = [i for i in range(n) if pulp.value(x[i]) > 0.5]
    value = float(sum(scores[i] for i in selected_idx))
    salary = int(sum(players[i].salary for i in selected_idx))
    return selected_idx, value, salary, "Optimal", elapsed_ms


def lineup_from_slot_solution(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    slot_assignments: list[int],  # slot_assignments[s] = player_idx
    solver_backend: str,
    strategy: Strategy,
    rank: int,
) -> "Lineup":  # noqa: F821
    """Build a Lineup from a slot assignment vector."""
    from ..schema import Lineup, SlotAssignment

    assignments = []
    for s_idx, player_idx in enumerate(slot_assignments):
        slot = CLASSIC_SLOTS[s_idx]
        assignments.append(
            SlotAssignment(
                slot=slot.label,
                score_multiplier=1.0,
                player_id=players[player_idx].id,
                player_name=players[player_idx].name,
            )
        )
    total_salary = sum(players[i].salary for i in slot_assignments)
    total_proj = sum(scores[i] for i in slot_assignments)
    total_ceiling = sum(players[i].ceiling for i in slot_assignments)
    teams = {players[i].team for i in slot_assignments if players[i].team}

    lineup = Lineup(
        assignments=assignments,
        strategy=strategy,
        solver_backend=solver_backend,
        rank=rank,
    )
    lineup.total_salary = total_salary
    lineup.total_projection = total_proj
    lineup.total_ceiling = total_ceiling
    lineup.teams = teams
    lineup.games = set()
    return lineup
