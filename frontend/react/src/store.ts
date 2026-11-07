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
  type Sport,
} from "@/types";
import { fetchLivePool, type LiveGame } from "@/lib/espn-live";
import { parseDraftables } from "@/lib/dk-draftables";
import dkShowdownJaxBal from "@/assets/dk-showdown-jax-bal.json";
import {
  buildGolfSample,
  buildMmaSample,
  buildNbaSample,
  buildNflSample,
  sampleHeadshotCache,
} from "@/optimizer/sample";
import { seedHeadshotCache, prefetchHeadshots } from "@/components/PlayerAvatar";
import type { Player as EnginePlayer } from "@/optimizer";

/**
 * The bundled DraftKings slate — real published prices and DK's own
 * projections. It seeds the NFL pool so the app is usable the moment it
 * opens, before any import. A live ESPN pull or a customer import replaces
 * it; auto-refresh leaves it alone (it would overwrite real prices with
 * estimates).
 */
const DK_SEED_NFL: Player[] = parseDraftables(
  JSON.stringify(dkShowdownJaxBal),
  "nfl",
).map((p) => ({ ...p, salary_source: "dk" as const }));

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
    is_locked: p.isLocked,
    is_excluded: p.isExcluded,
    is_liked: p.isLiked,
    injury_status: p.injuryStatus ?? null,
    photo_url: p.photoUrl ?? null,
    jersey: p.jersey ?? null,
  };
}

export type LiveStatus = "idle" | "loading" | "live" | "empty" | "offline";

/**
 * Where the roster currently on screen came from.
 *
 * "sample" means the live feed failed and we fell back to the bundled sample
 * slate. The UI must say so loudly — a customer who enters a lineup built from
 * sample data has been told a lie by the product.
 */
export type RosterSource = "live" | "sample" | "imported" | "dk";

interface AppState {
  // Working set
  players: Record<string /* sport */, Player[]>;
  setPlayers: (sport: string, players: Player[]) => void;
  updatePlayer: (sport: string, playerId: string, patch: Partial<Player>) => void;
  bulkResetPlayers: (sport: string) => void;
  loadSample: (sport: "nba" | "nfl" | "mma" | "golf") => void;
  /** Resolve ESPN headshots for the current roster in the background. */
  prefetchRosterPhotos: (sport: string) => void;

  // Live feed state
  /** "idle" | "loading" | "live" | "empty" | "offline" per sport. */
  liveStatus: Record<string, LiveStatus>;
  /** Where the roster on screen came from — drives the sample-data banner. */
  rosterSource: Record<string, RosterSource>;
  liveGames: Record<string, LiveGame[]>;
  liveWarnings: Record<string, string[]>;
  lastSyncedAt: Record<string, string | null>;
  /** Pull the live slate from ESPN and swap it into the pool. */
  loadLive: (sport: Sport) => Promise<void>;

  // Settings per sport
  nbaSettings: NbaSettings;
  updateNbaSettings: (patch: Partial<NbaSettings>) => void;

  // Last optimization result
  lastResult: Lineup[] | null;
  setLastResult: (lineups: Lineup[] | null) => void;
  clearLineups: () => void;

  // Slate ID per sport — what the customer is currently looking at
  activeSlateIdBySport: Record<string, string | undefined>;
  setActiveSlateId: (sport: string, slateId: string | undefined) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      players: { nba: [], nfl: DK_SEED_NFL, mma: [], golf: [] },
      setPlayers: (sport, players) =>
        set((s) => ({
          players: { ...s.players, [sport]: players },
          rosterSource: { ...s.rosterSource, [sport]: "imported" },
        })),
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
        const setRoster = (roster: Player[]) => {
          set((s) => ({
            players: { ...s.players, [sport]: roster },
            rosterSource: { ...s.rosterSource, [sport]: "sample" as RosterSource },
          }));
        };
        if (sport === "nba") {
          const roster = buildNbaSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        } else if (sport === "nfl") {
          setRoster(buildNflSample().map(toWire));
        } else if (sport === "mma") {
          const roster = buildMmaSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        } else {
          const roster = buildGolfSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        }
      },

      /** Enrich any roster (e.g. imported CSV) with ESPN headshots. */
      prefetchRosterPhotos: (sport) => {
        const roster = get().players[sport] ?? [];
        void prefetchHeadshots(roster.map((p) => p.name));
      },

      liveStatus: {},
      rosterSource: { nfl: "dk" },
      liveGames: {},
      liveWarnings: {},
      lastSyncedAt: {},

      /**
       * Pull the live slate from ESPN and swap it into the pool.
       *
       * The pool is replaced wholesale so projections and salaries always
       * match the live feed, but the user's own decisions (locks, excludes,
       * likes, hand-edited projections) are carried across.
       */
      loadLive: async (sport) => {
        set((s) => ({ liveStatus: { ...s.liveStatus, [sport]: "loading" } }));
        try {
          const pool = await fetchLivePool(sport);
          const previous = get().players[sport] ?? [];
          const priorById = new Map(previous.map((p) => [p.id, p]));
          const merged = pool.players.map((p) => {
            const prior = priorById.get(p.id);
            if (!prior) return p;
            return {
              ...p,
              is_locked: prior.is_locked,
              is_excluded: prior.is_excluded,
              is_liked: prior.is_liked,
              user_projection: prior.user_projection ?? p.user_projection ?? null,
            };
          });
          set((s) => ({
            players: { ...s.players, [sport]: merged },
            rosterSource: { ...s.rosterSource, [sport]: "live" as RosterSource },
            liveStatus: {
              ...s.liveStatus,
              [sport]: merged.length > 0 ? "live" : "empty",
            },
            liveGames: { ...s.liveGames, [sport]: pool.games },
            liveWarnings: { ...s.liveWarnings, [sport]: pool.warnings },
            lastSyncedAt: { ...s.lastSyncedAt, [sport]: pool.fetchedAt },
          }));
        } catch (err) {
          // Live feed unreachable — keep whatever the user has and say so.
          const message =
            err instanceof Error ? err.message : "The live feed could not be reached.";
          set((s) => ({
            liveStatus: { ...s.liveStatus, [sport]: "offline" },
            liveWarnings: { ...s.liveWarnings, [sport]: [message] },
          }));
          if ((get().players[sport] ?? []).length === 0) {
            get().loadSample(sport);
          }
        }
      },

      nbaSettings: DEFAULT_NBA_SETTINGS,
      updateNbaSettings: (patch) =>
        set((s) => ({ nbaSettings: { ...s.nbaSettings, ...patch } })),

      lastResult: null,
      setLastResult: (lineups) => set({ lastResult: lineups }),
      clearLineups: () => set({ lastResult: null }),

      activeSlateIdBySport: {},
      setActiveSlateId: (sport, slateId) =>
        set((s) => ({
          activeSlateIdBySport: { ...s.activeSlateIdBySport, [sport]: slateId },
        })),
    }),
    {
      name: "fantasy-grinder-app",
      version: 6,
      partialize: (s) => ({
        players: s.players,
        nbaSettings: s.nbaSettings,
        activeSlateIdBySport: s.activeSlateIdBySport,
      }),
      // v2 → v3: MCC/Golf fields expanded (32 fighters, 32 golfers); drop
      // persisted rosters so every visitor regenerates the new pools.
      // v3 → v4: NFL added; drop persisted rosters again so the live slate
      // is always the source of truth.
      // v4 → v5: the NFL pool starts from the bundled DraftKings slate.
      // v5 → v6: the salary field now holds only published DraftKings
      // prices. A roster persisted under v5 may still carry a modelled
      // price in that field, so persisted rosters are dropped and
      // regenerated rather than silently reinterpreted.
      migrate: (persisted: unknown, version: number) => {
        if (version < 6) {
          return {
            players: { nba: [], nfl: [], mma: [], golf: [] },
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
