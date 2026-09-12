"""The Odds API client for NBA player props.

Pulls live prop lines from ``https://api.the-odds-api.com`` and converts
them to DraftKings NBA Classic fantasy-point projections using the DK
scoring rubric:

    DK NBA Classic = PTS × 1.0  +  3PM × 0.5  +  REB × 1.25  +  AST × 1.5
                  +  STL × 2.0  +  BLK × 2.0  −  TO × 0.5
                  +  Double-Double bonus 1.5  +  Triple-Double bonus 3.0

Free tier: 500 requests / month.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable

import requests

log = logging.getLogger("fantasy_grinder.integrations.odds")


@dataclass(slots=True)
class OddsApiConfig:
    api_key: str
    base_url: str = "https://api.the-odds-api.com/v4"
    sport: str = "basketball_nba"
    timeout_seconds: int = 30


@dataclass(slots=True)
class PlayerProp:
    player_name: str
    team: str
    opponent: str
    market: str  # 'player_points', etc.
    line: float


@dataclass(slots=True)
class PlayerGameStats:
    """Aggregated stats per player across the prop markets we care about."""

    player_name: str
    team: str
    opponent: str
    pts: float = 0.0
    threes: float = 0.0
    reb: float = 0.0
    ast: float = 0.0
    stl: float = 0.0
    blk: float = 0.0
    to: float = 0.0

    @property
    def dk_fantasy_projection(self) -> float:
        """Convert raw props to DraftKings fantasy points."""
        base = (
            self.pts * 1.0
            + self.threes * 0.5
            + self.reb * 1.25
            + self.ast * 1.5
            + self.stl * 2.0
            + self.blk * 2.0
            - self.to * 0.5
        )
        # Approximate DD/TD bonuses using a base-rate heuristic.
        # A player scoring ~40 DK points has ~30% chance of double-double,
        # and ~3% chance of triple-double. We discount by probability to keep
        # the bonus modest at the expected value.
        dd_bonus = 1.5 * (0.3 if base > 35 else 0.1 if base > 25 else 0.0)
        td_bonus = 3.0 * (0.03 if base > 45 else 0.0)
        return base + dd_bonus + td_bonus


_MARKETS = [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_steals",
    "player_blocks",
    "player_turnovers",
]


class OddsApiClient:
    def __init__(self, config: OddsApiConfig):
        self._config = config

    @property
    def enabled(self) -> bool:
        return bool(self._config.api_key)

    def fetch_events(self) -> list[dict]:
        """List today's NBA events with odds."""
        if not self.enabled:
            return []
        url = f"{self._config.base_url}/sports/{self._config.sport}/events"
        resp = requests.get(
            url,
            params={"apiKey": self._config.api_key, "dateFormat": "iso"},
            timeout=self._config.timeout_seconds,
        )
        resp.raise_for_status()
        return resp.json()

    def fetch_event_props(self, event_id: str) -> list[PlayerProp]:
        """Fetch all markets for a single event."""
        if not self.enabled:
            return []
        url = (
            f"{self._config.base_url}/sports/{self._config.sport}/events/{event_id}/odds"
        )
        resp = requests.get(
            url,
            params={
                "apiKey": self._config.api_key,
                "markets": ",".join(_MARKETS),
                "oddsFormat": "decimal",
            },
            timeout=self._config.timeout_seconds,
        )
        resp.raise_for_status()
        data = resp.json()
        return self._parse_props(data)

    @staticmethod
    def _parse_props(event_payload: dict) -> list[PlayerProp]:
        """Convert raw Odds API payload to PlayerProp records."""
        out: list[PlayerProp] = []
        home = event_payload.get("home_team", "")
        away = event_payload.get("away_team", "")
        for bookmaker in event_payload.get("bookmakers", []):
            for market in bookmaker.get("markets", []):
                market_key = market.get("key", "")
                for outcome in market.get("outcomes", []):
                    name = outcome.get("description", "")
                    if not name or name == "Over" or name == "Under":
                        continue
                    line = outcome.get("point")
                    if line is None:
                        continue
                    # Team-side label may hint at player team (sometimes
                    # included as "name Team"; we keep team as empty for now
                    # and let the caller match by name).
                    out.append(
                        PlayerProp(
                            player_name=name,
                            team="",
                            opponent="",
                            market=market_key,
                            line=float(line),
                        )
                    )
        # Avoid emitting duplicates across bookmakers (we keep the first).
        seen: set[tuple[str, str]] = set()
        deduped: list[PlayerProp] = []
        for p in out:
            key = (p.player_name, p.market)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(p)
        return deduped

    @staticmethod
    def aggregate_by_player(props: Iterable[PlayerProp]) -> dict[str, PlayerGameStats]:
        """Aggregate per-player props into a stat block ready for DK conversion."""
        agg: dict[str, PlayerGameStats] = {}
        for p in props:
            stats = agg.setdefault(p.player_name, PlayerGameStats(player_name=p.player_name, team=p.team, opponent=p.opponent))
            if p.market == "player_points":
                stats.pts = p.line
            elif p.market == "player_threes":
                stats.threes = p.line
            elif p.market == "player_rebounds":
                stats.reb = p.line
            elif p.market == "player_assists":
                stats.ast = p.line
            elif p.market == "player_steals":
                stats.stl = p.line
            elif p.market == "player_blocks":
                stats.blk = p.line
            elif p.market == "player_turnovers":
                stats.to = p.line
        return agg


def merge_into_player_pool(
    players: list[dict],
    projections: dict[str, PlayerGameStats],
) -> tuple[list[dict], int, int]:
    """Merge Odds API projections into the existing player pool.

    Args:
        players: list of player dicts (mutated in place).
        projections: name → PlayerGameStats.

    Returns:
        (players, matched_count, unmatched_count).
    """
    matched = 0
    unmatched = 0
    for p in players:
        name = p.get("name", "")
        stats = _match_name(name, projections)
        if stats is None:
            unmatched += 1
            continue
        new_projection = round(stats.dk_fantasy_projection, 2)
        p["projection"] = new_projection
        matched += 1
    return players, matched, unmatched


def _match_name(name: str, projections: dict[str, PlayerGameStats]) -> PlayerGameStats | None:
    """Fuzzy match a player name against the projection map.

    Simple case-insensitive prefix match plus a "First Last" vs "F. Last"
    normalization. For full robustness we'd wire in the name-matching
    service; for v1 this is sufficient.
    """
    if name in projections:
        return projections[name]
    lower = name.lower()
    for key, stats in projections.items():
        if key.lower() == lower:
            return stats
    parts = name.split()
    if len(parts) >= 2:
        first, last = parts[0], parts[-1]
        for key, stats in projections.items():
            k_parts = key.split()
            if len(k_parts) >= 2 and k_parts[0].lower() == first.lower() and k_parts[-1].lower() == last.lower():
                return stats
    return None
