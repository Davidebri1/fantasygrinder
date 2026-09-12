/**
 * React Query hooks for every backend endpoint.
 *
 * Each hook is auto-named (filename-of-the-hook) and has typed inputs/outputs.
 * Components consume these instead of touching `axios` directly.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  type Lineup,
  type NbaSettings,
  type MmaSettings,
  type GolfSettings,
  type OptimizeResponse,
  type Player,
  type Slate,
  type SlateDetail,
} from "@/types";

import { api } from "./api";

// ────────────────────────────────────────────────────────────────────────
// Slates
// ────────────────────────────────────────────────────────────────────────
export function useSlates(sport: "nba" | "mma" | "golf") {
  return useQuery({
    queryKey: ["slates", sport],
    queryFn: async (): Promise<Slate[]> => {
      const { data } = await api.get<Slate[]>("/slates/", { params: { sport } });
      return data;
    },
  });
}

export function useSlate(slateId?: string) {
  return useQuery({
    enabled: !!slateId,
    queryKey: ["slate", slateId],
    queryFn: async (): Promise<SlateDetail> => {
      const { data } = await api.get<SlateDetail>(`/slates/${slateId}/`);
      return data;
    },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Players
// ────────────────────────────────────────────────────────────────────────
export function usePlayers(sport: "nba" | "mma" | "golf", slateId?: string) {
  return useQuery({
    queryKey: ["players", sport, slateId ?? "next"],
    queryFn: async (): Promise<Player[]> => {
      const params: Record<string, string> = { sport };
      if (slateId) params.slate_id = slateId;
      const { data } = await api.get<Player[]>("/players/", { params });
      return data;
    },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Optimize
// ────────────────────────────────────────────────────────────────────────
export interface OptimizeInput {
  sport: "nba" | "mma" | "golf";
  solver_backend?: "pulp" | "ortools";
  // Settings is intentionally typed as a JSON object — the wire format
  // varies by sport (NBA needs contest_type + correlations, MMA needs
  // allow_opponents, etc.) and the server validates the shape per-sport.
  settings: Record<string, unknown> | NbaSettings | MmaSettings | GolfSettings;
  players: Player[];
  seeds?: Record<string, number>;
}

export function useOptimize() {
  return useMutation({
    mutationFn: async (input: OptimizeInput): Promise<OptimizeResponse> => {
      const { data } = await api.post<OptimizeResponse>("/optimize/", input);
      return data;
    },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Import / Export
// ────────────────────────────────────────────────────────────────────────
export function useImportCsv() {
  return useMutation({
    mutationFn: async ({ sport, file }: { sport: "nba" | "mma" | "golf"; file: File }) => {
      const form = new FormData();
      form.append("sport", sport);
      form.append("file", file);
      const { data } = await api.post("/import/csv/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
  });
}

export function useImportExcel() {
  return useMutation({
    mutationFn: async ({ sport, file }: { sport: "nba" | "mma" | "golf"; file: File }) => {
      const form = new FormData();
      form.append("sport", sport);
      form.append("file", file);
      const { data } = await api.post("/import/excel/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
  });
}

export async function exportLineupsCsv(lineups: Lineup[]): Promise<Blob> {
  const { data } = await api.post("/export/csv/", { lineups }, { responseType: "blob" });
  return data;
}

export async function exportLineupsXlsx(lineups: Lineup[]): Promise<Blob> {
  const { data } = await api.post("/export/excel/", { lineups }, { responseType: "blob" });
  return data;
}

export async function fetchInjuryPdfUrl(): Promise<string> {
  return `${api.defaults.baseURL}/export/injury-pdf/`;
}
