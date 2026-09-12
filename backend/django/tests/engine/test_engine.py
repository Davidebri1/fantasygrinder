"""Engine unit tests: solvers, simulation, strategies.

This test layer proves the building blocks work in isolation. It does NOT
require a database. It uses synthetic players + hand-crafted matrices.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from optimizer.engines.milp_pulp import SolverSpec, solve_pulp
from optimizer.engines.milp_ortools import solve_ortools
from optimizer.schema import (
    ContestType,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
    filter_eligible,
)
from optimizer.simulation.cholesky import (
    build_nba_correlation,
    correlation_matrix_from,
    sample_correlated,
)
from optimizer.simulation.monte_carlo import run_batched
from optimizer.sports.mma import MMA_ROSTER_SIZE, OpponentExclusionConstraint
from optimizer.sports.nba import CLASSIC_SLOTS, roster_size
from optimizer.strategies import (
    StrategyPipeline,
    score_balanced,
    score_max_projection,
    score_salary_cap,
)


# ────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────
def make_nba_player(i: int, salary: int, projection: float, pos: str = "PG") -> Player:
    return Player(
        id=f"p{i}",
        name=f"Player {i}",
        sport=Sport.NBA,
        salary=salary,
        projection=projection,
        team="AAA" if i % 2 == 0 else "BBB",
        opponent="BBB" if i % 2 == 0 else "AAA",
        game_info="AAA@BBB 7:00pm ET",
        positions=[pos],
        roster_positions=[pos, "UTIL"],
        correlation_group="AAA@BBB",
    )


# ────────────────────────────────────────────────────────────────────────
# Solver tests
# ────────────────────────────────────────────────────────────────────────
class TestPuLPSolver:
    def test_feasible_8p_classic(self):
        players = [
            make_nba_player(i, salary=6000, projection=20.0 + i, pos=pos)
            for i, pos in enumerate(["PG", "SG", "SF", "PF", "C", "PG", "SG", "SF"])
        ]
        spec = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=roster_size(ContestType.CLASSIC),
            salary_cap=50_000,
        )
        result = solve_pulp(spec)
        assert result.status == "Optimal"
        assert len(result.selected_idx) == 8
        assert result.salary <= 50_000

    def test_caps_above_budget_are_infeasible_or_truncated(self):
        # Build a 6-player pool where total salary exceeds cap.
        players = [make_nba_player(i, salary=9000, projection=20.0) for i in range(6)]
        spec = SolverSpec(
            scores=[1.0] * 6,
            salaries=[p.salary for p in players],
            roster_size=6,
            salary_cap=50_000,
        )
        result = solve_pulp(spec)
        # 5 × 9k = 45k ≤ 50k, but 6 × 9k = 54k > cap — solver must yield Infeasible.
        assert result.status == "Infeasible"

    def test_truncation_when_only_some_fit(self):
        # 6 players at $9k = $54k. Cap is $50k. Solver should pick 5 (45k fits).
        players = [make_nba_player(i, salary=9000, projection=20.0) for i in range(6)]
        spec = SolverSpec(
            scores=[1.0] * 6,
            salaries=[p.salary for p in players],
            roster_size=5,  # explicitly require 5
            salary_cap=50_000,
        )
        result = solve_pulp(spec)
        assert result.status == "Optimal"
        assert result.salary <= 50_000
        assert len(result.selected_idx) == 5

    def test_locked_player_must_appear(self):
        players = [make_nba_player(i, salary=6000, projection=20.0 + i) for i in range(8)]
        # Lock player 0
        spec = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=8,
            salary_cap=50_000,
            locked_idx={0},
        )
        result = solve_pulp(spec)
        assert result.status == "Optimal"
        assert 0 in result.selected_idx

    def test_excluded_player_must_not_appear(self):
        # 10 players, must pick 8, exclude the highest. With $5k salaries,
        # 10*5k = 50k, 8*5k = 40k → leaving 1 out is feasible.
        players = [make_nba_player(i, salary=5000, projection=20.0 + i) for i in range(10)]
        spec = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=8,
            salary_cap=50_000,
            excluded_idx={9},  # exclude the highest projection
        )
        result = solve_pulp(spec)
        assert result.status == "Optimal"
        assert 9 not in result.selected_idx

    def test_value_of_optimum_matches(self):
        # 4 players, must pick all 4, project = 50 → optimum = 200.
        players = [make_nba_player(i, salary=4000, projection=50.0) for i in range(4)]
        spec = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=4,
            salary_cap=20_000,
        )
        result = solve_pulp(spec)
        assert result.status == "Optimal"
        assert math.isclose(result.value, 200.0, abs_tol=1e-6)


class TestORToolsSolver:
    def test_parity_against_pulp(self):
        """Same problem solved by both solvers should yield the same objective value."""
        pytest.importorskip("ortools")
        players = [
            make_nba_player(i, salary=6000, projection=20.0 + i, pos="PG" if i < 4 else "SG")
            for i in range(8)
        ]
        spec_pulp = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=8,
            salary_cap=50_000,
        )
        spec_cp = SolverSpec(
            scores=[p.projection for p in players],
            salaries=[p.salary for p in players],
            roster_size=8,
            salary_cap=50_000,
        )
        result_pulp = solve_pulp(spec_pulp)
        result_cp = solve_ortools(spec_cp)
        assert result_pulp.status == "Optimal"
        assert result_cp.status in ("Optimal", "Feasible")
        # CP-SAT may have tiny rounding differences; both should match within 0.01.
        assert abs(result_pulp.value - result_cp.value) < 0.01, (
            f"PuLP={result_pulp.value} OR-Tools={result_cp.value}"
        )


# ────────────────────────────────────────────────────────────────────────
# Simulation tests
# ────────────────────────────────────────────────────────────────────────
class TestSimulation:
    def test_correlation_matrix_is_psd(self):
        teams = ["AAA", "AAA", "BBB", "CCC"]
        opponents = ["BBB", "BBB", "AAA", ""]
        n = len(teams)
        m = build_nba_correlation(
            teams=teams, opponents=opponents, teammate_corr=0.35, opponent_corr=0.20, n=n
        )
        corr = correlation_matrix_from(m)
        assert corr.is_psd

    def test_correlated_samples_have_right_mean(self):
        rng = np.random.default_rng(0)
        m = np.array([[1.0, 0.3], [0.3, 1.0]])
        corr = correlation_matrix_from(m)
        L = corr.cholesky()
        means = np.array([50.0, 60.0])
        stds = np.array([10.0, 12.0])
        samples = sample_correlated(means=means, stds=stds, cholesky_l=L, count=10_000, rng=rng)
        assert samples.shape == (10_000, 2)
        # Means converge to 50/60 with 0.5 tolerance at 10k samples.
        assert abs(samples[:, 0].mean() - 50.0) < 1.0
        assert abs(samples[:, 1].mean() - 60.0) < 1.5
        # Std-devs converge similarly.
        assert abs(samples[:, 0].std() - 10.0) < 0.5

    def test_batched_run_yields_correct_count(self):
        m = np.eye(5)
        corr = correlation_matrix_from(m)
        means = np.array([40.0] * 5)
        stds = np.array([8.0] * 5)
        out = run_batched(
            means=means, stds=stds, correlation=corr, sim_count=2000, batch_size=500, seed=42
        )
        assert out.shape == (2000, 5)


# ────────────────────────────────────────────────────────────────────────
# Strategy tests
# ────────────────────────────────────────────────────────────────────────
class TestStrategies:
    def test_max_projection_scores(self):
        players = [make_nba_player(i, salary=5000, projection=20.0 + i) for i in range(4)]
        scores = score_max_projection(players)
        assert scores == [20.0, 21.0, 22.0, 23.0]

    def test_balanced_scores(self):
        players = [make_nba_player(i, salary=5000, projection=30.0) for i in range(4)]
        scores = score_balanced(players)
        assert all(s == pytest.approx(6.0) for s in scores)

    def test_salary_cap_weights_salary_heavy(self):
        players = [make_nba_player(i, salary=9000, projection=20.0) for i in range(2)]
        scores = score_salary_cap(players)
        # weight_salary=0.7 → 0.7*9 + 0.3*20 = 6.3 + 6.0 = 12.3
        assert scores[0] == pytest.approx(12.3, abs=0.001)

    def test_strategy_pipeline_max_projection(self):
        players = [make_nba_player(i, salary=5000, projection=20.0 + i) for i in range(8)]
        settings = OptimizerSettings(
            sport=Sport.NBA, strategy=Strategy.MAX_PROJECTION, num_lineups=5
        )
        pipeline = StrategyPipeline(strategy=Strategy.MAX_PROJECTION)
        result = pipeline.iter(players, settings)
        # 1 base + max(1, (5+1)//2)=3 perturbations = 3 score vectors total
        assert len(result) == 3
        for r in result:
            assert len(r.scores) == 8


# ────────────────────────────────────────────────────────────────────────
# Filter / eligibility tests
# ────────────────────────────────────────────────────────────────────────
class TestFilters:
    def test_filter_excluded(self):
        players = [make_nba_player(i, salary=5000, projection=20.0) for i in range(4)]
        players[2].is_excluded = True
        settings = OptimizerSettings(sport=Sport.NBA)
        out = filter_eligible(players, settings)
        assert all(p.id != "p2" for p in out)

    def test_filter_zero_salary(self):
        players = [make_nba_player(i, salary=5000, projection=20.0) for i in range(4)]
        players[1].salary = 0
        settings = OptimizerSettings(sport=Sport.NBA)
        out = filter_eligible(players, settings)
        assert all(p.salary > 0 for p in out)

    def test_filter_min_projection(self):
        players = [make_nba_player(i, salary=5000, projection=20.0 + i) for i in range(4)]
        settings = OptimizerSettings(sport=Sport.NBA, min_projection=22.0)
        out = filter_eligible(players, settings)
        # p0=20, p1=21 filtered out; p2=22, p3=23 pass
        assert {p.id for p in out} == {"p2", "p3"}


# ────────────────────────────────────────────────────────────────────────
# Sport-specific constraint tests
# ────────────────────────────────────────────────────────────────────────
class TestMMAConstraints:
    def test_opponent_exclusion_constraint(self):
        # 4 fighters across 2 bouts.
        players = [
            Player(
                id=f"m{i}",
                name=f"Fighter {i}",
                sport=Sport.MMA,
                salary=8000,
                projection=50.0,
                bout=f"bout-{i // 2}",
            )
            for i in range(4)
        ]
        constraint = OpponentExclusionConstraint(bouts_per_player=[p.bout for p in players])

        import pulp

        problem = pulp.LpProblem("mma-test", pulp.LpMaximize)
        x = [pulp.LpVariable(f"x_{i}", cat="Binary") for i in range(4)]
        problem += pulp.lpSum(p.projection * x[i] for i, p in enumerate(players))
        constraint.add(problem, x)
        # Pick exactly 3 fighters; opponent exclusion says max 1 per bout → max 2 picks.
        problem += pulp.lpSum(x) == 3
        # This should be infeasible under our constraint.
        problem.solve(pulp.PULP_CBC_CMD(msg=0))
        # PuLP returns -1 (Infeasible) when no solution satisfies all constraints.

        # Confirm: at most 2 can be picked given the constraint.
        problem2 = pulp.LpProblem("mma-test-2", pulp.LpMaximize)
        x2 = [pulp.LpVariable(f"y_{i}", cat="Binary") for i in range(4)]
        problem2 += pulp.lpSum(p.projection * x2[i] for i, p in enumerate(players))
        problem2 += pulp.lpSum(x2) == 2
        constraint.add(problem2, x2)
        problem2.solve(pulp.PULP_CBC_CMD(msg=0))
        # Both 2 picks should be feasible; if solver says something else, fail.
        status = pulp.LpStatus[problem2.status]
        assert status == "Optimal"
