"""NBA REST views — injuries and news feeds (part of the mandatory DB experience)."""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.common.models import Slate
from apps.nba.models import NbaInjuryRow, NbaNewsRow


@api_view(["GET"])
@permission_classes([AllowAny])
def injuries(request):
    """Latest injury rows. Optionally filtered by ?slate_id= or ?name=."""
    qs = NbaInjuryRow.objects.all().order_by("-ingested_at")
    slate_id = request.query_params.get("slate_id")
    name = request.query_params.get("name")
    if slate_id:
        qs = qs.filter(slate_id=slate_id)
    if name:
        qs = qs.filter(name__icontains=name)

    return Response(
        [
            {
                "player_id": r.player_id,
                "name": r.name,
                "team": r.team,
                "status": r.status,
                "severity": r.severity,
                "short_comment": r.short_comment,
                "long_comment": r.long_comment,
                "ingested_at": r.ingested_at.isoformat(),
            }
            for r in qs[:200]
        ]
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def news(request):
    """Latest news rows. Optionally filtered by ?slate_id= or ?player_id=."""
    qs = NbaNewsRow.objects.all().order_by("-published")
    slate_id = request.query_params.get("slate_id")
    player_id = request.query_params.get("player_id")
    if slate_id:
        qs = qs.filter(slate_id=slate_id)
    if player_id:
        qs = qs.filter(player_id=player_id)

    return Response(
        [
            {
                "player_id": r.player_id,
                "title": r.title,
                "published": r.published.isoformat() if r.published else None,
                "link": r.link,
            }
            for r in qs[:100]
        ]
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"module": "nba", "status": "ok"})
