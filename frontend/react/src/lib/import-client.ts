/**
 * Client-side roster import — CSV and Excel, parsed in the browser.
 *
 * No backend is involved: the file is read locally with PapaParse / SheetJS
 * and mapped onto the app's Player shape. Column names follow the usual
 * DraftKings export (Name, Salary, Fpts/Projection, Team, Opponent, Pos).
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";

import type { Player, Sport } from "@/types";

interface ParsedRow {
  [key: string]: unknown;
}

function pick(row: ParsedRow, keys: string[]): string | undefined {
  const lower = new Map<string, string>();
  for (const key of Object.keys(row)) lower.set(key.toLowerCase().trim(), key);
  for (const candidate of keys) {
    const hit = lower.get(candidate.toLowerCase());
    if (hit !== undefined) {
      const value = row[hit];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }
  return undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[$,%]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "--") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function rosterPositions(pos: string | undefined): string[] {
  if (!pos) return ["UTIL"];
  const parts = pos
    .split(/[\/,|&\s-]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const known = ["PG", "SG", "SF", "PF", "C"];
  const out = new Set<string>(["UTIL"]);
  for (const p of parts) {
    if (known.includes(p)) {
      out.add(p);
      if (p === "PG" || p === "SG") out.add("G");
      if (p === "SF" || p === "PF") out.add("F");
    } else if (p === "G") {
      out.add("G");
    } else if (p === "F") {
      out.add("F");
    }
  }
  return [...out];
}

export function rowsToPlayers(rows: ParsedRow[], sport: Sport): Player[] {
  const players: Player[] = [];
  rows.forEach((row, index) => {
    const name = pick(row, ["Name", "Player", "Player Name", "Nickname"]);
    if (!name) return;
    const salary = toNumber(pick(row, ["Salary", "Cost", "Price"]));
    const projection = toNumber(
      pick(row, ["Projection", "Proj", "Fpts", "FPTS", "Fantasy Points", "Points", "Avg Points"]),
    );
    const pos = pick(row, ["Pos", "Position", "Positions"]);
    const team = pick(row, ["Team", "Tm", "Team Abbr", "Team Name"]);
    const opponent = pick(row, ["Opp", "Opponent", "Oponent"]);
    const gameInfo = pick(row, ["Game", "Game Info", "Matchup"]);
    const id = pick(row, ["Id", "Player ID", "PlayerID"]) ?? `${sport}-import-${index}`;

    players.push({
      id,
      name,
      sport,
      salary: salary ?? 5_000,
      projection: projection ?? 0,
      team,
      opponent,
      game_info: gameInfo,
      positions: pos ? [pos] : undefined,
      roster_positions: rosterPositions(pos),
      correlation_group: gameInfo,
      photo_url: null,
    });
  });
  return players;
}

export async function importCsvFile(file: File, sport: Sport): Promise<Player[]> {
  const text = await file.text();
  const parsed = Papa.parse<ParsedRow>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const rows = (parsed.data ?? []).filter((r) => r && Object.keys(r).length > 0);
  const players = rowsToPlayers(rows, sport);
  if (players.length === 0) {
    throw new Error(
      "No players found in that file. The first column needs a player name (Name / Player).",
    );
  }
  return players;
}

export async function importExcelFile(file: File, sport: Sport): Promise<Player[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("That workbook has no sheets.");
  const sheetRows = XLSX.utils.sheet_to_json<ParsedRow>(workbook.Sheets[firstSheet], {
    defval: "",
  });
  const players = rowsToPlayers(sheetRows ?? [], sport);
  if (players.length === 0) {
    throw new Error(
      "No players found on that sheet. The first column needs a player name (Name / Player).",
    );
  }
  return players;
}
