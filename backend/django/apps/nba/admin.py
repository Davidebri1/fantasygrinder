"""NBA admin."""
from django.contrib import admin

from .models import NbaInjuryRow, NbaNewsRow, NbaPlayer, NbaProjectionRow


@admin.register(NbaProjectionRow)
class NbaProjectionRowAdmin(admin.ModelAdmin):
    list_display = ("name", "projection", "projection_date", "created_at")
    list_filter = ("projection_date",)
    search_fields = ("name",)


@admin.register(NbaInjuryRow)
class NbaInjuryRowAdmin(admin.ModelAdmin):
    list_display = ("name", "team", "status", "severity", "ingested_at")
    list_filter = ("severity", "ingested_at")
    search_fields = ("name",)


@admin.register(NbaNewsRow)
class NbaNewsRowAdmin(admin.ModelAdmin):
    list_display = ("title", "published", "ingested_at")
    list_filter = ("ingested_at",)


@admin.register(NbaPlayer)
class NbaPlayerAdmin(admin.ModelAdmin):
    list_display = ("name", "team", "salary", "projection", "slate")
    list_filter = ("team", "slate")
    search_fields = ("name",)
