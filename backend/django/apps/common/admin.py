"""Shared admin."""
from django.contrib import admin

from .models import OptimizationRun, Slate, SlateState


@admin.register(Slate)
class SlateAdmin(admin.ModelAdmin):
    list_display = ("sport", "slate_date", "slate_time", "name", "is_active")
    list_filter = ("sport", "is_active", "slate_date")
    search_fields = ("name", "file_name")


@admin.register(OptimizationRun)
class OptimizationRunAdmin(admin.ModelAdmin):
    list_display = ("sport", "strategy", "solver_backend", "result_count", "elapsed_ms", "created_at")
    list_filter = ("sport", "strategy", "solver_backend")
    readonly_fields = ("created_at",)


@admin.register(SlateState)
class SlateStateAdmin(admin.ModelAdmin):
    list_display = ("slate", "session_token", "updated_at")
