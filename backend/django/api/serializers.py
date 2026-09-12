"""DRF serializers.

These are the **wire** shapes. The optimizer works with dataclasses
(:mod:`optimizer.schema`); these serializers translate between the wire
and the dataclasses so the optimizer stays pure Python.

One serializer per request shape:

- :class:`PlayerInputSerializer` — incoming player (from CSV import or
  pre-saved slate).
- :class:`OptimizeRequestSerializer` — incoming optimize call.
- :class:`OptimizeResponseSerializer` — outgoing lineups + metadata.
"""
from __future__ import annotations

from rest_framework import serializers

from optimizer.schema import ContestType, Strategy


class PlayerInputSerializer(serializers.Serializer):
    """One player in an optimize / import request."""

    id = serializers.CharField()
    name = serializers.CharField()
    # Sport is supplied at the request top level; the per-player field is
    # optional and only used by the import preview endpoint which can carry
    # mixed-sport batches.
    sport = serializers.ChoiceField(
        choices=["nba", "mma", "golf"], required=False, allow_null=True
    )
    salary = serializers.IntegerField()
    projection = serializers.FloatField(required=False, default=0.0)
    user_projection = serializers.FloatField(required=False, allow_null=True, default=None)
    team = serializers.CharField(required=False, allow_blank=True, default="")
    opponent = serializers.CharField(required=False, allow_blank=True, default="")
    game_info = serializers.CharField(required=False, allow_blank=True, default="")
    game_time = serializers.CharField(required=False, allow_null=True, default=None)
    positions = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    roster_positions = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )
    correlation_group = serializers.CharField(required=False, allow_blank=True, default="")
    opponent_id = serializers.CharField(required=False, allow_blank=True, default="")
    bout = serializers.CharField(required=False, allow_blank=True, default="")
    projected_ownership = serializers.FloatField(required=False, default=0.0)
    max_ownership = serializers.FloatField(required=False, default=100.0)
    min_exposure = serializers.FloatField(required=False, default=0.0)
    max_exposure = serializers.FloatField(required=False, default=100.0)
    stddev = serializers.FloatField(required=False, allow_null=True, default=None)
    is_locked = serializers.BooleanField(required=False, default=False)
    is_excluded = serializers.BooleanField(required=False, default=False)
    is_liked = serializers.BooleanField(required=False, default=False)
    injury_status = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    injury_severity = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)


class NbaSettingsSerializer(serializers.Serializer):
    salary_cap = serializers.IntegerField(required=False, default=50_000)
    num_lineups = serializers.IntegerField(required=False, default=20)
    contest_type = serializers.ChoiceField(
        choices=[c.value for c in ContestType], required=False, default=ContestType.CLASSIC.value
    )
    strategy = serializers.ChoiceField(
        choices=[s.value for s in Strategy], required=False, default=Strategy.MONTE_CARLO.value
    )
    max_exposure = serializers.FloatField(required=False, default=100.0)
    max_attempts = serializers.IntegerField(required=False, default=5000)
    enable_bring_back = serializers.BooleanField(required=False, default=False)
    bring_back_count = serializers.IntegerField(required=False, default=1)
    global_min_players_per_team = serializers.IntegerField(required=False, default=0)
    global_max_players_per_team = serializers.IntegerField(required=False, default=0)
    team_stacking_rules = serializers.ListField(required=False, default=list)
    excluded_teams = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    respect_game_times = serializers.BooleanField(required=False, default=True)
    min_projection = serializers.FloatField(required=False, default=0.0)
    simulation_count = serializers.IntegerField(required=False, default=10_000)
    teammate_correlation = serializers.FloatField(required=False, default=0.35)
    opponent_correlation = serializers.FloatField(required=False, default=0.20)


class MmaSettingsSerializer(serializers.Serializer):
    salary_cap = serializers.IntegerField(required=False, default=50_000)
    num_lineups = serializers.IntegerField(required=False, default=20)
    strategy = serializers.ChoiceField(
        choices=[s.value for s in Strategy], required=False, default=Strategy.MONTE_CARLO.value
    )
    roster_size = serializers.IntegerField(required=False, default=6)
    allow_opponents = serializers.BooleanField(required=False, default=False)
    max_exposure = serializers.FloatField(required=False, default=100.0)
    min_projection = serializers.FloatField(required=False, default=0.0)
    simulation_count = serializers.IntegerField(required=False, default=10_000)
    opponent_correlation = serializers.FloatField(required=False, default=-0.40)
    card_correlation = serializers.FloatField(required=False, default=0.10)


class GolfSettingsSerializer(serializers.Serializer):
    salary_cap = serializers.IntegerField(required=False, default=50_000)
    num_lineups = serializers.IntegerField(required=False, default=20)
    strategy = serializers.ChoiceField(
        choices=[s.value for s in Strategy], required=False, default=Strategy.MONTE_CARLO.value
    )
    roster_size = serializers.IntegerField(required=False, default=6)
    max_exposure = serializers.FloatField(required=False, default=100.0)
    simulation_count = serializers.IntegerField(required=False, default=10_000)


class OptimizeRequestSerializer(serializers.Serializer):
    sport = serializers.ChoiceField(choices=["nba", "mma", "golf"])
    solver_backend = serializers.ChoiceField(
        choices=["pulp", "ortools"], required=False, default="pulp"
    )
    settings = serializers.DictField(required=True)
    players = serializers.ListField(child=PlayerInputSerializer(), allow_empty=False)
    include_lineup_ids = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    seeds = serializers.DictField(required=False, default=dict)


class SlotAssignmentSerializer(serializers.Serializer):
    slot = serializers.CharField()
    score_multiplier = serializers.FloatField()
    player_id = serializers.CharField()
    player_name = serializers.CharField()


class LineupSerializer(serializers.Serializer):
    assignments = SlotAssignmentSerializer(many=True)
    strategy = serializers.CharField()
    solver_backend = serializers.CharField()
    rank = serializers.IntegerField()
    total_salary = serializers.IntegerField()
    total_projection = serializers.FloatField()
    total_ceiling = serializers.FloatField()
    teams = serializers.ListField(child=serializers.CharField())
    games = serializers.ListField(child=serializers.CharField())
    unique_key = serializers.CharField()


class RunMetadataSerializer(serializers.Serializer):
    strategy = serializers.CharField()
    solver_backend = serializers.CharField()
    result_count = serializers.IntegerField()
    top_score = serializers.FloatField()
    elapsed_ms = serializers.IntegerField()
    warnings = serializers.ListField(child=serializers.CharField())


class OptimizeResponseSerializer(serializers.Serializer):
    lineups = LineupSerializer(many=True)
    run_metadata = RunMetadataSerializer()
