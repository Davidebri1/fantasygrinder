"""Django settings for Fantasy Grinder backend.

Split deliberately simple: a single settings module reads from environment.
For staging/prod we deploy via Render which sets env vars directly; no
django-environ, no multiple settings files.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

# ───────────────────────────────────────────────────────────────────────────
# Core
# ───────────────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me-in-production")
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() in {"1", "true", "yes"}
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

# ───────────────────────────────────────────────────────────────────────────
# Applications — installed in dependency order
# ───────────────────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    # Django core
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
    # Local
    "apps.common",
    "apps.nba",
    "apps.mma",
    "apps.golf",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ───────────────────────────────────────────────────────────────────────────
# Database
#
# DATABASE_URL is the deploy contract: Render supplies it from the managed
# Postgres (see render.yaml) and CI supplies it for the test database. The
# PG* variables stay as a fallback for a Postgres started by hand.
#
# Ignoring DATABASE_URL here meant a deployed backend looked for a passwordless
# Postgres on localhost and never started.
# ───────────────────────────────────────────────────────────────────────────
_DATABASE_URL = os.environ.get("DATABASE_URL", "")

if _DATABASE_URL:
    _u = urlparse(_DATABASE_URL)
    _options = {}
    _sslmode = parse_qs(_u.query).get("sslmode", [None])[0]
    if _sslmode:
        _options["sslmode"] = _sslmode
    _db = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(_u.path.lstrip("/")),
        "USER": unquote(_u.username or ""),
        "PASSWORD": unquote(_u.password or ""),
        "HOST": _u.hostname or "",
        "PORT": str(_u.port or 5432),
    }
    if _options:
        _db["OPTIONS"] = _options
else:
    _db = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("PGDATABASE", "fantasy_grinder"),
        "USER": os.environ.get("PGUSER", "postgres"),
        "PASSWORD": os.environ.get("PGPASSWORD", ""),
        "HOST": os.environ.get("PGHOST", "localhost"),
        "PORT": os.environ.get("PGPORT", "5432"),
    }

DATABASES = {"default": _db}

# ───────────────────────────────────────────────────────────────────────────
# Passwords (admin only — anonymous user flow has no passwords)
# ───────────────────────────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/New_York"  # DFS tooling traditionally thinks in ET
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS: list[str] = []

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ───────────────────────────────────────────────────────────────────────────
# DRF
# ───────────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 200,
    "DEFAULT_THROTTLE_RATES": {
        "optimize": "30/min",  # cap optimizer call rate per IP
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Fantasy Grinder API",
    "DESCRIPTION": "DFS lineup optimizer for NBA, MMA, and Golf.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/",
}

# ───────────────────────────────────────────────────────────────────────────
# CORS — frontend runs on Netlify, dev on Vite's default 5173
# ───────────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

# ───────────────────────────────────────────────────────────────────────────
# Logging
# ───────────────────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "fantasy_grinder": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
    },
}

# ───────────────────────────────────────────────────────────────────────────
# App config
# ───────────────────────────────────────────────────────────────────────────
FANTASY_GRINDER = {
    "ODDS_API_KEY": os.environ.get("ODDS_API_KEY", ""),
    "ODDS_API_BASE_URL": "https://api.the-odds-api.com/v4",
    "MAX_OPTIMIZE_LINEUPS": 500,
    "MAX_OPTIMIZE_SIMULATIONS": 50_000,
    "ENABLE_DEVELOPER_ADMIN": os.environ.get("ENABLE_DEVELOPER_ADMIN", "false").lower() in {"1", "true", "yes"},
}
