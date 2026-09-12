"""Optimize endpoint.

This is the only /api/ endpoint that is non-trivial. The other endpoints
are thin CRUD over the sport models. The optimize view:

1. Parses the request via :class:`OptimizeRequestSerializer`.
2. Constructs sport-keyed :class:`OptimizerSettings` from raw settings dict.
3. Translates players from wire to optimizer dataclasses.
4. Calls :func:`optimizer.run_optimization`.
5. Records an audit row in :class:`OptimizationRun`.
6. Returns the lineups + run metadata.
"""
from __future__ import annotations

import json
import logging

from django.db import transaction
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from apps.common.models import OptimizationRun
from optimizer.schema import (
    ContestType,
    OptimizerSettings,
    Player,
    Sport,
    Strategy,
)
from optimizer.run import run_optimization

from .serializers import OptimizeRequestSerializer, OptimizeResponseSerializer

log = logging.getLogger("fantasy_grinder.api.optimize")


class OptimizeThrottle(AnonRateThrottle):
    rate = "30/min"
    scope = "optimize"


@extend_schema(
    request=OptimizeRequestSerializer,
    responses={
        200: OptimizeResponseSerializer,
        400: OpenApiResponse(description="Validation failure"),
    },
    examples=[
        OpenApiExample(
            "NBA Classic max-projection",
            value={
                "sport": "nba",
                "solver_backend": "pulp",
                "settings": {
                    "salary_cap": 50000,
                    "num_lineups": 5,
                    "contest_type": "classic",
                    "strategy": "maxProjection",
                    "simulation_count": 1000,
                },
                "players": [
                    {"id": "1", "name": "Stephen Curry", "salary": 10500, "projection": 56.4,
                     "team": "GSW", "opponent": "LAL", "game_info": "GSW@LAL 7:00pm ET",
                     "positions": ["PG"], "roster_positions": ["PG", "G", "UTIL"]},
                ],
            },
            request_only=True,
        ),
    ],
    description="Run lineup optimization. The fastest perf comes from `solver_backend=pulp`.",
    tags=["optimize"],
)
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([OptimizeThrottle])
def optimize(request):
    """Main optimize endpoint."""
    serializer = OptimizeRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    sport = Sport(data["sport"])
    backend = data.get("solver_backend") or "pulp"
    settings_dict = data["settings"]
    players_wire = data["players"]
    seeds = data.get("seeds") or {}

    # Construct optimizer settings — sport-keyed field extractions.
    settings = _build_settings(sport, settings_dict)
    if seeds.get("monte_carlo") is not None:
        settings.seed = int(seeds["monte_carlo"])

    # Translate wire -> dataclass
    players = [_player_from_wire(sport, p) for p in players_wire]

    # Cap simulations globally
    sim_cap = 50_000
    if settings.simulation_count > sim_cap:
        settings.simulation_count = sim_cap

    # Run
    try:
        result = run_optimization(
            sport=sport,
            players=players,
            settings=settings,
            solver_backend=backend,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Optimizer raised")
        return Response(
            {"code": "optimizer_error", "message": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Audit
    _record_run(sport, backend, settings, result)

    # Return
    response_data = result.to_dict()
    response_serializer = OptimizeResponseSerializer(response_data)
    return Response(response_serializer.data, status=status.HTTP_200_OK)


def _build_settings(sport: Sport, settings_dict: dict) -> OptimizerSettings:
    """Translate flat settings dict into a sport-keyed :class:`OptimizerSettings`."""
    common_kwargs = {
        "salary_cap": settings_dict.get("salary_cap", 50_000),
        "num_lineups": settings_dict.get("num_lineups", 20),
        "max_exposure": settings_dict.get("max_exposure", 100.0),
        "min_projection": settings_dict.get("min_projection", 0.0),
        "simulation_count": settings_dict.get("simulation_count", 10_000),
    }

    if "strategy" in settings_dict:
        common_kwargs["strategy"] = Strategy(settings_dict["strategy"])

    if sport == Sport.NBA:
        common_kwargs["contest_type"] = ContestType(settings_dict.get("contest_type", "classic"))
        extras = {
            "teammate_correlation": settings_dict.get("teammate_correlation", 0.35),
            "opponent_correlation": settings_dict.get("opponent_correlation", 0.20),
            "excluded_teams": set(settings_dict.get("excluded_teams", [])),
            "respect_game_times": settings_dict.get("respect_game_times", True),
            "enable_bring_back": settings_dict.get("enable_bring_back", False),
            "bring_back_count": settings_dict.get("bring_back_count", 1),
            "team_min_players": settings_dict.get("global_min_players_per_team", 0),
            "team_max_players": settings_dict.get("global_max_players_per_team", 0),
        }
    elif sport == Sport.MMA:
        extras = {
            "allow_opponents": settings_dict.get("allow_opponents", False),
            "opponent_correlation": settings_dict.get("opponent_correlation", -0.40),
            "card_correlation": settings_dict.get("card_correlation", 0.10),
        }
    else:  # GOLF
        extras = {}

    return OptimizerSettings(sport=sport, **common_kwargs, extras=extras)


def _player_from_wire(sport: Sport, wire: dict) -> Player:
    """Wire dict -> optimizer :class:`Player` dataclass."""
    return Player.from_dict({**wire, "sport": sport.value})


@transaction.atomic
def _record_run(sport: Sport, backend: str, settings: OptimizerSettings, result) -> None:
    def _jsonify(obj):
        if isinstance(obj, set):
            return sorted(obj)
        if isinstance(obj, dict):
            return {k: _jsonify(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_jsonify(v) for v in obj]
        return obj

    OptimizationRun.objects.create(
        sport=sport.value,
        solver_backend=backend,
        strategy=settings.strategy.value,
        request_settings={
            "salary_cap": settings.salary_cap,
            "num_lineups": settings.num_lineups,
            "max_exposure": settings.max_exposure,
            "min_projection": settings.min_projection,
            "simulation_count": settings.simulation_count,
            "extras": _jsonify(settings.extras),
        },
        result_count=len(result.lineups),
        top_score=result.top_score,
        elapsed_ms=result.elapsed_ms,
        warnings=result.warnings,
    )
