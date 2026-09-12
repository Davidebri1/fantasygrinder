"""Golf admin."""
from django.contrib import admin

from .models import GolfPlayer, GolfProjectionRow


@admin.register(GolfPlayer)
class GolfPlayerAdmin(admin.ModelAdmin):
    list_display = ("name", "salary", "projection", "slate")
    list_filter = ("slate",)
    search_fields = ("name",)


@admin.register(GolfProjectionRow)
class GolfProjectionRowAdmin(admin.ModelAdmin):
    list_display = ("name", "projection", "projection_date")
    list_filter = ("projection_date",)
