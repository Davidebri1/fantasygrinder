"""Populate the database with real MMA and Golf athletes from ESPN.

ESPN exposes a live UFC card (fighters) but no "list all golfers" endpoint,
so this command:
  - MMA:  reads the current UFC scoreboard; each competition is a bout and
          its two competitors are opponents.
  - Golf: reads the PGA scoreboard; if the field is empty (offseason) it
          falls back to a known PGA field of names.
Each athlete's ESPN id and headshot come live from ESPN's search API.
Salaries/projections still come from a DFS CSV import.

Usage:
    python manage.py sync_espn_athletes --sport mma
    python manage.py sync_espn_athletes --sport golf
"""
from __future__ import annotations

import json
import shutil
import subprocess
import urllib.parse
import urllib.request
from datetime import date, time, timedelta

from django.core.management.base import BaseCommand

from apps.common.models import Slate
from apps.golf.models import GolfPlayer
from apps.mma.models import MmaFighter

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)
SITE = "https://site.web.api.espn.com/apis/site/v2/sports"
SEARCH = "https://site.web.api.espn.com/apis/search/v2"

GOLF_FIELD = [
    "Scottie Scheffler", "Rory McIlroy", "Jon Rahm", "Brooks Koepka",
    "Xander Schauffele", "Viktor Hovland", "Jordan Spieth", "Collin Morikawa",
    "Tommy Fleetwood", "Wyndham Clark", "Ludvig Aberg", "Patrick Cantlay",
    "Hideki Matsuyama", "Cameron Young", "Sahith Theegala", "Max Homa",
]


def _get(url: str) -> dict:
    if shutil.which("curl"):
        out = subprocess.run(
            ["curl", "-sL", "-A", UA, "-H", "Accept: application/json", url],
            capture_output=True,
            timeout=60,
        )
        if out.returncode == 0 and out.stdout:
            return json.loads(out.stdout.decode("utf-8", errors="replace"))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _resolve_espn(name: str) -> tuple[str, str] | None:
    """Return (espn_id, headshot_url) for a name, or None."""
    qs = urllib.parse.urlencode({"query": name, "limit": "5", "region": "us", "lang": "en"})
    try:
        data = _get(f"{SEARCH}?{qs}")
    except Exception:
        return None
    for section in data.get("results", []):
        if section.get("type") != "player":
            continue
        for item in section.get("contents", []):
            img = (item.get("image") or {}).get("default")
            if img:
                uid = item.get("uid", "")
                espn_id = uid.split("~a:")[-1] if "~a:" in uid else str(item.get("id", ""))
                return espn_id, img
    return None


class Command(BaseCommand):
    help = "Populate the database with real MMA/Golf athletes (with ESPN headshots)."

    def add_arguments(self, parser):
        parser.add_argument("--sport", required=True, choices=["mma", "golf"])
        parser.add_argument("--clear", action="store_true")

    def handle(self, *args, **options):
        if options["sport"] == "mma":
            self._sync_mma(options["clear"])
        else:
            self._sync_golf(options["clear"])

    def _sync_mma(self, clear: bool):
        slate, _ = Slate.objects.get_or_create(
            sport="mma",
            name="[ESPN] UFC Card",
            defaults={"slate_date": date.today() + timedelta(days=1), "slate_time": time(22, 0),
                      "file_name": "espn", "source_format": "csv", "is_active": True},
        )
        if clear:
            n, _ = MmaFighter.objects.filter(slate=slate).delete()
            self.stdout.write(self.style.WARNING(f"Cleared {n} MMA fighters."))

        data = _get(f"{SITE}/mma/ufc/scoreboard")
        upserted = 0
        for ev in data.get("events", []):
            event_name = ev.get("name", "UFC Card")
            for comp in ev.get("competitions", []):
                sides = comp.get("competitors", [])
                names = [(s.get("athlete") or {}).get("displayName") for s in sides]
                ids: list[str] = []
                for nm in names:
                    if not nm:
                        ids.append("")
                        continue
                    resolved = _resolve_espn(nm)
                    fid = resolved[0] if resolved else f"espn-{abs(hash(nm))}"
                    headshot = resolved[1] if resolved else ""
                    ids.append(fid)
                    MmaFighter.objects.update_or_create(
                        id=fid,
                        defaults={
                            "slate": slate, "name": nm, "bout": event_name,
                            "photo_url": headshot, "salary": 0, "projection": 0.0,
                            "projected_ownership": 0.0,
                        },
                    )
                    upserted += 1
                # Set opponent_id now that both ids are known.
                if len(ids) == 2 and all(ids):
                    MmaFighter.objects.filter(id=ids[0]).update(opponent_id=ids[1])
                    MmaFighter.objects.filter(id=ids[1]).update(opponent_id=ids[0])
        self.stdout.write(self.style.SUCCESS(f"MMA fighters upserted: {upserted}"))

    def _sync_golf(self, clear: bool):
        slate, _ = Slate.objects.get_or_create(
            sport="golf",
            name="[ESPN] PGA Field",
            defaults={"slate_date": date.today() + timedelta(days=2), "slate_time": time(8, 0),
                      "file_name": "espn", "source_format": "csv", "is_active": True},
        )
        if clear:
            n, _ = GolfPlayer.objects.filter(slate=slate).delete()
            self.stdout.write(self.style.WARNING(f"Cleared {n} golfers."))

        data = _get(f"{SITE}/golf/pga/scoreboard")
        names: list[str] = []
        for ev in data.get("events", []):
            for comp in ev.get("competitions", []):
                for side in comp.get("competitors", []):
                    nm = (side.get("athlete") or {}).get("displayName")
                    if nm:
                        names.append(nm)
        if not names:
            names = list(GOLF_FIELD)

        upserted = 0
        for nm in names:
            resolved = _resolve_espn(nm)
            gid = resolved[0] if resolved else f"espn-{abs(hash(nm))}"
            headshot = resolved[1] if resolved else ""
            GolfPlayer.objects.update_or_create(
                id=gid,
                defaults={"slate": slate, "name": nm, "salary": 0, "projection": 0.0,
                          "projected_ownership": 0.0, "photo_url": headshot},
            )
            upserted += 1
        self.stdout.write(self.style.SUCCESS(f"Golfers upserted: {upserted}"))
