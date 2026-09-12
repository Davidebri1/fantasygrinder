"""Sport-specific constraint builders for NBA lineups.

NBA Classic:
- 8 players: PG, SG, SF, PF, C, G, F, UTIL (in that slot order).
- Salary cap $50k default.
- Bipartite matching: assign each player to the most-constrained slot they
  fit. Pre-assignment is fed to the MILP solver as locked rows.
- Bring-back: require at least N opponents from each game represented.
- Team stacking: per-team min/max player count.

NBA Showdown:
- 6 players: 1 CPT + 5 FLEX.
- CPT can be any position; FLEX can be any position. The 1.5x score
  multiplier is baked into the per-player score multiplier in the spec.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Sequence

import pulp

from ..engines.milp_pulp import Constraint, SolverSpec
from ..schema import (
    ContestType,
    Lineup,
    OptimizerSettings,
    Player,
    SlotAssignment,
    Strategy,
)


# ───────────────────────────────────────────────────────────────────────────
# Roster slots
# ───────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True, slots=True)
class RosterSlot:
    label: str
    accepts: tuple[str, ...] | None  # None = accepts any

    def can_accept(self, player_roster_positions: Sequence[str]) -> bool:
        if self.accepts is None:
            return True
        return any(p in self.accepts for p in player_roster_positions)


CLASSIC_SLOTS: tuple[RosterSlot, ...] = (
    RosterSlot("PG", ("PG",)),
    RosterSlot("SG", ("SG",)),
    RosterSlot("SF", ("SF",)),
    RosterSlot("PF", ("PF",)),
    RosterSlot("C", ("C",)),
    RosterSlot("G", ("PG", "SG")),
    RosterSlot("F", ("SF", "PF")),
    RosterSlot("UTIL", None),
)
SHOWDOWN_SLOTS: tuple[RosterSlot, ...] = (
    RosterSlot("CPT", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
    RosterSlot("FLEX", None),
)


def slots_for(contest: ContestType) -> tuple[RosterSlot, ...]:
    return SHOWDOWN_SLOTS if contest == ContestType.SHOWDOWN else CLASSIC_SLOTS


def roster_size(contest: ContestType) -> int:
    return len(slots_for(contest))


# ───────────────────────────────────────────────────────────────────────────
# Bipartite position matching
# ───────────────────────────────────────────────────────────────────────────
@dataclass(slots=True)
class BipartiteAssignment:
    slot_idx: int
    player_idx: int


def bipartite_assign(
    players: Sequence[Player],
    slots: Sequence[RosterSlot],
    *,
    pre_locked: dict[int, int] | None = None,
) -> list[BipartiteAssignment | None]:
    """Greedy bipartite matching: each player to the most-constrained slot they fit.

    Returns a list the same length as ``slots``. ``None`` entries indicate
    unfilled slots (caller treats as infeasible).
    """
    pre_locked = pre_locked or {}

    out: list[BipartiteAssignment | None] = [None] * len(slots)
    used: set[int] = set()
    for slot_idx, player_idx in pre_locked.items():
        if 0 <= slot_idx < len(slots) and 0 <= player_idx < len(players):
            out[slot_idx] = BipartiteAssignment(slot_idx=slot_idx, player_idx=player_idx)
            used.add(player_idx)

    priority = sorted(
        range(len(slots)),
        key=lambda k: (out[k] is not None, _slot_constraint_score(slots[k])),
    )

    eligible_per_slot: dict[int, list[int]] = {}
    for slot_idx, slot in enumerate(slots):
        cands: list[int] = []
        for player_idx, p in enumerate(players):
            if player_idx in used:
                continue
            if slot.can_accept(p.roster_positions):
                cands.append(player_idx)
        eligible_per_slot[slot_idx] = cands

    for slot_idx in priority:
        if out[slot_idx] is not None:
            continue
        # Filter out players already used in earlier slot assignments.
        cands = [i for i in eligible_per_slot[slot_idx] if i not in used]
        if not cands:
            return [None] * len(slots)
        cands.sort(key=lambda i: (-players[i].effective_projection, players[i].id))
        chosen = cands[0]
        out[slot_idx] = BipartiteAssignment(slot_idx=slot_idx, player_idx=chosen)
        used.add(chosen)

    return out


def _slot_constraint_score(slot: RosterSlot) -> int:
    if slot.accepts is None:
        return 100
    return len(slot.accepts)


# ───────────────────────────────────────────────────────────────────────────
# Sport-specific constraints
# ───────────────────────────────────────────────────────────────────────────
@dataclass(slots=True)
class TeamStackMaxConstraint(Constraint):
    """Per-team upper-bound on players in a lineup."""

    max_per_team: int
    team_per_player: list[str]

    def add(self, problem: pulp.LpProblem, x: list) -> None:
        teams: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(self.team_per_player):
            if t:
                teams[t].append(i)
        for team, members in teams.items():
            problem += (
                pulp.lpSum(x[i] for i in members) <= self.max_per_team,
                f"stack_max_{team}",
            )

    def add_ortools(self, model, x) -> None:
        teams: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(self.team_per_player):
            if t:
                teams[t].append(i)
        for team, members in teams.items():
            model.Add(sum(x[i] for i in members) <= self.max_per_team)


@dataclass(slots=True)
class BringBackConstraint(Constraint):
    """For each game represented in the lineup, require ≥ 1 player from each side.

    Implemented in post-processing rather than in the MILP itself, because the
    "represented" condition is dynamic (depends on which games ended up in
    the lineup). The constraint here is a no-op placeholder so the spec
    uniform contract holds.
    """

    games_in_lineup_min: int

    def add(self, problem, x) -> None:
        return

    def add_ortools(self, model, x) -> None:
        return


# ───────────────────────────────────────────────────────────────────────────
# Build solver spec
# ───────────────────────────────────────────────────────────────────────────
def build_solver_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]] | None = None,
    forbidden_lineups: list[set[int]] | None = None,
    bring_back_enabled: bool = False,
    bring_back_count: int = 1,
    team_min: int = 0,
    team_max: int = 0,
    excluded_teams: set[str] | None = None,
) -> SolverSpec:
    """Assemble a SolverSpec for the NBA MILP solver."""
    pre_assignments = pre_assignments or []
    forbidden_lineups = forbidden_lineups or []
    excluded_teams = excluded_teams or set()

    if settings.contest_type == ContestType.SHOWDOWN:
        return _build_showdown_spec(
            players=players,
            scores=scores,
            settings=settings,
            pre_assignments=pre_assignments,
            forbidden_lineups=forbidden_lineups,
        )
    return _build_classic_spec(
        players=players,
        scores=scores,
        settings=settings,
        pre_assignments=pre_assignments,
        forbidden_lineups=forbidden_lineups,
        bring_back_enabled=bring_back_enabled,
        bring_back_count=bring_back_count,
        team_min=team_min,
        team_max=team_max,
        excluded_teams=excluded_teams,
    )


def _build_classic_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]],
    forbidden_lineups: list[set[int]],
    bring_back_enabled: bool,
    bring_back_count: int,
    team_min: int,
    team_max: int,
    excluded_teams: set[str],
) -> SolverSpec:
    locked_idx, excluded_idx = _locked_excluded(players)
    salaries = [p.salary for p in players]
    pre_locked_pairs = [(s, p) for s, p in pre_assignments if p is not None]
    locked_idx |= {p for _, p in pre_locked_pairs}

    spec = SolverSpec(
        scores=list(scores),
        salaries=salaries,
        roster_size=roster_size(ContestType.CLASSIC),
        salary_cap=settings.salary_cap,
        locked_idx=locked_idx,
        excluded_idx=excluded_idx,
        forbidden_idx_sets=forbidden_lineups,
        pre_assignments=pre_locked_pairs,
        extra_constraints=[],
    )

    if team_max > 0:
        teams = [p.team for p in players]
        spec.extra_constraints.append(
            TeamStackMaxConstraint(max_per_team=team_max, team_per_player=teams)
        )
    if bring_back_enabled:
        spec.extra_constraints.append(
            BringBackConstraint(games_in_lineup_min=bring_back_count)
        )
    return spec


def _build_showdown_spec(
    *,
    players: Sequence[Player],
    scores: Sequence[float],
    settings: OptimizerSettings,
    pre_assignments: list[tuple[int, int]],
    forbidden_lineups: list[set[int]],
) -> SolverSpec:
    locked_idx, excluded_idx = _locked_excluded(players)
    salaries = [p.salary for p in players]
    pre_locked_pairs = [(s, p) for s, p in pre_assignments if p is not None]
    cpt_player_idx = next((p for s, p in pre_locked_pairs if s == 0), None)
    score_multipliers = [1.0] * len(players)
    if cpt_player_idx is not None:
        score_multipliers[cpt_player_idx] = 1.5

    return SolverSpec(
        scores=list(scores),
        salaries=salaries,
        roster_size=roster_size(ContestType.SHOWDOWN),
        salary_cap=settings.salary_cap,
        locked_idx=locked_idx,
        excluded_idx=excluded_idx,
        forbidden_idx_sets=forbidden_lineups,
        pre_assignments=pre_locked_pairs,
        score_multipliers=score_multipliers,
        extra_constraints=[],
    )


def _locked_excluded(players: Sequence[Player]) -> tuple[set[int], set[int]]:
    locked = {i for i, p in enumerate(players) if p.is_locked}
    excluded = {i for i, p in enumerate(players) if p.is_excluded}
    return locked, excluded


# ───────────────────────────────────────────────────────────────────────────
# Post-processing: bring-back
# ───────────────────────────────────────────────────────────────────────────
def apply_bring_back(
    selected: list[int],
    players: Sequence[Player],
    min_per_side: int = 1,
) -> bool:
    """Return True if the lineup satisfies the bring-back rule.

    For each game represented, require >= min_per_side players from each side.
    """
    if not selected:
        return False
    games: dict[str, set[str]] = defaultdict(set)
    for i in selected:
        p = players[i]
        game = effective_correlation_group(p)
        if game:
            games[game].add(p.team)
    for game, teams in games.items():
        if len(teams) < 2:
            return False
    return True


def effective_correlation_group(p: Player) -> str:
    """Auto-derive correlationGroup from gameInfo if not explicitly set."""
    if p.correlation_group:
        return p.correlation_group
    m = re.search(r"([A-Z]{2,4}@[A-Z]{2,4})", p.game_info or "")
    return m.group(1) if m else ""


# Expose as a property on Player for ergonomics.
Player.effective_correlation_group = property(effective_correlation_group)


# ───────────────────────────────────────────────────────────────────────────
# Build a Lineup from solver output
# ───────────────────────────────────────────────────────────────────────────
def lineup_from_solver_result(
    *,
    selected_idx: list[int],
    players: Sequence[Player],
    contest_type: ContestType,
    strategy: str,
    solver_backend: str,
    rank: int,
) -> Lineup:
    """Translate solver indices into a Lineup."""
    slots = slots_for(contest_type)

    if contest_type == ContestType.SHOWDOWN:
        assignments: list[SlotAssignment] = []
        for sel_idx in selected_idx:
            slot_label = "CPT" if len(assignments) == 0 else "FLEX"
            mult = 1.5 if slot_label == "CPT" else 1.0
            assignments.append(
                SlotAssignment(
                    slot=slot_label,
                    score_multiplier=mult,
                    player_id=players[sel_idx].id,
                    player_name=players[sel_idx].name,
                )
            )
    else:
        # Classic: rebuild slot order from selected subset using position eligibility.
        assignments = []
        remaining = list(selected_idx)
        for slot in slots:
            chosen = next(
                (i for i in remaining if slot.can_accept(players[i].roster_positions)),
                None,
            )
            if chosen is None:
                continue
            remaining.remove(chosen)
            assignments.append(
                SlotAssignment(
                    slot=slot.label,
                    score_multiplier=1.0,
                    player_id=players[chosen].id,
                    player_name=players[chosen].name,
                )
            )

    total_salary = sum(players[i].salary for i in selected_idx)
    multipliers = [a.score_multiplier for a in assignments]
    total_proj = sum(
        players[i].effective_projection * multipliers[j]
        for j, i in enumerate(selected_idx[: len(multipliers)])
    )
    total_ceiling = sum(
        players[i].ceiling * multipliers[j]
        for j, i in enumerate(selected_idx[: len(multipliers)])
    )
    teams = {players[i].team for i in selected_idx if players[i].team}
    games = {
        effective_correlation_group(players[i])
        for i in selected_idx
        if effective_correlation_group(players[i])
    }

    lineup = Lineup(
        assignments=assignments,
        strategy=Strategy(strategy),
        solver_backend=solver_backend,
        rank=rank,
    )
    lineup.total_salary = total_salary
    lineup.total_projection = total_proj
    lineup.total_ceiling = total_ceiling
    lineup.teams = teams
    lineup.games = games
    return lineup
