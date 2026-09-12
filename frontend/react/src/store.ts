/**
 * Centralized Zustand store for UI state shared across pages.
 *
 * Holds the player's working slate (the list of players currently
 * displayed), the optimizer settings, and the most recent optimize
 * result. Persisted to localStorage so the customer doesn't lose
 * work on a tab refresh.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  type Lineup,
  type NbaSettings,
  DEFAULT_NBA_SETTINGS,
  type Player,
} from "@/types";
import { buildGolfSample, buildMmaSample, buildNbaSample } from "@/optimizer/sample";

interface AppState {
  // Working set
  players: Record<string /* sport */, Player[]>;
  setPlayers: (sport: string, players: Player[]) => void;
  updatePlayer: (sport: string, playerId: string, patch: Partial<Player>) => void;
  bulkResetPlayers: (sport: string) => void;
  loadSample: (sport: "nba" | "mma" | "golf") => void;

  // Settings per sport
  nbaSettings: NbaSettings;
  updateNbaSettings: (patch: Partial<NbaSettings>) => void;

  // Last optimization result
  lastResult: Lineup[] | null;
  setLastResult: (lineups: Lineup[] | null) => void;

  // Slate ID per sport — what the customer is currently looking at
  activeSlateIdBySport: Record<string, string | undefined>;
  setActiveSlateId: (sport: string, slateId: string | undefined) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      players: { nba: [], mma: [], golf: [] },
      setPlayers: (sport, players) =>
        set((s) => ({ players: { ...s.players, [sport]: players } })),
      updatePlayer: (sport, playerId, patch) =>
        set((s) => ({
          players: {
            ...s.players,
            [sport]: (s.players[sport] ?? []).map((p) =>
              p.id === playerId ? { ...p, ...patch } : p,
            ),
          },
        })),
      bulkResetPlayers: (sport) =>
        set((s) => ({ players: { ...s.players, [sport]: [] } })),

      loadSample: (sport) => {
        if (sport === "nba") set((s) => ({ players: { ...s.players, nba: buildNbaSample() } }));
        else if (sport === "mma")
          set((s) => ({ players: { ...s.players, mma: buildMmaSample() } }));
        else set((s) => ({ players: { ...s.players, golf: buildGolfSample() } }));
      },

      nbaSettings: DEFAULT_NBA_SETTINGS,
      updateNbaSettings: (patch) =>
        set((s) => ({ nbaSettings: { ...s.nbaSettings, ...patch } })),

      lastResult: null,
      setLastResult: (lineups) => set({ lastResult: lineups }),

      activeSlateIdBySport: {},
      setActiveSlateId: (sport, slateId) =>
        set((s) => ({
          activeSlateIdBySport: { ...s.activeSlateIdBySport, [sport]: slateId },
        })),
    }),
    {
      name: "fantasy-grinder-app",
      version: 1,
      partialize: (s) => ({
        players: s.players,
        nbaSettings: s.nbaSettings,
        activeSlateIdBySport: s.activeSlateIdBySport,
      }),
    },
  ),
);
