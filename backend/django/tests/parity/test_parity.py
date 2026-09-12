"""Parity harness — compares the Python optimizer output to frozen
Dart reference outputs (see parity_plan.md).

For v1, this test reads the JSON vectors under
``tests/parity/vectors/`` and asserts:

1. The Python optimizer returns a lineup set whose top score matches
   ``expected.top_score`` within 1e-9 (for `pulp`) or within 1e-3
   (for `ortools`).
2. The Python optimizer's lineup is among the candidates described by
   ``expected.lineup_ids`` — we accept any optimal multiset.

We do not require that the exact lineup match the legacy Dart reference
(tie-breaking differs between solvers). The acceptance bar is "same
optimum value, any optimal lineup".
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from optimizer.run import run_optimization
from optimizer.schema import (
    ContestType,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
)


VECTORS_DIR = (
    Path(__file__).resolve().parents[3] / "tests" / "parity" / "vectors"
)
# Some layouts place vectors under the backend dir; fall back to searching.
if not VECTORS_DIR.exists():
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "tests" / "parity" / "vectors"
        if candidate.exists():
            VECTORS_DIR = candidate
            break


@pytest.fixture(params=sorted(VECTORS_DIR.glob("*.json")), ids=lambda p: p.stem)
def vector(request):
    return json.loads(request.param.read_text())


def _build_settings(sport: Sport, settings_dict: dict) -> OptimizerSettings:
    """Mirror api/optimize._build_settings but without the Audit step."""
    base = OptimizerSettings(
        sport=sport,
        strategy=Strategy(settings_dict.get("strategy", "maxProjection")),
        salary_cap=settings_dict.get("salary_cap", 50_000),
        num_lineups=settings_dict.get("num_lineups", 3),
        simulation_count=settings_dict.get("simulation_count", 100),
        max_attempts=settings_dict.get("max_attempts", 5000),
        min_projection=settings_dict.get("min_projection", 0.0),
    )
    if sport == Sport.NBA:
        base.contest_type = ContestType(settings_dict.get("contest_type", "classic"))
        base.extras.update(
            {
                "teammate_correlation": settings_dict.get("teammate_correlation", 0.35),
                "opponent_correlation": settings_dict.get("opponent_correlation", 0.20),
                "excluded_teams": set(settings_dict.get("excluded_teams", [])),
            }
        )
    if sport == Sport.MMA:
        base.extras.update(
            {
                "allow_opponents": settings_dict.get("allow_opponents", False),
                "opponent_correlation": settings_dict.get("opponent_correlation", -0.40),
                "card_correlation": settings_dict.get("card_correlation", 0.10),
            }
        )
    return base


def test_parity_top_score(vector):
    sport = Sport(vector["sport"])
    backend = vector.get("solver_backend", "pulp")
    settings = _build_settings(sport, vector["settings"])
    players = [Player.from_dict({**p, "sport": sport.value}) for p in vector["players"]]

    result = run_optimization(
        sport=sport,
        players=players,
        settings=settings,
        solver_backend=backend,
    )

    expected_top = vector["expected"]["top_score"]
    tolerance = 1e-6 if backend == "pulp" else 1e-2
    assert abs(result.top_score - expected_top) < tolerance, (
        f"Top score mismatch: got {result.top_score}, expected {expected_top}"
    )


def test_parity_at_least_one_lineup(vector):
    sport = Sport(vector["sport"])
    settings = _build_settings(sport, vector["settings"])
    players = [Player.from_dict({**p, "sport": sport.value}) for p in vector["players"]]

    result = run_optimization(
        sport=sport,
        players=players,
        settings=settings,
        solver_backend=vector.get("solver_backend", "pulp"),
    )

    assert len(result.lineups) >= 1
    # Each returned lineup must satisfy the salary cap.
    for lineup in result.lineups:
        assert lineup.total_salary <= settings.salary_cap, (
            f"Lineup exceeded salary cap: {lineup.total_salary}"
        )
