/**
 * Client-side lineup export — no server roundtrip.
 *
 * Mirrors the `Exporters` service in `backend/django/api/services/exporters.py`
 * but uses xlsx (SheetJS) client-side and triggers downloads via a
 * transient `<a download>`.
 */
import * as XLSX from "xlsx";

import { projectionSourceText } from "@/lib/projection-source";

import type { Lineup, Player, SlotAssignment } from "@/types";

function flattenLineup(l: Lineup): string[] {
  return l.assignments.map((a) => {
    const mult = a.score_multiplier;
    const label = `${a.slot}: ${a.player_name}${mult >= 1.5 ? " (CPT)" : ""}`;
    return label;
  });
}

/**
 * Which projection sources this lineup's players came from, in plain
 * words. The export carries its own provenance rather than implying one.
 */
function projectionSourcesFor(lineup: Lineup): string {
  const sources = new Set<string>();
  for (const a of lineup.assignments) {
    const p = playersById.get(a.player_id);
    if (p) sources.add(projectionSourceText(p));
  }
  if (sources.size === 0) return "unknown";
  return [...sources].sort().join(" + ");
}

/** The pool the export was built from, so every player can be sourced. */
let playersById = new Map<string, Player>();

/** Tell the exporter which players these lineups came from. */
export function setExportPlayers(players: Player[]): void {
  playersById = new Map(players.map((p) => [p.id, p]));
}

export function exportLineupsCsv(lineups: Lineup[]): void {
  if (lineups.length === 0) return;
  const headerMax = Math.max(...lineups.map((l) => l.assignments.length));
  const headers = [
    "rank",
    "strategy",
    "total_salary",
    "total_projection",
    "projection_source",
    "total_ceiling",
    ...Array.from({ length: headerMax }, (_, i) => `slot${i + 1}`),
  ];
  const rows: string[][] = [headers];
  for (const l of lineups) {
    const row: string[] = [
      String(l.rank),
      l.strategy,
      String(l.total_salary),
      l.total_projection.toFixed(2),
      projectionSourcesFor(l),
      l.total_ceiling.toFixed(2),
      ...flattenLineup(l),
    ];
    rows.push(row);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  download(csv, "lineups.csv", "text/csv;charset=utf-8");
}

export function exportLineupsXlsx(lineups: Lineup[]): void {
  if (lineups.length === 0) return;
  const headerMax = Math.max(...lineups.map((l) => l.assignments.length));
  const headers = [
    "rank",
    "strategy",
    "total_salary",
    "total_projection",
    "projection_source",
    "total_ceiling",
    ...Array.from({ length: headerMax }, (_, i) => `slot${i + 1}`),
  ];
  const rows: (string | number)[][] = [headers];
  for (const l of lineups) {
    rows.push([
      l.rank,
      l.strategy,
      l.total_salary,
      Math.round(l.total_projection * 100) / 100,
      projectionSourcesFor(l),
      Math.round(l.total_ceiling * 100) / 100,
      ...flattenLineup(l),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lineups");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download(out, "lineups.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function download(data: string | Uint8Array, filename: string, mime: string) {
  const parts: BlobPart[] = [data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data];
  const blob = new Blob(parts, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
