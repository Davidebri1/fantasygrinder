"""Tests for the NBA injury + news feed endpoints (mandatory DB experience)."""
from __future__ import annotations

import pytest
from django.test import Client

from apps.common.models import Slate
from apps.nba.models import NbaInjuryRow, NbaNewsRow


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def slate(db):
    return Slate.objects.create(
        sport="nba",
        slate_date="2026-04-04",
        slate_time="19:00:00",
        name="Feed Test Slate",
        is_active=True,
    )


@pytest.mark.django_db
def test_injuries_returns_empty_list(client):
    resp = client.get("/api/nba/injuries/")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.django_db
def test_injuries_returns_rows(client, slate):
    NbaInjuryRow.objects.create(
        slate=slate,
        player_id="1",
        name="LeBron James",
        team="LAL",
        status="out",
        severity="Hamstring",
        short_comment="Out indefinitely",
    )
    resp = client.get("/api/nba/injuries/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "LeBron James"
    assert body[0]["status"] == "out"


@pytest.mark.django_db
def test_injuries_filters_by_name(client, slate):
    NbaInjuryRow.objects.create(slate=slate, player_id="1", name="LeBron James", team="LAL", status="out")
    NbaInjuryRow.objects.create(slate=slate, player_id="2", name="Jayson Tatum", team="BOS", status="questionable")
    resp = client.get("/api/nba/injuries/?name=lebron")
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "LeBron James"


@pytest.mark.django_db
def test_news_returns_rows(client, slate):
    NbaNewsRow.objects.create(
        slate=slate,
        player_id="1",
        title="LeBron questionable",
        link="https://espn.com/story",
    )
    resp = client.get("/api/nba/news/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "LeBron questionable"


@pytest.mark.django_db
def test_injuries_respects_limit(client, slate):
    for i in range(250):
        NbaInjuryRow.objects.create(
            slate=slate, player_id=str(i), name=f"Player {i}", team="X", status="day_to_day"
        )
    resp = client.get("/api/nba/injuries/")
    assert len(resp.json()) <= 200
