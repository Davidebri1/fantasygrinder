"""CSV/Excel importers.

Mirrors the original Flutter ``CsvImportService`` and ``NbaProjectionImportService``
classes. Returns a `preview` payload that the frontend renders as a "match
preview" before the customer clicks "Confirm Import".

Auto-derived fields:

- ``positions``: parsed from DK Classic CSV's "Position" column (e.g., "PG/SG").
- ``game_info``: parsed from "Game Info" (e.g., "GSW@LAL 7:00pm ET").
- ``game_time``: parsed from "Team" + game info, in user's local timezone.
- ``roster_positions``: derived from positions (PG -> PG, G, UTIL).
- ``correlation_group``: regex-extracted "TEAM@TEAM" from game_info.

We deliberately stop short of running side effects (creating Slates,
inserting rows). The preview is returned to the caller, who decides
when to commit. This makes the import idempotent and easy to undo.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, time
from typing import Any

from openpyxl import load_workbook

from apps.common.models import Slate


# ───────────────────────────────────────────────────────────────────────────
# Header mappers per sport
# ───────────────────────────────────────────────────────────────────────────
_NBA_HEADERS = {
    "Name": "name",
    "Position": "positions",
    "Roster Position": "roster_positions",
    "Salary": "salary",
    "Game Info": "game_info",
    "TeamAbbrev": "team",
    "Opponent": "opponent",
    "AvgPointsPerGame": "dk_avg_points",
}

_MMA_HEADERS = {
    "Name": "name",
    "Fighter": "name",
    "Salary": "salary",
    "Bout": "bout",
    "Opponent": "opponent_id",
}

_GOLF_HEADERS = {
    "Name": "name",
    "Player": "name",
    "Salary": "salary",
    "Tee Time": "tee_time",
}


# ───────────────────────────────────────────────────────────────────────────
# Public API
# ───────────────────────────────────────────────────────────────────────────
def import_csv(*, sport: str, file_bytes: bytes, filename: str = "") -> dict[str, Any]:
    """Parse a CSV file and return an import preview."""
    if sport == "nba":
        return _parse_csv_nba(file_bytes)
    if sport == "mma":
        return _parse_csv_mma(file_bytes)
    if sport == "golf":
        return _parse_csv_golf(file_bytes)
    raise ValueError(f"Unknown sport: {sport}")


def import_excel(*, sport: str, file_bytes: bytes, filename: str = "") -> dict[str, Any]:
    """Parse an XLSX file and return an import preview."""
    if sport == "nba":
        return _parse_xlsx_nba(file_bytes)
    if sport == "mma":
        return _parse_xlsx_mma(file_bytes)
    if sport == "golf":
        return _parse_xlsx_golf(file_bytes)
    raise ValueError(f"Unknown sport: {sport}")


# ───────────────────────────────────────────────────────────────────────────
# Sport-specific parsers (CSV)
# ───────────────────────────────────────────────────────────────────────────
def _parse_csv_nba(file_bytes: bytes) -> dict[str, Any]:
    text = file_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    players: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in reader:
        try:
            salary = int(str(row.get("Salary", "0")).replace("$", "").replace(",", ""))
        except (TypeError, ValueError):
            salary = 0
            warnings.append(f"Bad salary on row {row.get('Name', '<unknown>')}")
        positions = [p.strip() for p in (row.get("Position", "") or "").split("/") if p.strip()]
        roster_positions = _derive_roster_positions(positions)
        game_info = row.get("Game Info", "")
        correlation_group = _extract_correlation_group(game_info)
        players.append(
            {
                "id": row.get("ID", row.get("Id", row.get("Player ID", ""))) or row.get("Name", ""),
                "name": row.get("Name", ""),
                "salary": salary,
                "projection": float(row.get("FPPG", 0) or 0),
                "team": row.get("TeamAbbrev", ""),
                "opponent": row.get("Opponent", ""),
                "game_info": game_info,
                "positions": positions,
                "roster_positions": roster_positions,
                "correlation_group": correlation_group,
            }
        )
    return {"sport": "nba", "players": players, "warnings": warnings}


def _parse_csv_mma(file_bytes: bytes) -> dict[str, Any]:
    text = file_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    players: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in reader:
        try:
            salary = int(str(row.get("Salary", "0")).replace("$", "").replace(",", ""))
        except (TypeError, ValueError):
            salary = 0
            warnings.append(f"Bad salary on row {row.get('Name', '<unknown>')}")
        players.append(
            {
                "id": row.get("ID", row.get("Id", "")) or row.get("Name", ""),
                "name": row.get("Name", row.get("Fighter", "")),
                "salary": salary,
                "projection": float(row.get("FPPG", 0) or 0),
                "opponent_id": row.get("Opponent", row.get("OpponentId", "")),
                "bout": row.get("Bout", ""),
            }
        )
    return {"sport": "mma", "players": players, "warnings": warnings}


def _parse_csv_golf(file_bytes: bytes) -> dict[str, Any]:
    text = file_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    players: list[dict[str, Any]] = []
    for row in reader:
        try:
            salary = int(str(row.get("Salary", "0")).replace("$", "").replace(",", ""))
        except (TypeError, ValueError):
            salary = 0
        players.append(
            {
                "id": row.get("ID", row.get("Id", "")) or row.get("Name", ""),
                "name": row.get("Name", row.get("Player", "")),
                "salary": salary,
                "projection": float(row.get("FPPG", 0) or 0),
                "tee_time": row.get("Tee Time"),
            }
        )
    return {"sport": "golf", "players": players, "warnings": []}


# ───────────────────────────────────────────────────────────────────────────
# Excel parsers
# ───────────────────────────────────────────────────────────────────────────
def _parse_xlsx_nba(file_bytes: bytes) -> dict[str, Any]:
    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"sport": "nba", "players": [], "warnings": ["Empty file"]}
    headers = [str(h or "").strip() for h in rows[0]]
    players: list[dict[str, Any]] = []
    warnings: list[str] = []
    for i, row in enumerate(rows[1:], start=1):
        if row is None or all(cell is None for cell in row):
            continue
        record = dict(zip(headers, row))
        salary = _safe_int(record.get("Salary"))
        positions = [p.strip() for p in str(record.get("Position", "") or "").split("/") if p.strip()]
        game_info = str(record.get("Game Info", "") or "")
        players.append(
            {
                "id": str(record.get("ID") or record.get("Name", f"row-{i}")),
                "name": str(record.get("Name", "") or ""),
                "salary": salary,
                "projection": _safe_float(record.get("FPPG")),
                "team": str(record.get("TeamAbbrev", "") or ""),
                "opponent": str(record.get("Opponent", "") or ""),
                "game_info": game_info,
                "positions": positions,
                "roster_positions": _derive_roster_positions(positions),
                "correlation_group": _extract_correlation_group(game_info),
            }
        )
    return {"sport": "nba", "players": players, "warnings": warnings}


def _parse_xlsx_mma(file_bytes: bytes) -> dict[str, Any]:
    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"sport": "mma", "players": [], "warnings": ["Empty file"]}
    headers = [str(h or "").strip() for h in rows[0]]
    players: list[dict[str, Any]] = []
    for i, row in enumerate(rows[1:], start=1):
        if row is None or all(cell is None for cell in row):
            continue
        record = dict(zip(headers, row))
        players.append(
            {
                "id": str(record.get("ID") or record.get("Name", f"row-{i}")),
                "name": str(record.get("Name", record.get("Fighter", ""))),
                "salary": _safe_int(record.get("Salary")),
                "projection": _safe_float(record.get("FPPG")),
                "opponent_id": str(record.get("Opponent", record.get("OpponentId", ""))),
                "bout": str(record.get("Bout", "")),
            }
        )
    return {"sport": "mma", "players": players, "warnings": []}


def _parse_xlsx_golf(file_bytes: bytes) -> dict[str, Any]:
    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"sport": "golf", "players": [], "warnings": ["Empty file"]}
    headers = [str(h or "").strip() for h in rows[0]]
    players: list[dict[str, Any]] = []
    for row in rows[1:]:
        if row is None or all(cell is None for cell in row):
            continue
        record = dict(zip(headers, row))
        players.append(
            {
                "id": str(record.get("ID") or record.get("Name", "")),
                "name": str(record.get("Name", record.get("Player", ""))),
                "salary": _safe_int(record.get("Salary")),
                "projection": _safe_float(record.get("FPPG")),
                "tee_time": str(record.get("Tee Time", "")),
            }
        )
    return {"sport": "golf", "players": players, "warnings": []}


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────
def _derive_roster_positions(positions: list[str]) -> list[str]:
    """PG -> PG, G, UTIL."""
    out: list[str] = list(positions)
    if "PG" in positions or "SG" in positions:
        if "G" not in out:
            out.append("G")
    if "SF" in positions or "PF" in positions:
        if "F" not in out:
            out.append("F")
    if "UTIL" not in out:
        out.append("UTIL")
    return out


def _extract_correlation_group(game_info: str) -> str:
    m = re.search(r"([A-Z]{2,4}@[A-Z]{2,4})", game_info or "")
    return m.group(1) if m else ""


def _safe_int(v: Any) -> int:
    try:
        return int(str(v or "0").replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _safe_float(v: Any) -> float:
    try:
        return float(str(v or "0").replace(",", ""))
    except (TypeError, ValueError):
        return 0.0
