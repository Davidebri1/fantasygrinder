"""Golf models."""
from __future__ import annotations

import uuid

from django.db import models

from apps.common.models import Slate


class GolfPlayer(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="golf_players",
        limit_choices_to={"sport": "golf"},
    )
    name = models.CharField(max_length=128)
    salary = models.IntegerField()
    projection = models.FloatField(default=0.0)

    tee_time = models.DateTimeField(null=True, blank=True)

    projected_ownership = models.FloatField(default=0.0)
    max_ownership = models.FloatField(default=100.0)
    min_exposure = models.FloatField(default=0.0)
    max_exposure = models.FloatField(default=100.0)
    stddev = models.FloatField(null=True, blank=True)

    is_locked = models.BooleanField(default=False)
    is_excluded = models.BooleanField(default=False)
    is_liked = models.BooleanField(default=False)

    photo_url = models.URLField(max_length=512, blank="", default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["slate", "salary"]),
            models.Index(fields=["slate", "tee_time"]),
        ]


class GolfProjectionRow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slate = models.ForeignKey(
        Slate,
        on_delete=models.CASCADE,
        related_name="golf_projection_rows",
        limit_choices_to={"sport": "golf"},
        null=True,
        blank=True,
    )
    projection_date = models.DateField()
    player_id = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    projection = models.FloatField()
    stddev = models.FloatField(null=True, blank=True)
    tee_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["projection_date", "name", "-created_at"]),
        ]
