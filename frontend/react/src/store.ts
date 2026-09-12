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
import { buildGolfSample, buildMmaSample, buildNbaSample, sampleHeadshotCache } from "@/optimizer/sample";
import { seedHeadshotCache, prefetchHeadshots } from "@/components/PlayerAvatar";
import type { Player as EnginePlayer } from "@/optimizer";

/** Engine-shape player → wire-shape player (snake_case) with photo kept. */
function toWire(p: EnginePlayer): Player {
  return {
    id: p.id,
    name: p.name,
    sport: p.sport,
    salary: p.salary,
    projection: p.projection,
    user_projection: p.userProjection ?? null,
    team: p.team,
    opponent: p.opponent,
    game_info: p.gameInfo,
    positions: p.positions,
    roster_positions: p.rosterPositions,
    correlation_group: p.correlationGroup,
    opponent_id: p.opponentId,
    bout: p.bout,
    projected_ownership: p.projectedOwnership,
    is_locked: p.isLocked,
    is_excluded: p.isExcluded,
    is_liked: p.isLiked,
    injury_status: p.injuryStatus ?? null,
    photo_url: p.photoUrl ?? null,
  };
}

interface AppState {
  // Working set
  players: Record<string /* sport */, Player[]>;
  setPlayers: (sport: string, players: Player[]) => void;
  updatePlayer: (sport: string, playerId: string, patch: Partial<Player>) => void;
  bulkResetPlayers: (sport: string) => void;
  loadSample: (sport: "nba" | "mma" | "golf") => void;
  /** Resolve ESPN headshots for the current roster in the background. */
  prefetchRosterPhotos: (sport: string) => void;

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
    (set, get) => ({
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
        seedHeadshotCache(sampleHeadshotCache());
        if (sport === "nba") {
          const roster = buildNbaSample().map(toWire);
          set((s) => ({ players: { ...s.players, nba: roster } }));
          void prefetchHeadshots(roster.map((p) => p.name));
        } else if (sport === "mma") {
          const roster = buildMmaSample().map(toWire);
          set((s) => ({ players: { ...s.players, mma: roster } }));
          void prefetchHeadshots(roster.map((p) => p.name));
        } else {
          const roster = buildGolfSample().map(toWire);
          set((s) => ({ players: { ...s.players, golf: roster } }));
          void prefetchHeadshots(roster.map((p) => p.name));
        }
      },

      /** Enrich any roster (e.g. imported CSV) with ESPN headshots. */
      prefetchRosterPhotos: (sport) => {
        const roster = get().players[sport] ?? [];
        void prefetchHeadshots(roster.map((p) => p.name));
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
      version: 2,
      partialize: (s) => ({
        players: s.players,
        nbaSettings: s.nbaSettings,
        activeSlateIdBySport: s.activeSlateIdBySport,
      }),
      // v1 → v2: player records now carry headshots; drop persisted v1
      // rosters so every visitor regenerates them from the new sample.
      migrate: (persisted: unknown, version: number) => {
        if (version < 2) {
          return {
            players: { nba: [], mma: [], golf: [] },
            nbaSettings: {
              ...DEFAULT_NBA_SETTINGS,
            },
            activeSlateIdBySport: {},
          } as never;
        }
        return persisted as never;
      },
    },
  ),
);
