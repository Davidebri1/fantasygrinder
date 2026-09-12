"""Test settings — SQLite in-memory, no Postgres needed.

Used by pytest-django. Mirrors the dev settings except:
- DB is SQLite (in-memory) so tests don't require Postgres.
- Static files are disabled.
- DRF remains configured the same.
"""
from .settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

DEBUG = True
SECRET_KEY = "test-secret-key"
STATIC_URL = "static/"
ALLOWED_HOSTS = ["*"]
CORS_ALLOWED_ORIGINS = ["http://localhost:5173", "http://testserver"]

# Use SQLite-friendly JSON encoder
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Lower optimization thresholds for fast tests
FANTASY_GRINDER = {
    **FANTASY_GRINDER,  # type: ignore[name-defined]
    "ODDS_API_KEY": "",
    "MAX_OPTIMIZE_LINEUPS": 50,
    "MAX_OPTIMIZE_SIMULATIONS": 1_000,
}
