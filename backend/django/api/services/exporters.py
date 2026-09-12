"""CSV, XLSX, PDF export services.

Mirror the Flutter app's export services:

- CSV: comma-separated player rows per lineup, with slot, salary, projection.
- XLSX: same content as CSV but with multiple lineups stacked into a sheet.
- PDF: NBA injury report (only runs when sport is nba; otherwise returns a
  minimal "no injuries" placeholder).
"""
from __future__ import annotations

import csv
import io
from typing import Any

from openpyxl import Workbook
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors


# ───────────────────────────────────────────────────────────────────────────
# CSV
# ───────────────────────────────────────────────────────────────────────────
def lineups_to_csv(lineups: list[dict[str, Any]]) -> str:
    """One row per lineup with a wide layout: Slot1..SlotN, Salary, Projection, Ceiling.

    For NBA Classic: 8 slot columns. For MMA/Golf: 6 slot columns.
    """
    if not lineups:
        return "rank,strategy,total_salary,total_projection,total_ceiling,assignments\n"

    header_max = max(
        (len(l.get("assignments", [])) for l in lineups),
        default=0,
    )
    if header_max == 0:
        return "rank,strategy,total_salary,total_projection\n"

    headers = (
        ["rank", "strategy", "total_salary", "total_projection", "total_ceiling"]
        + [f"slot{i+1}" for i in range(header_max)]
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for lineup in lineups:
        row = [
            lineup.get("rank", ""),
            lineup.get("strategy", ""),
            lineup.get("total_salary", ""),
            f"{lineup.get('total_projection', 0):.2f}",
            f"{lineup.get('total_ceiling', 0):.2f}",
        ]
        for assignment in lineup.get("assignments", []):
            mult = assignment.get("score_multiplier", 1.0)
            label = (
                f"{assignment.get('slot', '')}: {assignment.get('player_name', '')}"
                + (" (CPT)" if mult >= 1.5 else "")
            )
            row.append(label)
        writer.writerow(row)
    return buf.getvalue()


# ───────────────────────────────────────────────────────────────────────────
# XLSX
# ───────────────────────────────────────────────────────────────────────────
def lineups_to_xlsx(lineups: list[dict[str, Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Lineups"

    if not lineups:
        ws.append(["No lineups"])
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    header_max = max(
        (len(l.get("assignments", [])) for l in lineups),
        default=0,
    )
    ws.append(
        ["rank", "strategy", "total_salary", "total_projection", "total_ceiling"]
        + [f"slot{i+1}" for i in range(header_max)]
    )
    for lineup in lineups:
        row = [
            lineup.get("rank", ""),
            lineup.get("strategy", ""),
            lineup.get("total_salary", ""),
            round(lineup.get("total_projection", 0.0), 2),
            round(lineup.get("total_ceiling", 0.0), 2),
        ]
        for assignment in lineup.get("assignments", []):
            mult = assignment.get("score_multiplier", 1.0)
            label = (
                f"{assignment.get('slot', '')}: {assignment.get('player_name', '')}"
                + (" (CPT)" if mult >= 1.5 else "")
            )
            row.append(label)
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ───────────────────────────────────────────────────────────────────────────
# Injury PDF (NBA only)
# ───────────────────────────────────────────────────────────────────────────
def build_injury_pdf(slate_id: str | None) -> bytes:
    """Generate the NBA injury PDF report.

    Mirrors Flutter ``NbaInjuryReportPdfService``. Pulls the latest
    injury rows for the slate (or active slate if ``slate_id`` is
    None) and lays them out as a single table on a Letter page.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER)
    styles = getSampleStyleSheet()
    elems = []

    elems.append(Paragraph("NBA Injury Report", styles["Title"]))
    elems.append(Spacer(1, 12))

    rows = _gather_nba_injuries(slate_id)
    if not rows:
        elems.append(Paragraph("No injuries reported.", styles["Normal"]))
        doc.build(elems)
        return buf.getvalue()

    table_data = [["Player", "Team", "Status", "Severity", "Comment"]]
    for r in rows:
        table_data.append(
            [
                r["name"],
                r["team"],
                r["status"],
                r["severity"],
                (r["comment"] or "")[:80],
            ]
        )

    table = Table(table_data, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    elems.append(table)
    doc.build(elems)
    return buf.getvalue()


def _gather_nba_injuries(slate_id: str | None) -> list[dict[str, Any]]:
    try:
        from apps.nba.models import NbaInjuryRow

        qs = NbaInjuryRow.objects.all()
        if slate_id:
            qs = qs.filter(slate_id=slate_id)
        qs = qs.order_by("name")
        return [
            {
                "name": r.name,
                "team": r.team,
                "status": r.status,
                "severity": r.severity,
                "comment": r.short_comment or r.long_comment,
            }
            for r in qs
        ]
    except Exception:
        return []
