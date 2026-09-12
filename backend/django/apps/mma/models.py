"""MMA models."""
from __future__ import annotations

import uuid

from django.db import models

from apps.common.models import Slate


class MmaFighter(models.Model):
    """A single MMA fighter (or golf player) from a DraftKings contest."""

    id = models.CharField(max_length=64, primary_key=True)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="mma_fighters",
        limit_choices_to={"sport": "mma"},
    )
    name = models.CharField(max_length=128)
    salary = models.IntegerField()
    projection = models.FloatField(default=0.0)

    opponent_id = models.CharField(max_length=64, blank=True, default="")
    bout = models.CharField(max_length=128, blank=True, default="")

    projected_ownership = models.FloatField(default=0.0)
    max_ownership = models.FloatField(default=100.0)
    min_exposure = models.FloatField(default=0.0)
    max_exposure = models.FloatField(default=100.0)
    stddev = models.FloatField(null=True, blank=True)

    is_locked = models.BooleanField(default=False)
    is_excluded = models.BooleanField(default=False)
    is_liked = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["slate", "salary"]),
            models.Index(fields=["slate", "bout"]),
        ]


class MmaProjectionRow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="mma_projection_rows",
        limit_choices_to={"sport": "mma"},
        null=True,
        blank=True,
    )
    projection_date = models.DateField()
    fighter_id = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    projection = models.FloatField()
    stddev = models.FloatField(null=True, blank=True)
    bout = models.CharField(max_length=128, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["projection_date", "name", "-created_at"]),
        ]
