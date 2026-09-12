"""Populate the database with real NBA data from ESPN.

Pulls the 30 NBA teams, each roster (players with ESPN ids and headshot
URLs), plus the league-wide injury report and news feed, and writes them
to Postgres. No hand-written sample data.

Usage:
    python manage.py sync_espn_nba
    python manage.py sync_espn_nba --clear   # wipe ESPN-sourced rows first

Note on salaries/projections: ESPN does not publish DraftKings salaries
or projections. Those come from a DraftKings/FanDuel CSV, which the app
imports. This command fills everything ESPN does publish — players,
teams, positions, headshots, injuries, news — and leaves salary/
projection at 0 until a DFS file is imported.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import date, time, timedelta

from django.core.management.base import BaseCommand

from apps.common.models import Slate
from apps.nba.models import NbaInjuryRow, NbaNewsRow, NbaPlayer

ESPN_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_SLATE_NAME = "[ESPN] NBA Rosters"

# ESPN exposes coarse G / F / C. Map to the slots those players can fill
# on DraftKings so the optimizer can build valid lineups.
POSITION_MAP = {
    "G": (["G"], ["PG", "SG", "G", "UTIL"]),
    "PG": (["PG"], ["PG", "G", "UTIL"]),
    "SG": (["SG"], ["SG", "G", "UTIL"]),
    "F": (["F"], ["SF", "PF", "F", "UTIL"]),
    "SF": (["SF"], ["SF", "F", "UTIL"]),
    "PF": (["PF"], ["PF", "F", "UTIL"]),
    "C": (["C"], ["C", "UTIL"]),
}


def _get(url: str) -> dict:
    """Fetch JSON from ESPN.

    ESPN's CDN rejects Python's TLS fingerprint (403) but serves the same
    URL fine to curl, so we shell out to curl. Falls back to urllib if
    curl isn't available.
    """
    import shutil
    import subprocess

    if shutil.which("curl"):
        UA = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
        )
        out = subprocess.run(
            ["curl", "-sL", "-A", UA, "-H", "Accept: application/json", url],
            capture_output=True,
            timeout=60,
        )
        if out.returncode == 0 and out.stdout:
            return json.loads(out.stdout.decode("utf-8", errors="replace"))

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            ),
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


class Command(BaseCommand):
    help = "Populate the database with real NBA teams, players, injuries, and news from ESPN."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Delete ESPN-sourced players first.")

    def handle(self, *args, **options):
        slate, _ = Slate.objects.get_or_create(
            sport="nba",
            name=ESPN_SLATE_NAME,
            defaults={
                "slate_date": date.today() + timedelta(days=1),
                "slate_time": time(19, 0),
                "file_name": "espn",
                "source_format": "csv",
                "is_active": True,
            },
        )
        if options["clear"]:
            n, _ = NbaPlayer.objects.filter(slate=slate).delete()
            self.stdout.write(self.style.WARNING(f"Cleared {n} ESPN players."))

        teams = _get(f"{ESPN_BASE}/teams")["sports"][0]["leagues"][0]["teams"]
        self.stdout.write(f"ESPN returned {len(teams)} teams.")

        created = updated = 0
        for entry in teams:
            team = entry["team"]
            tid = team["id"]
            abbr = team.get("abbreviation", "")
            roster = _get(f"{ESPN_BASE}/teams/{tid}/roster")
            athletes = roster.get("athletes") or roster.get("items") or []
            for a in athletes:
                aid = str(a.get("id") or "")
                name = a.get("displayName") or a.get("fullName") or ""
                if not aid or not name:
                    continue
                pos_abbr = ((a.get("position") or {}).get("abbreviation") or "").upper()
                positions, roster_positions = POSITION_MAP.get(pos_abbr, (["G"], ["PG", "SG", "G", "UTIL"]))
                headshot = (a.get("headshot") or {}).get("href") or ""

                _obj, was_created = NbaPlayer.objects.update_or_create(
                    id=aid,
                    defaults={
                        "slate": slate,
                        "name": name,
                        "team": abbr,
                        "opponent": "",
                        "game_info": "",
                        "positions": positions,
                        "roster_positions": roster_positions,
                        "photo_url": headshot,
                        "salary": 0,
                        "projection": 0.0,
                    },
                )
                created += 1 if was_created else 0
                updated += 0 if was_created else 1

        self.stdout.write(self.style.SUCCESS(f"Players: {created} created, {updated} updated."))

        # Injuries + news (league-wide)
        injuries_synced = self._sync_injuries(slate)
        news_synced = self._sync_news(slate)
        self.stdout.write(
            self.style.SUCCESS(f"Injuries: {injuries_synced}. News: {news_synced}.")
        )

    def _sync_injuries(self, slate) -> int:
        try:
            payload = _get(f"{ESPN_BASE}/injuries")
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.WARNING(f"Injuries fetch failed: {exc}"))
            return 0
        rows = []
        for team_block in payload.get("items", []) or []:
            team_name = (team_block.get("team") or {}).get("displayName", "")
            for inj in team_block.get("injuries", []) or []:
                athlete = inj.get("athlete") or {}
                rows.append(
                    NbaInjuryRow(
                        slate=slate,
                        player_id=str(athlete.get("id", "")),
                        name=athlete.get("displayName", ""),
                        team=team_name,
                        status=(inj.get("status") or ""),
                        severity=((inj.get("type") or {}).get("text") or ""),
                        short_comment=inj.get("shortComment", "") or "",
                        long_comment=inj.get("longComment", "") or "",
                    )
                )
        if rows:
            NbaInjuryRow.objects.bulk_create(rows, ignore_conflicts=True)
        return len(rows)

    def _sync_news(self, slate) -> int:
        try:
            payload = _get(f"{ESPN_BASE}/news?limit=50")
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.WARNING(f"News fetch failed: {exc}"))
            return 0
        rows = []
        for article in payload.get("articles", []) or []:
            rows.append(
                NbaNewsRow(
                    slate=slate,
                    title=article.get("headline", ""),
                    link=((article.get("links") or {}).get("web") or {}).get("href", ""),
                    raw_row=article,
                )
            )
        if rows:
            NbaNewsRow.objects.bulk_create(rows, ignore_conflicts=True)
        return len(rows)
