"""End-to-end API endpoint tests using Django's test client.

Verifies the wire contracts documented in ``docs/openapi.yaml`` without
requiring a live Postgres or HTTP server.
"""
from __future__ import annotations

import pytest
from django.test import Client

from apps.common.models import OptimizationRun, Slate, SlateState


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def slate(db):
    return Slate.objects.create(
        sport="nba",
        slate_date="2026-04-04",
        slate_time="19:00:00",
        name="Test Slate",
        source_format="csv",
        is_active=True,
    )


@pytest.mark.django_db
def test_health_endpoint(client):
    resp = client.get("/api/health/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body


@pytest.mark.django_db
def test_slates_list_requires_sport(client):
    resp = client.get("/api/slates/")
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_sport"


@pytest.mark.django_db
def test_slates_list_returns_active_slates(client, slate):
    resp = client.get("/api/slates/?sport=nba")
    assert resp.status_code == 200
    body = resp.json()
    assert any(s["id"] == str(slate.id) for s in body)


def _make_player_list(n: int = 12) -> list[dict]:
    """Realistic 12-player DK-style roster used by several endpoint tests.

    Salaries are tuned so an 8-player subset fits the $50k cap: 1 star
    ($10k) + 4 mids ($6k) + 4 mid-lows ($4.5k) + 3 bench ($3k). Total
    pool = $61k; cheapest 8 = $33k.
    """
    positions = ["PG", "SG", "SF", "PF", "C"]
    salary_per_idx = [10000] + [6000] * 4 + [4500] * 4 + [3000] * 3
    players = []
    for i in range(n):
        pos = positions[i % 5]
        players.append(
            {
                "id": f"p{i:02d}",
                "name": f"Player {i}",
                "salary": salary_per_idx[i],
                "projection": 30.0 + i * 1.5,
                "team": "AAA" if i < 6 else "BBB",
                "opponent": "BBB" if i < 6 else "AAA",
                "game_info": "AAA@BBB 7:00pm ET",
                "positions": [pos],
                "roster_positions": _roster_positions_for(pos),
            }
        )
    return players


def _roster_positions_for(pos: str) -> list[str]:
    if pos == "PG":
        return ["PG", "G", "UTIL"]
    if pos == "SG":
        return ["SG", "G", "UTIL"]
    if pos == "SF":
        return ["SF", "F", "UTIL"]
    if pos == "PF":
        return ["PF", "F", "UTIL"]
    if pos == "C":
        return ["C", "UTIL"]
    return ["UTIL"]


@pytest.mark.django_db
def test_optimize_returns_lineups(client, slate):
    payload = {
        "sport": "nba",
        "solver_backend": "pulp",
        "settings": {
            "salary_cap": 50000,
            "num_lineups": 1,
            "contest_type": "classic",
            "strategy": "maxProjection",
            "simulation_count": 10,
        },
        "players": _make_player_list(),
    }
    resp = client.post(
        "/api/optimize/",
        data=payload,
        content_type="application/json",
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["run_metadata"]["strategy"] == "maxProjection"
    assert body["run_metadata"]["solver_backend"] == "pulp"
    assert body["run_metadata"]["result_count"] >= 1
    # 8-slot NBA Classic.
    lineup = body["lineups"][0]
    assert len(lineup["assignments"]) == 8
    assert lineup["total_salary"] <= 50000


@pytest.mark.django_db
def test_optimize_records_audit_row(client):
    payload = {
        "sport": "nba",
        "solver_backend": "pulp",
        "settings": {
            "salary_cap": 50000,
            "num_lineups": 1,
            "contest_type": "classic",
            "strategy": "maxProjection",
            "simulation_count": 10,
        },
        "players": _make_player_list(),
    }
    assert OptimizationRun.objects.count() == 0
    resp = client.post("/api/optimize/", data=payload, content_type="application/json")
    assert resp.status_code == 200, resp.content
    assert OptimizationRun.objects.count() == 1
    audit = OptimizationRun.objects.first()
    assert audit.sport == "nba"
    assert audit.strategy == "maxProjection"
    assert audit.result_count >= 1
    assert audit.elapsed_ms >= 0


@pytest.mark.django_db
def test_optimize_invalidates_missing_players(client):
    resp = client.post(
        "/api/optimize/",
        data={
            "sport": "nba",
            "settings": {"strategy": "maxProjection", "num_lineups": 1, "contest_type": "classic"},
            "players": [],
        },
        content_type="application/json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_export_csv(client):
    resp = client.post(
        "/api/export/csv/",
        data={
            "lineups": [
                {
                    "rank": 1,
                    "strategy": "monteCarlo",
                    "total_salary": 50000,
                    "total_projection": 280.0,
                    "total_ceiling": 320.0,
                    "assignments": [
                        {"slot": "PG", "score_multiplier": 1.0, "player_id": "1", "player_name": "Curry"},
                        {"slot": "SG", "score_multiplier": 1.0, "player_id": "2", "player_name": "Thompson"},
                    ],
                    "teams": ["GSW"],
                    "games": ["GSW@LAL"],
                    "unique_key": "1|2",
                }
            ]
        },
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert "text/csv" in resp["Content-Type"]
    csv = resp.content.decode()
    assert "Curry" in csv
    assert "Thompson" in csv


@pytest.mark.django_db
def test_export_excel(client):
    resp = client.post(
        "/api/export/excel/",
        data={
            "lineups": [
                {
                    "rank": 1, "strategy": "monteCarlo",
                    "total_salary": 50000, "total_projection": 280.0, "total_ceiling": 320.0,
                    "assignments": [{"slot": "PG", "score_multiplier": 1.0, "player_id": "1", "player_name": "Curry"}],
                    "teams": ["GSW"], "games": ["GSW@LAL"], "unique_key": "1",
                }
            ]
        },
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert "spreadsheetml" in resp["Content-Type"]
    # XLSX is a zip with [Content_Types].xml at the root.
    assert resp.content[:4] == b"PK\x03\x04"


@pytest.mark.django_db
def test_feed_odds_requires_api_key(client):
    resp = client.post(
        "/api/feed/odds/",
        data={},
        content_type="application/json",
    )
    # No ODDS_API_KEY in test env → 400 missing_key
    assert resp.status_code == 400
    assert resp.json()["code"] == "missing_key"


@pytest.mark.django_db
def test_import_csv_returns_preview(client):
    csv_bytes = (
        b"Name,Position,Salary,FPPG,Game Info,TeamAbbrev,Opponent\n"
        b"LeBron James,SF,10500,55.4,LAL@GSW,LAL,GSW\n"
        b"Stephen Curry,PG,9500,52.8,GSW@LAL,GSW,LAL\n"
    )
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload = SimpleUploadedFile("test.csv", csv_bytes, content_type="text/csv")
    resp = client.post(
        "/api/import/csv/",
        data={"sport": "nba", "file": upload},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sport"] == "nba"
    assert len(body["players"]) == 2
    assert body["players"][0]["name"] == "LeBron James"
