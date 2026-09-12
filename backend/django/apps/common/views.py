"""Common views (health, version)."""
from __future__ import annotations

import os

from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny


VERSION = "1.0.0"


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return JsonResponse(
        {
            "status": "ok",
            "service": "fantasy-grinder-api",
            "version": VERSION,
            "db": _db_check(),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def version(request):
    return JsonResponse(
        {
            "version": VERSION,
            "git_sha": os.environ.get("GIT_SHA", "unknown"),
        }
    )


def _db_check() -> str:
    from django.db import connection

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return "ok"
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"
