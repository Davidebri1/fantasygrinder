"""MMA admin."""
from django.contrib import admin

from .models import MmaFighter, MmaProjectionRow


@admin.register(MmaFighter)
class MmaFighterAdmin(admin.ModelAdmin):
    list_display = ("name", "bout", "salary", "projection", "slate")
    list_filter = ("bout", "slate")
    search_fields = ("name",)


@admin.register(MmaProjectionRow)
class MmaProjectionRowAdmin(admin.ModelAdmin):
    list_display = ("name", "bout", "projection", "projection_date")
    list_filter = ("projection_date",)
