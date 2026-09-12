"""API URL routing — mounted under /api/ by config.urls."""
from django.urls import path

from . import feeds, optimize, slates_players_io


urlpatterns = [
    # Slates
    path("slates/", slates_players_io.list_slates, name="slates-list"),
    path("slates/<uuid:slate_id>/", slates_players_io.slate_detail, name="slates-detail"),
    # Players
    path("players/", slates_players_io.list_players, name="players-list"),
    # Import
    path("import/csv/", slates_players_io.import_csv_view, name="import-csv"),
    path("import/excel/", slates_players_io.import_excel_view, name="import-excel"),
    # Optimize
    path("optimize/", optimize.optimize, name="optimize"),
    # Export
    path("export/csv/", slates_players_io.export_csv, name="export-csv"),
    path("export/excel/", slates_players_io.export_excel, name="export-excel"),
    path("export/injury-pdf/", slates_players_io.injury_pdf, name="export-injury-pdf"),
    # Feeds
    path("feed/odds/", feeds.feed_odds, name="feed-odds"),
    path("feed/espn/", feeds.feed_espn, name="feed-espn"),
]
