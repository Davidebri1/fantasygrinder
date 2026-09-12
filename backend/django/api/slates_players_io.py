"""Slates, players, import/export endpoint views."""
from __future__ import annotations

from datetime import datetime

from django.utils.dateparse import parse_date, parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.common.models import Slate, SlateState
from apps.golf.models import GolfPlayer
from apps.mma.models import MmaFighter
from apps.nba.models import NbaPlayer

from .serializers import PlayerInputSerializer
from .services.importers import import_csv, import_excel


@extend_schema(tags=["slates"], responses=Slate)
@api_view(["GET"])
@permission_classes([AllowAny])
def list_slates(request):
    sport = request.query_params.get("sport")
    if sport not in {"nba", "mma", "golf"}:
        return Response(
            {"code": "invalid_sport", "message": "sport must be nba/mma/golf"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    not_before = request.query_params.get("not_before_date")
    qs = Slate.objects.filter(sport=sport, is_active=True)
    if not_before:
        qs = qs.filter(slate_date__gte=parse_date(not_before))
    qs = qs.order_by("slate_date", "slate_time")
    return Response(
        [
            {
                "id": str(s.id),
                "sport": s.sport,
                "slate_date": s.slate_date.isoformat(),
                "slate_time": s.slate_time.isoformat(),
                "name": s.name,
                "file_name": s.file_name,
                "is_active": s.is_active,
                "created_at": s.created_at.isoformat(),
            }
            for s in qs
        ]
    )


@extend_schema(tags=["slates"])
@api_view(["GET"])
@permission_classes([AllowAny])
def slate_detail(request, slate_id):
    try:
        slate = Slate.objects.get(id=slate_id)
    except Slate.DoesNotExist:
        return Response(
            {"code": "not_found", "message": f"Slate {slate_id} not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    players = _players_for_slate(slate)
    return Response(
        {
            "id": str(slate.id),
            "sport": slate.sport,
            "slate_date": slate.slate_date.isoformat(),
            "slate_time": slate.slate_time.isoformat(),
            "name": slate.name,
            "file_name": slate.file_name,
            "is_active": slate.is_active,
            "created_at": slate.created_at.isoformat(),
            "players": players,
        }
    )


def _players_for_slate(slate):
    if slate.sport == "nba":
        return [_serialize_nba(p) for p in NbaPlayer.objects.filter(slate=slate)]
    if slate.sport == "mma":
        return [_serialize_mma(p) for p in MmaFighter.objects.filter(slate=slate)]
    if slate.sport == "golf":
        return [_serialize_golf(p) for p in GolfPlayer.objects.filter(slate=slate)]
    return []


def _serialize_nba(p: NbaPlayer) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sport": "nba",
        "salary": p.salary,
        "projection": p.projection,
        "user_projection": p.user_projection,
        "team": p.team,
        "opponent": p.opponent,
        "game_info": p.game_info,
        "game_time": p.game_time.isoformat() if p.game_time else None,
        "positions": p.positions,
        "roster_positions": p.roster_positions,
        "correlation_group": p.correlation_group,
        "projected_ownership": p.projected_ownership,
        "max_ownership": p.max_ownership,
        "min_exposure": p.min_exposure,
        "max_exposure": p.max_exposure,
        "stddev": p.stddev,
        "is_locked": p.is_locked,
        "is_excluded": p.is_excluded,
        "is_liked": p.is_liked,
        "injury_status": p.injury_status,
        "injury_severity": p.injury_severity,
    }


def _serialize_mma(p: MmaFighter) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sport": "mma",
        "salary": p.salary,
        "projection": p.projection,
        "opponent_id": p.opponent_id,
        "bout": p.bout,
        "projected_ownership": p.projected_ownership,
        "max_exposure": p.max_exposure,
        "is_locked": p.is_locked,
        "is_excluded": p.is_excluded,
        "is_liked": p.is_liked,
    }


def _serialize_golf(p: GolfPlayer) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sport": "golf",
        "salary": p.salary,
        "projection": p.projection,
        "tee_time": p.tee_time.isoformat() if p.tee_time else None,
        "projected_ownership": p.projected_ownership,
        "is_locked": p.is_locked,
        "is_excluded": p.is_excluded,
        "is_liked": p.is_liked,
    }


@extend_schema(tags=["players"])
@api_view(["GET"])
@permission_classes([AllowAny])
def list_players(request):
    slate_id = request.query_params.get("slate_id")
    sport = request.query_params.get("sport")

    # slate_id is sufficient — sport is inferred from the slate.
    if slate_id:
        try:
            slate = Slate.objects.get(id=slate_id)
        except (Slate.DoesNotExist, ValueError):
            return Response({"code": "not_found"}, status=404)
        return Response(_players_for_slate(slate))

    if sport not in {"nba", "mma", "golf"}:
        return Response(
            {"code": "invalid_sport", "message": "sport must be nba/mma/golf (or pass slate_id)"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # No slate_id — return players from the next active slate for the sport
    next_slate = (
        Slate.objects.filter(sport=sport, is_active=True)
        .order_by("slate_date", "slate_time")
        .first()
    )
    if next_slate is None:
        return Response([])
    return Response(_players_for_slate(next_slate))


@extend_schema(tags=["import"])
@api_view(["POST"])
@parser_classes([MultiPartParser])
@permission_classes([AllowAny])
def import_csv_view(request):
    sport = request.data.get("sport")
    if sport not in {"nba", "mma", "golf"}:
        return Response(
            {"code": "invalid_sport", "message": "sport must be nba/mma/golf"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    uploaded = request.FILES.get("file")
    if not uploaded:
        return Response(
            {"code": "missing_file", "message": "file is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        preview = import_csv(sport=sport, file_bytes=uploaded.read(), filename=uploaded.name)
    except Exception as exc:  # noqa: BLE001
        return Response(
            {"code": "import_failed", "message": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response(preview)


@extend_schema(tags=["import"])
@api_view(["POST"])
@parser_classes([MultiPartParser])
@permission_classes([AllowAny])
def import_excel_view(request):
    sport = request.data.get("sport")
    if sport not in {"nba", "mma", "golf"}:
        return Response(
            {"code": "invalid_sport", "message": "sport must be nba/mma/golf"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    uploaded = request.FILES.get("file")
    if not uploaded:
        return Response({"code": "missing_file"}, status=400)
    try:
        preview = import_excel(sport=sport, file_bytes=uploaded.read(), filename=uploaded.name)
    except Exception as exc:  # noqa: BLE001
        return Response(
            {"code": "import_failed", "message": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response(preview)


@extend_schema(tags=["export"])
@api_view(["POST"])
@permission_classes([AllowAny])
def export_csv(request):
    from .services.exporters import lineups_to_csv

    lineups = request.data.get("lineups", [])
    csv_text = lineups_to_csv(lineups)
    from django.http import HttpResponse

    resp = HttpResponse(csv_text, content_type="text/csv")
    resp["Content-Disposition"] = 'attachment; filename="lineups.csv"'
    return resp


@extend_schema(tags=["export"])
@api_view(["POST"])
@permission_classes([AllowAny])
def export_excel(request):
    from .services.exporters import lineups_to_xlsx

    lineups = request.data.get("lineups", [])
    xlsx_bytes = lineups_to_xlsx(lineups)
    from django.http import HttpResponse

    resp = HttpResponse(
        xlsx_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    resp["Content-Disposition"] = 'attachment; filename="lineups.xlsx"'
    return resp


@extend_schema(tags=["export"])
@api_view(["GET"])
@permission_classes([AllowAny])
def injury_pdf(request):
    from .services.exporters import build_injury_pdf

    slate_id = request.query_params.get("slate_id")
    pdf_bytes = build_injury_pdf(slate_id)
    from django.http import HttpResponse

    resp = HttpResponse(pdf_bytes, content_type="application/pdf")
    resp["Content-Disposition"] = 'inline; filename="injury_report.pdf"'
    return resp
