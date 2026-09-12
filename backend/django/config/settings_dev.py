"""Dev/prod settings — Postgres via DATABASE_URL (Neon), SQLite fallback.

Set DATABASE_URL in the environment (or .env) and every command — migrate,
load_sample_data, runserver — talks to that Postgres. No DATABASE_URL means
local SQLite, which is only for the offline demo.
"""
from pathlib import Path
from urllib.parse import unquote, urlparse

from .settings import *  # noqa: F401,F403

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() in {"1", "true", "yes"}
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
ALLOWED_HOSTS = ["*"]
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000",
    ).split(",")
    if o.strip()
]

DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    _u = urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(_u.path.lstrip("/")),
            "USER": unquote(_u.username or ""),
            "PASSWORD": unquote(_u.password or ""),
            "HOST": _u.hostname or "",
            "PORT": str(_u.port or 5432),
            "OPTIONS": {"sslmode": "require"},
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

FANTASY_GRINDER = {
    **FANTASY_GRINDER,  # type: ignore[name-defined]
    "ODDS_API_KEY": os.environ.get("ODDS_API_KEY", ""),
    "MAX_OPTIMIZE_LINEUPS": 500,
    "MAX_OPTIMIZE_SIMULATIONS": 50_000,
}
