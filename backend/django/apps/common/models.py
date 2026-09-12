"""Common models: slates, projection rows, app-side audit table."""
from __future__ import annotations

import uuid

from django.db import models


class Slate(models.Model):
    """One DraftKings contest for a given sport."""

    SPORT_CHOICES = [
        ("nba", "NBA"),
        ("mma", "MMA"),
        ("golf", "Golf"),
    ]
    SOURCE_FORMAT_CHOICES = [
        ("csv", "CSV"),
        ("excel", "Excel"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sport = models.CharField(max_length=10, choices=SPORT_CHOICES)
    slate_date = models.DateField()
    slate_time = models.TimeField()
    name = models.CharField(max_length=255)
    file_name = models.CharField(max_length=255, blank=True, default="")
    source_format = models.CharField(max_length=10, choices=SOURCE_FORMAT_CHOICES, default="csv")
    roster_blob = models.BinaryField(blank=True, null=True, editable=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-slate_date", "-slate_time"]
        indexes = [
            models.Index(fields=["sport", "is_active", "slate_date", "slate_time"]),
        ]

    def __str__(self) -> str:
        return f"{self.sport.upper()} {self.slate_date} {self.slate_time} — {self.name}"


class OptimizationRun(models.Model):
    """Audit trail of every /api/optimize call."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sport = models.CharField(max_length=10)
    solver_backend = models.CharField(max_length=16)
    strategy = models.CharField(max_length=32)
    request_settings = models.JSONField()
    result_count = models.IntegerField()
    top_score = models.FloatField(null=True, blank=True)
    elapsed_ms = models.IntegerField()
    warnings = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["sport", "created_at"]),
        ]


class SlateState(models.Model):
    """Per-slate user-editable state (locks, exposures, locks)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(Slate, on_delete=models.CASCADE, related_name="states")
    session_token = models.CharField(max_length=64)
    payload = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("slate", "session_token")]
        indexes = [models.Index(fields=["slate", "session_token"])]
