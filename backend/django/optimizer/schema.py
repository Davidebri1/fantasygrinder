"""Sport-agnostic data classes used by the optimizer.

These are the contract between the Django apps and the optimizer engine.
The Django models (in `apps/<sport>/models.py`) translate their ORM rows
into these dataclasses before passing them to ``optimizer.run``.

We use dataclasses (not Pydantic, not Django models) so the optimizer is
importable in microseconds and the parity-test harness can compare
outputs structurally across language boundaries by serializing to JSON.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Iterable, Sequence


class Sport(str, Enum):
    NBA = "nba"
    MMA = "mma"
    GOLF = "golf"


class ContestType(str, Enum):
    """NBA-only. MMA and Golf have fungible slots and ignore this."""

    CLASSIC = "classic"
    SHOWDOWN = "showdown"


class Strategy(str, Enum):
    """Five strategies, mirroring the Flutter app's strategy dropdown."""

    MONTE_CARLO = "monteCarlo"
    MAX_PROJECTION = "maxProjection"
    CONTRARIAN = "contrarian"
    BALANCED = "balanced"
    SALARY_CAP = "salaryCap"


# ───────────────────────────────────────────────────────────────────────────
# Player
# ───────────────────────────────────────────────────────────────────────────
@dataclass
class Player:
    """A draftable entity for a DFS slate.

    Sport-agnostic. Sport-specific constraints (positions, opponents, bout)
    live in ``optimizer/sports/{nba,mma,golf}.py`` and read these fields as
    they need to.

    Fields mirror the Flutter ``NbaPlayer`` / ``Fighter`` / ``GolfPlayer``
    classes so parity is straightforward.
    """

    id: str
    name: str
    sport: Sport
    salary: int

    # Projections — ``projection`` is the optimizer's working number;
    # ``user_projection`` is the customer's manual override (kept separate
    # so we never accidentally clobber a manually-edited cell).
    projection: float = 0.0
    user_projection: float | None = None

    # NBA-only fields
    team: str = ""
    opponent: str = ""
    game_info: str = ""
    game_time: str | None = None  # ISO 8601 UTC
    positions: list[str] = field(default_factory=list)
    roster_positions: list[str] = field(default_factory=list)
    correlation_group: str = ""  # e.g. "CHA@PHX"

    # MMA-only fields
    opponent_id: str = ""  # used for opponent exclusion
    bout: str = ""  # bout key

    # Golf-only fields
    tee_time: str | None = None

    # All sports
    projected_ownership: float = 0.0  # 0..100
    max_ownership: float = 100.0
    min_exposure: float = 0.0  # 0..100
    max_exposure: float = 100.0  # 0..100
    stddev: float | None = None

    # Customer toggles
    is_locked: bool = False
    is_excluded: bool = False
    is_liked: bool = False

    # NBA injury display (informational only — optimizer doesn't weight it)
    injury_status: str | None = None
    injury_severity: str | None = None

    # ───────────────────────── derived helpers ─────────────────────────
    @property
    def effective_projection(self) -> float:
        """Working projection: user override > like-boost > base projection."""
        base = self.user_projection if self.user_projection is not None else self.projection
        return base * 1.15 if self.is_liked else base

    @property
    def effective_stddev(self) -> float:
        """Default stddev if not explicitly set, derived from projection tier."""
        if self.stddev is not None:
            return self.stddev
        return self.projection * self._stddev_multiplier(self.projection)

    @property
    def ceiling(self) -> float:
        return self.projection + 1.5 * self.effective_stddev

    @property
    def floor(self) -> float:
        return max(0.0, self.projection - 1.5 * self.effective_stddev)

    @property
    def value(self) -> float:
        """Projection per $1k of salary — used by the Balanced strategy."""
        if self.salary <= 0:
            return 0.0
        return self.projection / (self.salary / 1000.0)

    @staticmethod
    def _stddev_multiplier(projection: float) -> float:
        """Projection-based volatility tier. Lower projection = higher relative vol."""
        if projection >= 45:
            return 0.18
        if projection >= 35:
            return 0.20
        if projection >= 25:
            return 0.23
        if projection >= 15:
            return 0.27
        if projection > 0:
            return 0.32
        return 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "sport": self.sport.value,
            "salary": self.salary,
            "projection": self.projection,
            "user_projection": self.user_projection,
            "team": self.team,
            "opponent": self.opponent,
            "game_info": self.game_info,
            "game_time": self.game_time,
            "positions": list(self.positions),
            "roster_positions": list(self.roster_positions),
            "correlation_group": self.correlation_group,
            "opponent_id": self.opponent_id,
            "bout": self.bout,
            "tee_time": self.tee_time,
            "projected_ownership": self.projected_ownership,
            "max_ownership": self.max_ownership,
            "min_exposure": self.min_exposure,
            "max_exposure": self.max_exposure,
            "stddev": self.stddev,
            "is_locked": self.is_locked,
            "is_excluded": self.is_excluded,
            "is_liked": self.is_liked,
            "injury_status": self.injury_status,
            "injury_severity": self.injury_severity,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Player":
        sport = Sport(data.get("sport", "nba"))
        return cls(
            id=str(data["id"]),
            name=data["name"],
            sport=sport,
            salary=int(data.get("salary", 0)),
            projection=float(data.get("projection", 0.0)),
            user_projection=(
                float(data["user_projection"])
                if data.get("user_projection") is not None
                else None
            ),
            team=data.get("team", ""),
            opponent=data.get("opponent", ""),
            game_info=data.get("game_info", ""),
            game_time=data.get("game_time"),
            positions=list(data.get("positions", []) or []),
            roster_positions=list(data.get("roster_positions", []) or []),
            correlation_group=data.get("correlation_group", ""),
            opponent_id=data.get("opponent_id", ""),
            bout=data.get("bout", ""),
            tee_time=data.get("tee_time"),
            projected_ownership=float(data.get("projected_ownership", 0.0)),
            max_ownership=float(data.get("max_ownership", 100.0)),
            min_exposure=float(data.get("min_exposure", 0.0)),
            max_exposure=float(data.get("max_exposure", 100.0)),
            stddev=(
                float(data["stddev"])
                if data.get("stddev") is not None
                else None
            ),
            is_locked=bool(data.get("is_locked", False)),
            is_excluded=bool(data.get("is_excluded", False)),
            is_liked=bool(data.get("is_liked", False)),
            injury_status=data.get("injury_status"),
            injury_severity=data.get("injury_severity"),
        )


# ───────────────────────────────────────────────────────────────────────────
# Optimizer settings (sport-keyed)
# ───────────────────────────────────────────────────────────────────────────
@dataclass
class OptimizerSettings:
    """Settings for one optimization run.

    Sport-specific extensions live in sports/*.py — they construct this base
    class with sport-appropriate defaults and add their own fields.
    """

    sport: Sport
    strategy: Strategy = Strategy.MONTE_CARLO
    salary_cap: int = 50_000
    num_lineups: int = 20
    max_exposure: float = 100.0  # global ceiling, %
    max_attempts: int = 5_000
    min_projection: float = 0.0
    simulation_count: int = 10_000
    seed: int | None = None

    # NBA-only
    contest_type: ContestType = ContestType.CLASSIC

    # Carry-through sports-specific fields without strong typing here.
    extras: dict[str, Any] = field(default_factory=dict)

    def with_extras(self, **kv: Any) -> "OptimizerSettings":
        return replace(self, extras={**self.extras, **kv})


# ───────────────────────────────────────────────────────────────────────────
# Lineup result
# ───────────────────────────────────────────────────────────────────────────
@dataclass
class SlotAssignment:
    slot: str
    score_multiplier: float
    player_id: str
    player_name: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "slot": self.slot,
            "score_multiplier": self.score_multiplier,
            "player_id": self.player_id,
            "player_name": self.player_name,
        }


@dataclass
class Lineup:
    assignments: list[SlotAssignment]
    strategy: Strategy
    solver_backend: str
    rank: int = 0
    _total_salary: int = 0
    _total_projection: float = 0.0
    _total_ceiling: float = 0.0
    _teams: set[str] = field(default_factory=set)
    _games: set[str] = field(default_factory=set)

    @property
    def total_salary(self) -> int:
        return int(self._total_salary)

    @total_salary.setter
    def total_salary(self, v: int) -> None:
        self._total_salary = int(v)

    @property
    def total_projection(self) -> float:
        return float(self._total_projection)

    @total_projection.setter
    def total_projection(self, v: float) -> None:
        self._total_projection = float(v)

    @property
    def total_ceiling(self) -> float:
        return float(self._total_ceiling)

    @total_ceiling.setter
    def total_ceiling(self, v: float) -> None:
        self._total_ceiling = float(v)

    @property
    def teams(self) -> set[str]:
        return set(self._teams)

    @teams.setter
    def teams(self, v: set[str]) -> None:
        self._teams = set(v)

    @property
    def games(self) -> set[str]:
        return set(self._games)

    @games.setter
    def games(self, v: set[str]) -> None:
        self._games = set(v)

    @property
    def unique_key(self) -> str:
        ids = sorted(a.player_id for a in self.assignments)
        return "|".join(ids)

    def to_dict(self) -> dict[str, Any]:
        return {
            "assignments": [a.to_dict() for a in self.assignments],
            "strategy": self.strategy.value,
            "solver_backend": self.solver_backend,
            "rank": self.rank,
            "total_salary": self.total_salary,
            "total_projection": self.total_projection,
            "total_ceiling": self.total_ceiling,
            "teams": sorted(self.teams),
            "games": sorted(self.games),
            "unique_key": self.unique_key,
        }


@dataclass
class OptimizeResult:
    lineups: list[Lineup]
    strategy: Strategy
    solver_backend: str
    elapsed_ms: int
    warnings: list[str] = field(default_factory=list)

    @property
    def top_score(self) -> float:
        return max((l.total_projection for l in self.lineups), default=0.0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "lineups": [l.to_dict() for l in self.lineups],
            "run_metadata": {
                "strategy": self.strategy.value,
                "solver_backend": self.solver_backend,
                "result_count": len(self.lineups),
                "top_score": self.top_score,
                "elapsed_ms": self.elapsed_ms,
                "warnings": list(self.warnings),
            },
        }


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────
def filter_eligible(
    players: Iterable[Player],
    settings: OptimizerSettings,
    extras: dict[str, Any] | None = None,
) -> list[Player]:
    """Apply the common pre-filters: exclusions, zero salary, min projection,
    and NBA game-time / excluded-team / showdown-only filters when present.

    Returns a list of eligible players (deduped by id, preserving order).
    """
    extras = extras or {}
    excluded_teams = set(extras.get("excluded_teams", set()))
    respect_game_times = bool(extras.get("respect_game_times", True))
    zero_salary_excluded: list[Player] = []

    out: list[Player] = []
    seen: set[str] = set()
    for p in players:
        if p.id in seen:
            continue
        seen.add(p.id)
        if p.is_excluded:
            continue
        if p.salary <= 0:
            zero_salary_excluded.append(p)
            continue
        if p.effective_projection < settings.min_projection:
            continue
        if p.team and p.team in excluded_teams:
            continue
        out.append(p)
    return out


def default_stddev_for(projection: float) -> float:
    return projection * Player._stddev_multiplier(projection)
