"""External feed endpoints (Odds API + ESPN).

Mirrors the legacy Flutter app's ``NbaOddsApiService``, ``NbaEspnNewsService``,
``NbaEspnInjuryCsvExportService``, and ``NbaNewsSyncService``.

Each endpoint takes an optional ``slate_id`` query param and applies the
results to that slate's pool of players.
"""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from django.conf import settings

from apps.common.models import Slate


@api_view(["POST"])
@permission_classes([AllowAny])
def feed_odds(request):
    """Pull NBA player props from The Odds API and update the active slate.

    Body (optional): ``{"slate_id": "<uuid>"}`` — defaults to the next active NBA slate.
    """
    from integrations.odds_api import OddsApiClient, merge_into_player_pool

    config = settings.FANTASY_GRINDER
    api_key = config.get("ODDS_API_KEY", "")
    if not api_key:
        return Response(
            {"code": "missing_key", "message": "Set ODDS_API_KEY in environment to enable."},
            status=400,
        )

    slate_id = request.data.get("slate_id") if isinstance(request.data, dict) else None
    slate = _resolve_slate(slate_id, sport="nba")

    client = OddsApiClient(OddsApiConfig(api_key=api_key))
    if not client.enabled:
        return Response({"code": "client_disabled"}, status=400)

    props = []
    for event in client.fetch_events():
        props.extend(client.fetch_event_props(event["id"]))
    aggregated = OddsApiClient.aggregate_by_player(props)

    # Mutate the slate's player projections in-place.
    players = [
        {
            "id": p.id,
            "name": p.name,
            "projection": p.projection,
        }
        for p in slate.players.all()
    ]
    updated, matched, unmatched = merge_into_player_pool(players, aggregated)
    for upd in updated:
        p = slate.players.get(id=upd["id"])
        p.projection = upd["projection"]
        p.save(update_fields=["projection", "updated_at"])

    return Response(
        {
            "matched": matched,
            "unmatched": unmatched,
            "events_seen": len(client.fetch_events()) if False else len({p.player_name for p in props}),
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def feed_espn(request):
    """Sync NBA injury + news rows from ESPN."""
    from integrations.espn import EspnClient, persist_injuries, persist_news

    slate_id = request.data.get("slate_id") if isinstance(request.data, dict) else None
    slate = _resolve_slate(slate_id, sport="nba")

    client = EspnClient()
    injuries = client.fetch_injuries()
    news = client.fetch_news()
    inj_inserted = persist_injuries(slate, injuries)
    news_inserted = persist_news(slate, news)

    return Response(
        {
            "injuries_synced": inj_inserted,
            "news_synced": news_inserted,
            "warnings": [],
        }
    )


def _resolve_slate(slate_id, *, sport: str):
    qs = Slate.objects.filter(sport=sport, is_active=True)
    if slate_id:
        return qs.get(id=slate_id)
    return qs.order_by("slate_date", "slate_time").first()


# OddsApiConfig is referenced above; lazy import inside the function avoids
# pulling requests on import.
def OddsApiConfig(**kwargs):
    from integrations.odds_api import OddsApiConfig as _Config
    return _Config(**kwargs)
