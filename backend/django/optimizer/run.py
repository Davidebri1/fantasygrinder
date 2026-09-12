"""Top-level orchestrator for the optimizer engine.

This module is the **public** API: callers (Django views, CLI, parity
tests) pass in players + settings, get back :class:`OptimizeResult`.

The structure mirrors the Flutter ``OptimizerService.generateLineups``
method. Step-by-step:

1. **Filter eligible players** (excluded, zero salary, min projection).
2. **Validate inputs** (locks fit, salary cap, sport-specific bipartite).
3. **Build correlation matrix** (sport-keyed) and run Monte Carlo if needed.
4. **Per strategy**: walk iteration plan (see :mod:`optimizer.strategies`),
   solve each via MILP, collect unique lineups.
5. **Post-filter**: NBA bring-back / team stacking / exposure.
6. **Sort by total_projection desc**, return top-K.
"""
from __future__ import annotations

import time
from typing import Sequence

import numpy as np

from .engines.milp_pulp import solve_pulp
from .engines.milp_ortools import solve_ortools
from .schema import (
    ContestType,
    Lineup,
    OptimizeResult,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
    filter_eligible,
)
from .simulation.cholesky import correlation_matrix_from
from .simulation.monte_carlo import run_batched
from .strategies import StrategyPipeline
from .sports import golf as golf_constraints
from .sports import mma as mma_constraints
from .sports import nba as nba_constraints


_SPORT_MODULES = {
    Sport.NBA: nba_constraints,
    Sport.MMA: mma_constraints,
    Sport.GOLF: golf_constraints,
}


def _nba_pre_assign(sport: Sport, eligible: list[Player], settings: OptimizerSettings) -> list[tuple[int, int]]:
    """Run NBA bipartite position matching and return pre_assignments for the MILP.

    Returns ``[(slot_idx, player_idx), ...]``. If the match is incomplete
    (some slot has no eligible player), we return ``[]`` and the MILP will
    fall back to picking without position locks. The downstream lineup
    builder then drops these unlocked lineups.

    For non-NBA sports this is a no-op.
    """
    if sport != Sport.NBA:
        return []
    if settings.contest_type == ContestType.SHOWDOWN:
        # Showdown: lock the highest-projection player as CPT, no slot logic
        best = max(range(len(eligible)), key=lambda i: eligible[i].effective_projection)
        return [(0, best)]
    # Classic: bipartite fill
    assignments = nba_constraints.bipartite_assign(
        eligible, nba_constraints.CLASSIC_SLOTS
    )
    return [
        (slot_idx, assignment.player_idx)
        for slot_idx, assignment in enumerate(assignments)
        if assignment is not None
    ]


def _resolve_backend(backend: str) -> callable:
    if backend == "ortools":
        return solve_ortools
    return solve_pulp


def run_optimization(
    *,
    sport: Sport,
    players: Sequence[Player],
    settings: OptimizerSettings,
    solver_backend: str = "pulp",
) -> OptimizeResult:
    """Run the optimizer and return lineups.

    Args:
        sport: NBA, MMA, or GOLF.
        players: any iterable of :class:`Player` records.
        settings: strategy, salary cap, sim count, sport-specific extras.
        solver_backend: ``"pulp"`` (default) or ``"ortools"``.

    Raises:
        ValueError if inputs are infeasible.
    """
    started = time.perf_counter()
    warnings: list[str] = []

    # 1. Filter
    eligible = filter_eligible(players, settings, settings.extras)
    if len(eligible) < _roster_size_for(sport, settings):
        return OptimizeResult(
            lineups=[],
            strategy=settings.strategy,
            solver_backend=solver_backend,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            warnings=[
                f"Need >= {_roster_size_for(sport, settings)} eligible players; have {len(eligible)}."
            ],
        )

    sport_module = _SPORT_MODULES[sport]
    backend_solver = _resolve_backend(solver_backend)

    # 2. NBA Classic uses a slot-aware MILP solver (x[i] + y[i,s] formulation)
    #    so we don't lose diversity by pre-locking positions. Showdown/MMA/Golf
    #    fall through to the slot-agnostic path.
    use_slot_aware_nba = (
        sport == Sport.NBA and settings.contest_type == ContestType.CLASSIC
    )

    pipeline = StrategyPipeline(strategy=settings.strategy)

    simulated_slate: np.ndarray | None = None
    if settings.strategy in (Strategy.MONTE_CARLO, Strategy.CONTRARIAN):
        means = np.array([p.effective_projection for p in eligible])
        stds = np.array([p.effective_stddev for p in eligible])
        correlation = _build_correlation(sport, eligible, settings)
        simulated_slate = run_batched(
            means=means,
            stds=stds,
            correlation=correlation,
            sim_count=settings.simulation_count,
            seed=settings.seed,
        )

    # 3. Iterate the strategy plan
    iteration_plan = pipeline.iter(eligible, settings, simulated_slate)
    forbidden: list[set[int]] = []
    collected: dict[str, Lineup] = {}

    for strat_result in iteration_plan:
        if use_slot_aware_nba:
            # Slot-aware path: each solve yields a *different* lineup because
            # players are not pre-locked. The dedup happens via unique_key.
            from .sports.nba_classic_solver import (
                lineup_from_slot_solution,
                solve_classic_with_slots,
            )

            locked = {i for i, p in enumerate(eligible) if p.is_locked}
            excluded = {i for i, p in enumerate(eligible) if p.is_excluded}

            selected, value, salary, status, _ms = solve_classic_with_slots(
                players=eligible,
                scores=strat_result.scores,
                salary_cap=settings.salary_cap,
                locked_idx=locked,
                excluded_idx=excluded,
                forbidden_lineups=forbidden,
            )
            if status != "Optimal" or not selected:
                continue

            # We need to recover slot assignments. The MILP had y[i,s] but
            # we didn't return them. Re-derive via bipartite_assign on the
            # selected subset (greedy by score).
            from .sports.nba import bipartite_assign, CLASSIC_SLOTS

            slot_assigns = bipartite_assign(
                [eligible[i] for i in selected], CLASSIC_SLOTS
            )
            if any(s is None for s in slot_assigns):
                # Slot fill failed; treat the iteration as infeasible and continue
                continue
            slot_player_idx = [s.player_idx for s in slot_assigns if s is not None]
            lineup = lineup_from_slot_solution(
                players=[eligible[i] for i in selected],
                scores=[strat_result.scores[i] for i in selected],
                slot_assignments=list(range(len(slot_player_idx))),
                solver_backend=solver_backend,
                strategy=settings.strategy,
                rank=0,
            )
            # Map lineup back to the original eligible index set for dedup
            lineup_unique_ids = sorted([selected[a] for a in slot_player_idx])
        else:
            spec = sport_module.build_solver_spec(
                players=eligible,
                scores=strat_result.scores,
                settings=settings,
                pre_assignments=[],
                forbidden_lineups=forbidden,
            )
            # Cap attempts → tighten the solver's time limit
            if settings.max_attempts and settings.max_attempts < 5000:
                spec.time_limit_ms = min(spec.time_limit_ms, settings.max_attempts)

            result = backend_solver(spec)
            if result.status != "Optimal" or not result.selected_idx:
                continue

            lineup_kwargs = dict(
                selected_idx=result.selected_idx,
                players=eligible,
                strategy=settings.strategy.value,
                solver_backend=solver_backend,
                rank=0,
            )
            if sport == Sport.NBA:
                lineup_kwargs["contest_type"] = settings.contest_type
            lineup = sport_module.lineup_from_solver_result(**lineup_kwargs)
            # Reject incomplete lineups: we accept any non-empty lineup as long
            # as its assignment count matches the actual solver selection. The
            # non-slot-aware sport modules may legitimately produce fewer slots
            # (e.g., MMA with allow_opponents=False caps roster at # bouts).
            if len(lineup.assignments) != len(result.selected_idx):
                continue
            lineup_unique_ids = sorted(result.selected_idx)

        # Reject duplicates
        unique_key = "|".join(str(i) for i in lineup_unique_ids)
        if unique_key in collected:
            continue
        collected[unique_key] = lineup
        forbidden.append(set(lineup_unique_ids))

        if len(collected) >= settings.num_lineups:
            break

    # 5. Sort by total_projection desc, assign ranks
    ordered = sorted(collected.values(), key=lambda l: l.total_projection, reverse=True)
    for i, lineup in enumerate(ordered):
        lineup.rank = i + 1

    # 6. Trim
    ordered = ordered[: settings.num_lineups]
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return OptimizeResult(
        lineups=ordered,
        strategy=settings.strategy,
        solver_backend=solver_backend,
        elapsed_ms=elapsed_ms,
        warnings=warnings,
    )


def _roster_size_for(sport: Sport, settings: OptimizerSettings) -> int:
    if sport == Sport.NBA:
        from .sports.nba import roster_size
        return roster_size(settings.contest_type)
    if sport == Sport.MMA:
        return mma_constraints.MMA_ROSTER_SIZE
    if sport == Sport.GOLF:
        return golf_constraints.GOLF_ROSTER_SIZE
    raise ValueError(f"Unknown sport: {sport}")


def _build_correlation(sport: Sport, players: Sequence[Player], settings: OptimizerSettings):
    from .simulation.cholesky import (
        build_nba_correlation,
        build_pairwise_mma_correlation,
    )

    n = len(players)
    if sport == Sport.NBA:
        teams = [p.team for p in players]
        opponents = [p.opponent for p in players]
        m = build_nba_correlation(
            teams=teams,
            opponents=opponents,
            teammate_corr=settings.extras.get("teammate_correlation", 0.35),
            opponent_corr=settings.extras.get("opponent_correlation", 0.20),
            n=n,
        )
    elif sport == Sport.MMA:
        opp_ids = [p.opponent_id for p in players]
        bouts = [p.bout for p in players]
        m = build_pairwise_mma_correlation(
            opponent_ids=opp_ids,
            bout_ids=bouts,
            opponent_corr=settings.extras.get("opponent_correlation", -0.40),
            card_corr=settings.extras.get("card_correlation", 0.10),
            n=n,
        )
    else:  # GOLF
        m = np.eye(n)
    return correlation_matrix_from(m)
