"""Optimizer engines — both PuLP/CBC (parity default) and OR-Tools/CP-SAT (speed opt-in)."""
from .milp_ortools import solve_auto, solve_ortools
from .milp_pulp import SolverResult, SolverSpec, solve_pulp

__all__ = [
    "SolverResult",
    "SolverSpec",
    "solve_auto",
    "solve_ortools",
    "solve_pulp",
]
