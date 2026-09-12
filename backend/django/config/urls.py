"""Project URL configuration.

All REST routes live under `/api/`. Admin lives at `/admin/`.
In dev, the React SPA build is served at `/` so the customer can hit
`http://localhost:8000` and get the full app.
"""
from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve as static_serve
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)


api_patterns = [
    path("", include("apps.common.urls")),
    path("", include("apps.nba.urls")),
    path("", include("apps.mma.urls")),
    path("", include("apps.golf.urls")),
    path("", include("api.urls")),
    # Schema / docs
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"),
    path("schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include((api_patterns, "api"))),
]

# Serve the React build at "/" so the customer can hit a single port.
# Falls back to index.html for client-side routing.
if settings.DEBUG:
    from pathlib import Path

    _DIST = Path(settings.BASE_DIR).parent / "frontend" / "react" / "dist"

    if _DIST.exists():
        urlpatterns += [
            re_path(
                r"^assets/(?P<path>.*)$",
                static_serve,
                {"document_root": _DIST / "assets"},
            ),
            re_path(
                r"^(?P<path>(favicon\.svg|index\.html))$",
                static_serve,
                {"document_root": _DIST},
            ),
        ]

