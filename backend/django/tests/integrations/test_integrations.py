"""Tests for the integrations layer (Odds API + ESPN).

These tests cover:
- OddsApiClient parsing of fixture payloads.
- DK fantasy-point projection conversion math.
- EspnClient parsing of fixture injury + news payloads.

Network calls are mocked via inline payloads so tests don't depend on
external APIs being reachable.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from integrations.espn import EspnClient
from integrations.odds_api import (
    OddsApiClient,
    merge_into_player_pool,
)


# ────────────────────────────────────────────────────────────────────────────
# Odds API
# ────────────────────────────────────────────────────────────────────────────
def test_odds_api_parses_event_payload():
    payload = {
        "id": "abc123",
        "home_team": "Los Angeles Lakers",
        "away_team": "Golden State Warriors",
        "bookmakers": [
            {
                "key": "draftkings",
                "markets": [
                    {
                        "key": "player_points",
                        "outcomes": [
                            {"description": "LeBron James", "point": 27.5, "name": "Over"},
                            {"description": "LeBron James", "point": 27.5, "name": "Under"},
                            {"description": "Stephen Curry", "point": 28.5, "name": "Over"},
                        ],
                    },
                    {
                        "key": "player_rebounds",
                        "outcomes": [
                            {"description": "LeBron James", "point": 8.5, "name": "Over"},
                            {"description": "Anthony Davis", "point": 11.5, "name": "Over"},
                        ],
                    },
                ],
            },
            {
                "key": "fanduel",
                "markets": [
                    {
                        "key": "player_points",
                        "outcomes": [
                            {"description": "LeBron James", "point": 28.0, "name": "Over"},
                        ],
                    },
                ],
            },
        ],
    }
    props = OddsApiClient._parse_props(payload)
    by_player_market = {(p.player_name, p.market) for p in props}
    assert ("LeBron James", "player_points") in by_player_market
    assert ("Stephen Curry", "player_points") in by_player_market
    assert ("LeBron James", "player_rebounds") in by_player_market
    assert ("Anthony Davis", "player_rebounds") in by_player_market
    # De-duplicated: only one LeBron James per market (we keep the first bookmaker).
    lebron_pts = [p for p in props if p.player_name == "LeBron James" and p.market == "player_points"]
    assert len(lebron_pts) == 1
    assert lebron_pts[0].line == 27.5  # First bookmaker (DraftKings) wins.


def test_aggregate_by_player_collapses_markets():
    from integrations.odds_api import PlayerProp

    props = [
        PlayerProp("LeBron", "", "", "player_points", 28.0),
        PlayerProp("LeBron", "", "", "player_threes", 2.5),
        PlayerProp("LeBron", "", "", "player_rebounds", 8.5),
        PlayerProp("LeBron", "", "", "player_assists", 7.5),
        PlayerProp("LeBron", "", "", "player_steals", 1.5),
        PlayerProp("LeBron", "", "", "player_blocks", 0.5),
        PlayerProp("LeBron", "", "", "player_turnovers", 3.5),
    ]
    agg = OddsApiClient.aggregate_by_player(props)
    assert "LeBron" in agg
    stats = agg["LeBron"]
    projection = stats.dk_fantasy_projection
    # Sanity: PTS×1 + 3PM×0.5 + REB×1.25 + AST×1.5 + STL×2 + BLK×2 - TO×0.5
    base = 28 + 1.25 + 10.625 + 11.25 + 3 + 1 - 1.75
    assert projection > base  # DD bonus adds at least some


def test_merge_into_player_pool_updates_matching_names():
    from integrations.odds_api import PlayerGameStats

    projections = {
        "LeBron James": PlayerGameStats(
            player_name="LeBron James",
            team="LAL",
            opponent="GSW",
            pts=27.0,
            threes=2.0,
            reb=8.0,
            ast=8.0,
            stl=1.5,
            blk=0.5,
            to=3.5,
        ),
        "Stephen Curry": PlayerGameStats(
            player_name="Stephen Curry",
            team="GSW",
            opponent="LAL",
            pts=29.0,
            threes=4.5,
        ),
    }
    players = [
        {"id": "1", "name": "LeBron James", "projection": 50.0},
        {"id": "2", "name": "Curry", "projection": 48.0},  # short name — should not match
        {"id": "3", "name": "Stephen Curry", "projection": 48.0},  # exact match
        {"id": "4", "name": "Anthony Davis", "projection": 45.0},  # no match
    ]
    updated, matched, unmatched = merge_into_player_pool(players, projections)
    assert matched == 2
    assert unmatched == 2
    lebron = next(p for p in updated if p["name"] == "LeBron James")
    assert 50.0 != lebron["projection"]  # changed
    curry_short = next(p for p in updated if p["id"] == "2")
    assert curry_short["projection"] == 48.0  # unchanged


# ────────────────────────────────────────────────────────────────────────────
# ESPN
# ────────────────────────────────────────────────────────────────────────────
def test_espn_parses_injuries_payload():
    payload = {
        "items": [
            {
                "team": {"displayName": "Los Angeles Lakers"},
                "injuries": [
                    {
                        "athlete": {"id": "1", "displayName": "LeBron James"},
                        "status": "out",
                        "type": {"text": "Hamstring"},
                        "shortComment": "DTD",
                        "longComment": "Out indefinitely",
                        "date": "2026-04-04T12:15:00Z",
                    }
                ],
            }
        ]
    }
    rows = EspnClient._parse_injuries(payload)
    assert len(rows) == 1
    assert rows[0].name == "LeBron James"
    assert rows[0].team == "Los Angeles Lakers"
    assert rows[0].status == "out"
    assert rows[0].severity == "Hamstring"
    assert rows[0].updated_at is not None
    assert rows[0].updated_at.year == 2026


def test_espn_parses_news_payload():
    payload = {
        "articles": [
            {
                "headline": "LeBron James questionable for tonight",
                "published": "2026-04-04T11:00:00Z",
                "playerId": "1",
                "links": {"web": {"href": "https://espn.com/nba/story/_/id/123"}},
            }
        ]
    }
    rows = EspnClient._parse_news(payload)
    assert len(rows) == 1
    assert rows[0].title == "LeBron James questionable for tonight"
    assert rows[0].player_id == "1"
    assert rows[0].link.startswith("https://")


def test_espn_handles_empty_payloads():
    assert EspnClient._parse_injuries({"items": []}) == []
    assert EspnClient._parse_news({"articles": []}) == []


def test_espn_handles_malformed_dates_gracefully():
    payload = {
        "items": [
            {
                "team": {"displayName": "Boston Celtics"},
                "injuries": [
                    {
                        "athlete": {"id": "2", "displayName": "Jayson Tatum"},
                        "status": "questionable",
                        "type": {"text": "Ankle"},
                        "shortComment": "",
                        "longComment": "",
                        "date": "not-a-date",
                    }
                ],
            }
        ]
    }
    rows = EspnClient._parse_injuries(payload)
    assert len(rows) == 1
    assert rows[0].updated_at is None
