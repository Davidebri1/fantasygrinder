/**
 * Sport optimizer screen — the one screen every sport uses.
 *
 * The rule for this screen is that it never asks for input. It pulls the
 * live slate when you arrive, builds the portfolio from it, and keeps
 * rebuilding it as the slate changes. Everything on the page is a readout
 * or a control you can reach without stopping what the app is doing.
 *
 * The layout follows how a DFS product is actually read: the board at the
 * top, the controls down the left, and the results on the right in tabs —
 * lineups, exposure, the player pool, and what to enter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, PlayCircle, RefreshCw, Trash2, Upload, X } from "lucide-react";

import { EspnSyncPanel } from "@/components/EspnSyncPanel";
import { EstimateNotice, SampleDataBanner } from "@/components/DataDisclosure";
import { ExposureReport, computeExposure } from "@/components/ExposureReport";
import { ImportDialog } from "@/components/ImportDialog";
import { LineupCountPicker } from "@/components/LineupCountPicker";
import { OptimizerCustomize } from "@/components/OptimizerCustomize";
import { OptimizerLoadingPanel } from "@/components/OptimizerLoadingPanel";
import { PlayerDrawer } from "@/components/PlayerDrawer";
import { PlayerPoolTable } from "@/components/PlayerPoolTable";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { RotoLineupCard, lineupRst, type RotoContext } from "@/components/RotoLineupCard";
import { SlateStrip } from "@/components/SlateStrip";
import { StacksPanel } from "@/components/StacksPanel";
import { usePlayerFilters } from "@/hooks/usePlayerFilters";
import {
  defaultUiSettings,
  type OptimizerUiSettings,
  type Sport,
} from "@/components/optimizer-settings";

import { useAppStore } from "@/store";
import { runOptimizerAsync } from "@/lib/run-optimizer";
import { exportLineupsCsv, exportLineupsXlsx } from "@/lib/export-client";
import { cn, fmtDecimal, fmtMoney } from "@/lib/utils";
import {
  NBA_CLASSIC_SLOTS,
  NBA_SHOWDOWN_SLOTS,
  NFL_CLASSIC_SLOTS,
  type RosterSlot,
} from "@/optimizer/sports";
import type { Lineup as EngineLineup, Player as EnginePlayer } from "@/optimizer";
import type { StackCandidate } from "@/optimizer/stacks";
import type { OptimizerSettings } from "@/optimizer/types";
import type { Lineup, Player } from "@/types";

const TITLE: Record<Sport, string> = {
  nba: "NBA Optimizer",
  nfl: "NFL Optimizer",
  mma: "MMA Optimizer",
  golf: "Golf Optimizer",
};

type Tab = "lineups" | "exposure" | "pool" | "enter" | "stacks";

const TABS: { key: Tab; label: string }[] = [
  { key: "lineups", label: "Lineups" },
  { key: "stacks", label: "Stacks" },
  { key: "exposure", label: "Exposure" },
  { key: "enter", label: "What to enter" },
  { key: "pool", label: "Player pool" },
];

function toEngine(p: Player): EnginePlayer {
  return {
    id: p.id,
    name: p.name,
    sport: p.sport,
    salary: p.salary,
    projection: p.projection,
    userProjection: p.user_projection ?? p.projection,
    team: p.team,
    opponent: p.opponent,
    gameInfo: p.game_info,
    positions: p.positions,
    rosterPositions: p.roster_positions,
    correlationGroup: p.correlation_group,
    opponentId: p.opponent_id,
    bout: p.bout,
    projectedOwnership: p.projected_ownership,
    isLocked: p.is_locked,
    isExcluded: p.is_excluded,
    isLiked: p.is_liked,
    injuryStatus: p.injury_status,
    photoUrl: p.photo_url,
  };
}

/** Engine-shape lineup (camelCase) -> wire-shape lineup (snake_case). */
function toWire(l: EngineLineup): Lineup {
  return {
    assignments: l.assignments.map((a) => ({
      slot: a.slot,
      score_multiplier: a.scoreMultiplier,
      player_id: a.playerId,
      player_name: a.playerName,
    })),
    strategy: l.strategy as Lineup["strategy"],
    solver_backend: l.solverBackend as Lineup["solver_backend"],
    rank: l.rank,
    total_salary: l.totalSalary,
    total_projection: l.totalProjection,
    total_ceiling: l.totalCeiling,
    teams: l.teams,
    games: l.games,
    unique_key: l.uniqueKey,
  };
}

/** The roster slots the exposure report is broken down by. */
function slotsFor(sport: Sport, contestType: "classic" | "showdown"): RosterSlot[] {
  if (sport === "nba") {
    return contestType === "showdown" ? NBA_SHOWDOWN_SLOTS : NBA_CLASSIC_SLOTS;
  }
  if (sport === "nfl") return NFL_CLASSIC_SLOTS;
  return [{ label: "FLEX", accepts: null }];
}

export function SportOptimizerScreen({ sport }: { sport: Sport }) {
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("lineups");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [settings, setSettings] = useState<OptimizerUiSettings>(() =>
    defaultUiSettings(sport),
  );
  /** The player whose detail sheet is open, if any. */
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  /** Lineups the user kept, so a rebuild does not lose them. */
  const [pinnedLineups, setPinnedLineups] = useState<Lineup[]>([]);

  const players = useAppStore((s) => s.players[sport]);
  const updatePlayer = useAppStore((s) => s.updatePlayer);
  const { filter, setFilter, clearFilter, filteredPlayers, filterChips } =
    usePlayerFilters(players);
  const loadLive = useAppStore((s) => s.loadLive);
  const liveStatus = useAppStore((s) => s.liveStatus[sport] ?? "idle");
  const liveGames = useAppStore((s) => s.liveGames[sport] ?? []);
  const liveWarnings = useAppStore((s) => s.liveWarnings[sport] ?? []);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt[sport] ?? null);
  const rosterSource = useAppStore((s) => s.rosterSource[sport] ?? "live");
  const lastResult = useAppStore((s) => s.lastResult);
  const setLastResult = useAppStore((s) => s.setLastResult);
  const clearLineups = useAppStore((s) => s.clearLineups);

  // Reset settings when the sport changes (shared component across routes).
  useEffect(() => {
    setSettings(defaultUiSettings(sport));
  }, [sport]);

  // Live slate: load on entry, then keep it current. No user input needed.
  //
  // An imported roster (a DraftKings CSV the customer uploaded) is never
  // touched by the background refresh — it would silently overwrite the
  // real salaries he imported with modelled ones. Only the Refresh button
  // replaces an imported pool, because that is an explicit act.
  useEffect(() => {
    let cancelled = false;
    void loadLive(sport);
    const timer = setInterval(() => {
      if (cancelled) return;
      if (useAppStore.getState().rosterSource[sport] === "imported") return;
      void loadLive(sport);
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sport, loadLive]);

  const patch = (p: Partial<OptimizerUiSettings>) =>
    setSettings((s) => ({ ...s, ...p }));

  /**
   * Build the portfolio. An override lets a single action — picking a
   * stack, say — rebuild immediately with one changed setting, without
   * pretending the whole form changed.
   */
  const run = useCallback(
    (override?: Partial<OptimizerUiSettings>) => {
      if (players.length === 0) return;
      const s = override ? { ...settings, ...override } : settings;
      setRunning(true);
      setRunError(null);
      void runOptimizerAsync(
        {
          sport,
          strategy: s.strategy,
          salaryCap: s.salary_cap,
          numLineups: s.num_lineups,
          maxExposure: s.max_exposure,
          minProjection: s.min_projection,
          simulationCount: s.simulation_count,
          uniqueLineups: s.unique_lineups,
          solver: s.solver,
          contestType: s.contest_type,
          teammateCorrelation: s.teammate_correlation,
          opponentCorrelation: s.opponent_correlation,
          cardCorrelation: s.card_correlation,
          allowOpponents: s.allow_opponents,
          enableBringBack: s.enable_bring_back,
          stackRules: s.stack_rules.map((r) => ({
            scope: r.scope,
            id: r.id,
            min: r.min,
            max: r.max,
          })),
          seed: 42,
        } satisfies OptimizerSettings,
        players.map(toEngine),
      )
      .then((result) => {
        setLastResult(result.lineups.map(toWire));
        setWarnings(result.warnings ?? []);
        setLastMs(result.elapsedMs);
      })
      .catch((err) => {
        setRunError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setRunning(false));
    },
    [players, sport, settings, setLastResult],
  );

  /**
   * Build automatically. The key is the sport plus the version of the
   * slate, so a fresh roster (or a fresh pull of the same roster) rebuilds
   * the portfolio exactly once, and changing a setting never triggers a
   * rebuild behind the user's back.
   */
  const builtKey = useRef<string | null>(null);
  useEffect(() => {
    if (players.length === 0) return;
    const key = `${sport}:${lastSyncedAt ?? "sample"}`;
    if (builtKey.current === key) return;
    builtKey.current = key;
    run();
  }, [players, lastSyncedAt, sport, run]);

  const lineups = useMemo(() => lastResult ?? [], [lastResult]);

  /** The built portfolio, plus any lineup the user chose to keep. */
  const displayedLineups = useMemo(() => {
    if (pinnedLineups.length === 0) return lineups;
    const built = new Set(lineups.map((l) => l.unique_key));
    const kept = pinnedLineups.filter((l) => !built.has(l.unique_key));
    return kept.length ? [...lineups, ...kept] : lineups;
  }, [lineups, pinnedLineups]);

  /** Which lineups the user has kept, so the card can show it. */
  const keptKeys = useMemo(
    () => new Set(pinnedLineups.map((l) => l.unique_key)),
    [pinnedLineups],
  );
  const byId = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  /**
   * Every player row in the app routes here, so the detail sheet is the one
   * place a player can be inspected or acted on.
   */
  const openPlayer = useCallback((playerId: string) => {
    setOpenPlayerId(playerId);
  }, []);

  /** Clicking a team narrows the pool to that team. */
  const filterByTeam = useCallback(
    (abbr: string) => {
      setFilter({ kind: "team", id: abbr, label: abbr });
      setTab("pool");
    },
    [setFilter],
  );

  /** Clicking a game narrows the pool to that game. */
  const filterByGame = useCallback(
    (gameKey: string) => {
      setFilter({ kind: "game", id: gameKey, label: gameKey });
      setTab("pool");
    },
    [setFilter],
  );

  /** Lock, like or exclude a player from the detail sheet. */
  const togglePlayerFlag = useCallback(
    (
      playerId: string,
      flag: "is_locked" | "is_liked" | "is_excluded",
    ) => {
      const p = byId.get(playerId);
      if (!p) return;
      updatePlayer(sport, playerId, { [flag]: !p[flag] } as Partial<Player>);
    },
    [byId, sport, updatePlayer],
  );

  /**
   * Using a stack writes the rule into the settings and rebuilds straight
   * away, so the effect of the stack is visible in the next lineup rather
   * than after another button press.
   */
  const useStack = useCallback(
    (candidate: StackCandidate | null) => {
      const next: OptimizerUiSettings["stack_rules"] = candidate
        ? [
            {
              // The rule carries its own scope and id, because on an MMA card
              // a fight pair is expressed against the card, not the bout.
              scope: candidate.rule.scope,
              id: candidate.rule.id,
              min: candidate.rule.min,
              max: candidate.rule.max,
              label: candidate.name,
            },
          ]
        : [];
      setSettings((s) => ({ ...s, stack_rules: next }));
      run({ stack_rules: next });
    },
    [run],
  );

  /** Copy a lineup as readable text, so it can be pasted somewhere. */
  const copyLineup = useCallback((lineup: Lineup) => {
    const text = lineup.assignments
      .map((a) => `${a.slot}: ${a.player_name}`)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }, []);

  /**
   * Keeping a lineup holds it. A rebuild replaces the portfolio, so a kept
   * lineup is put back afterwards — it is the user's pick, not the
   * optimizer's.
   */
  const toggleKeepLineup = useCallback((lineup: Lineup) => {
    setPinnedLineups((prev) =>
      prev.some((l) => l.unique_key === lineup.unique_key)
        ? prev.filter((l) => l.unique_key !== lineup.unique_key)
        : [...prev, lineup],
    );
  }, []);

  /**
   * Roto Score: a player's projected points against the best projected
   * points available at his position on this slate. 100 means he is the
   * best of his position.
   */
  const rotoContext = useMemo<RotoContext>(() => {
    const bestByPosition = new Map<string, number>();
    for (const p of players) {
      for (const pos of p.roster_positions ?? p.positions ?? []) {
        if (p.projection > (bestByPosition.get(pos) ?? 0)) {
          bestByPosition.set(pos, p.projection);
        }
      }
    }
    return { bestByPosition, byId, sport };
  }, [players, byId, sport]);

  const exposure = useMemo(
    () => computeExposure(lineups, byId),
    [lineups, byId],
  );

  const summary = useMemo(() => {
    if (lineups.length === 0) return null;
    const n = lineups.length;
    const avgProjection =
      lineups.reduce((s, l) => s + l.total_projection, 0) / n;
    const avgSalary = lineups.reduce((s, l) => s + l.total_salary, 0) / n;
    const avgRst =
      lineups.reduce((s, l) => s + lineupRst(l, rotoContext), 0) / n;
    return { avgProjection, avgSalary, avgRst };
  }, [lineups, rotoContext]);

  const statusLine =
    rosterSource === "imported"
      ? `Imported roster · ${players.length} players — your file's salaries are in use; background refresh paused`
      : liveStatus === "live"
      ? `Live from ESPN · ${players.length} players · ${liveGames.length} ${
          liveGames.length === 1 ? "game" : "games"
        }`
      : liveStatus === "loading"
        ? "Pulling the live slate"
        : liveStatus === "offline"
          ? rosterSource === "sample"
            ? "Live feed unreachable — showing the bundled sample roster"
            : "Live feed unreachable — using the roster already loaded"
          : liveStatus === "empty"
            ? "No live slate on the board right now"
            : "Waiting for the slate";

  const syncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const allWarnings = [...liveWarnings, ...warnings];

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-4 grain -mx-6 px-6 py-7 border-b border-line">
        {/* The turf, far down and dimmed. It gives the working screen the
            same sense of place as the landing page without adding noise. */}
        <div aria-hidden className="absolute inset-0">
          <img
            src="./hero/field-lines-night.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(100deg, rgba(4,7,13,0.94) 0%, rgba(4,7,13,0.86) 55%, rgba(4,7,13,0.66) 100%)",
            }}
          />
          {/* The sport's colour, low and to the left — the same light that
              fills the room, caught here behind the title. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(70% 130% at 8% 110%, color-mix(in srgb, var(--sport) 26%, transparent) 0%, transparent 62%)",
            }}
          />
        </div>

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-condensed text-4xl font-semibold tracking-tight text-ink-on-dark">
              {TITLE[sport]}
            </h1>
            <p className="label mt-1.5 flex items-center gap-2 text-ink-on-dark-muted">
              {liveStatus === "live" && (
                <span className="w-1.5 h-1.5 rounded-full bg-good live-dot" />
              )}
              {statusLine}
              {syncedLabel && (
                <span className="text-ink-on-dark-muted/70">updated {syncedLabel}</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadLive(sport)}
              disabled={liveStatus === "loading"}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-2 text-ink-on-dark border border-white/25 bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/18 hover:border-white/40 disabled:opacity-50"
            >
              <RefreshCw
                className={cn("w-4 h-4", liveStatus === "loading" && "animate-spin")}
              />
              Refresh
            </button>
            {displayedLineups.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => exportLineupsCsv(displayedLineups)}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-2 text-ink-on-dark border border-white/25 bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/18 hover:border-white/40"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportLineupsXlsx(displayedLineups)}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-2 text-ink-on-dark border border-white/25 bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/18 hover:border-white/40"
                >
                  <Download className="w-4 h-4" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={clearLineups}
                  className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-2 text-ink-on-dark border border-white/25 bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/18 hover:border-white/40"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── The board ──────────────────────────────────────────────── */}
      <section>
        <h2 className="label font-medium text-ink mb-2">The board</h2>
        <SlateStrip
          games={liveGames}
          sport={sport}
          onGameClick={(g) => filterByGame(g.label)}
        />
      </section>

      {/* A rule that separates the board from the work area. It gives the
          page a horizon instead of one long undifferentiated column. */}
      <div className="h-px bg-line" />

      {rosterSource === "sample" && <SampleDataBanner />}

      {allWarnings.length > 0 && (
        <ul className="well p-3 space-y-1">
          {allWarnings.map((w) => (
            <li key={w} className="label text-warn">
              {w}
            </li>
          ))}
        </ul>
      )}

      <EstimateNotice />

      {runError && (
        <p className="well p-3 label text-danger">The build failed: {runError}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr] items-start">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="panel p-4">
            <h2 className="label font-medium text-ink">Lineups</h2>
            <div className="mt-3">
              <LineupCountPicker
                value={settings.num_lineups}
                onChange={(n) => patch({ num_lineups: n })}
                disabled={running}
              />
            </div>
            <button
              type="button"
              onClick={() => run()}
              disabled={running || players.length === 0}
              className="action w-full mt-4 flex items-center justify-center gap-2 h-10 text-sm"
            >
              <PlayCircle className="w-4 h-4" />
              {running ? "Building…" : "Build portfolio"}
            </button>
            <p className="label-quiet mt-2.5">
              The portfolio rebuilds itself whenever the slate changes.
            </p>
            {settings.stack_rules.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="chip chip-good">
                  {settings.stack_rules[0].label}
                </span>
                <button
                  type="button"
                  onClick={() => useStack(null)}
                  className="label-quiet hover:text-ink transition-colors"
                >
                  Remove stack
                </button>
              </div>
            )}
          </section>

          <details className="panel p-4" open>
            <summary className="label font-medium text-ink cursor-pointer select-none">
              Customize
            </summary>
            <div className="mt-4 pt-4 border-t border-line">
              <OptimizerCustomize
                sport={sport}
                settings={settings}
                onChange={patch}
              />
            </div>
          </details>
        </aside>

        {/* ── Results ─────────────────────────────────────────────── */}
        <div>
          {summary && (
            <div className="panel-lift p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
              <Stat
                label="Lineups built"
                value={`${displayedLineups.length}`}
                note={`of ${settings.num_lineups} requested`}
              />
              <Stat
                label="Average projection"
                value={fmtDecimal(summary.avgProjection)}
                note="points per lineup"
              />
              <Stat
                label="Average salary"
                value={fmtMoney(summary.avgSalary)}
                note={`cap ${fmtMoney(settings.salary_cap)}`}
              />
              <Stat
                label="Average Roto Score"
                value={`${fmtDecimal(summary.avgRst)}%`}
                note="best of position is 100%"
              />
            </div>
          )}

          <div
            className="flex gap-1 mb-4 p-1 rounded-2 bg-inset border border-line w-fit"
            role="tablist"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3 h-8 text-sm rounded-1 transition-colors",
                  tab === t.key
                    ? "bg-surface-1 text-ink font-medium shadow-1"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {running ? (
            <OptimizerLoadingPanel />
          ) : tab === "lineups" ? (
            <LineupsTab
              lineups={displayedLineups}
              ctx={rotoContext}
              exposure={exposure.byPlayer}
              elapsedMs={lastMs}
              onPlayerClick={openPlayer}
              onTeamClick={filterByTeam}
              onCopyLineup={copyLineup}
              keptKeys={keptKeys}
              onToggleKeep={toggleKeepLineup}
            />
          ) : tab === "stacks" ? (
            <StacksPanel
              sport={sport}
              players={players}
              activeRule={settings.stack_rules[0] ?? null}
              onUseStack={useStack}
              allowOpponents={settings.allow_opponents}
            />
          ) : tab === "exposure" ? (
            <ExposureReport
              lineups={displayedLineups}
              players={players}
              slots={slotsFor(sport, settings.contest_type)}
              onPlayerClick={openPlayer}
              onTeamClick={filterByTeam}
            />
          ) : tab === "enter" ? (
            <RecommendationsPanel sport={sport} lineups={displayedLineups} />
          ) : (
            <div className="space-y-4">
              <EspnSyncPanel sport={sport} />
              {filterChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label">Filtered to</span>
                  {filterChips.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={c.onRemove}
                      className="chip hover:bg-brand/25 transition-colors"
                    >
                      {c.label}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="label-quiet hover:text-ink transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
              <PlayerPoolTable
                sport={sport}
                players={filteredPlayers}
                onRowClick={(p) => openPlayer(p.id)}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="control flex items-center gap-1.5 px-3 h-9 text-sm"
                >
                  <Upload className="w-4 h-4" />
                  Import a player pool
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <PlayerDrawer
        player={openPlayerId ? (byId.get(openPlayerId) ?? null) : null}
        onClose={() => setOpenPlayerId(null)}
        sport={sport}
        exposure={
          openPlayerId ? exposure.byPlayer.get(openPlayerId) : undefined
        }
        bestByPosition={rotoContext.bestByPosition}
        onToggleLock={(id) => togglePlayerFlag(id, "is_locked")}
        onToggleLike={(id) => togglePlayerFlag(id, "is_liked")}
        onToggleExclude={(id) => togglePlayerFlag(id, "is_excluded")}
      />

      <ImportDialog sport={sport} open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function LineupsTab({
  lineups,
  ctx,
  exposure,
  elapsedMs,
  onPlayerClick,
  onTeamClick,
  onCopyLineup,
  keptKeys,
  onToggleKeep,
}: {
  lineups: Lineup[];
  ctx: RotoContext;
  exposure: Map<string, number>;
  elapsedMs: number | null;
  onPlayerClick?: (playerId: string) => void;
  onTeamClick?: (abbr: string) => void;
  onCopyLineup?: (lineup: Lineup) => void;
  keptKeys?: Set<string>;
  onToggleKeep?: (lineup: Lineup) => void;
}) {
  if (lineups.length === 0) {
    return (
      <div className="well p-10 text-center">
        <p className="text-ink-muted">
          No lineups yet. The portfolio builds as soon as the slate is loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label">
          Roto Score is a player&apos;s projected points against the best
          projected points available at his position on this slate. 100 means
          he is the best of his position.
        </p>
        {elapsedMs !== null && <span className="label-quiet num">{elapsedMs}ms</span>}
      </div>
      {lineups.map((lineup, i) => (
        <RotoLineupCard
          key={lineup.unique_key}
          lineup={lineup}
          ctx={ctx}
          index={i}
          exposure={exposure}
          onPlayerClick={onPlayerClick}
          onTeamClick={onTeamClick}
          onCopyLineup={onCopyLineup}
          locked={keptKeys?.has(lineup.unique_key) ?? false}
          onLockLineup={onToggleKeep}
        />
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num text-lg font-semibold text-ink mt-0.5">{value}</div>
      {note && <div className="label-quiet mt-0.5">{note}</div>}
    </div>
  );
}
