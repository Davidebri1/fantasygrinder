/**
 * SportOptimizerScreen — the full optimizer experience for any sport.
 *
 * NBA, MMA, and Golf all render this same screen: settings (objective /
 * simulation / unique lineups / solver / cap), player pool, generated
 * lineups, recommendations, export, clear, and import. Nothing is
 * NBA-only.
 */
import { useEffect, useState } from "react";
import { Activity, Download, Trash2, Upload } from "lucide-react";

import { Card } from "@/components/Card";
import { EspnSyncPanel } from "@/components/EspnSyncPanel";
import { ImportDialog } from "@/components/ImportDialog";
import { LineupResultsPanel } from "@/components/LineupResultsPanel";
import { OptimizerLoadingPanel } from "@/components/OptimizerLoadingPanel";
import {
  OptimizerSettingsCard,
  defaultUiSettings,
  type OptimizerUiSettings,
} from "@/components/OptimizerSettingsCard";
import { PlayerPoolTable } from "@/components/PlayerPoolTable";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";

import { useAppStore } from "@/store";
import { runOptimize as runOptimizer } from "@/optimizer";
import type { Player as EnginePlayer } from "@/optimizer";
import { exportLineupsCsv, exportLineupsXlsx } from "@/lib/export-client";
import type { Lineup, Player } from "@/types";

type Sport = "nba" | "mma" | "golf";

const TITLE: Record<Sport, string> = {
  nba: "NBA Optimizer",
  mma: "MMA Optimizer",
  golf: "Golf Optimizer",
};

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

function toWire(l: ReturnType<typeof runOptimizer>["lineups"][number]): Lineup {
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

export function SportOptimizerScreen({ sport }: { sport: Sport }) {
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<"pool" | "results">("pool");
  const [running, setRunning] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [settings, setSettings] = useState<OptimizerUiSettings>(() => defaultUiSettings(sport));

  const players = useAppStore((s) => s.players[sport]);
  const loadSample = useAppStore((s) => s.loadSample);
  const lastResult = useAppStore((s) => s.lastResult);
  const setLastResult = useAppStore((s) => s.setLastResult);
  const clearLineups = useAppStore((s) => s.clearLineups);

  // Reset settings when the sport changes (shared component across routes).
  useEffect(() => {
    setSettings(defaultUiSettings(sport));
  }, [sport]);

  useEffect(() => {
    if (players.length === 0) loadSample(sport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const patch = (p: Partial<OptimizerUiSettings>) => setSettings((s) => ({ ...s, ...p }));

  const run = () => {
    if (players.length === 0) return;
    setRunning(true);
    setTimeout(() => {
      const result = runOptimizer(
        {
          sport,
          strategy: settings.strategy,
          salaryCap: settings.salary_cap,
          numLineups: settings.num_lineups,
          minProjection: settings.min_projection,
          simulationCount: settings.simulation_count,
          uniqueLineups: settings.unique_lineups,
          solver: settings.solver,
          contestType: settings.contest_type,
          teammateCorrelation: settings.teammate_correlation,
          opponentCorrelation: settings.opponent_correlation,
          cardCorrelation: settings.card_correlation,
          allowOpponents: settings.allow_opponents,
          seed: 42,
        },
        players.map(toEngine),
      );
      setLastResult(result.lineups.map(toWire));
      setLastMs(result.elapsedMs);
      setRunning(false);
      setTab("results");
    }, 30);
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{TITLE[sport]}</h1>
          <p className="text-sm text-ink-muted mt-1">{lastResult?.length ?? 0} lineups generated</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadSample(sport)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
          >
            <Upload className="w-4 h-4" />
            Load Sample
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          {lastResult && lastResult.length > 0 && (
            <>
              <button
                onClick={() => exportLineupsCsv(lastResult)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={() => exportLineupsXlsx(lastResult)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
              >
                <Download className="w-4 h-4" />
                Excel
              </button>
              <button
                onClick={clearLineups}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-accent-danger hover:text-accent-danger bg-white text-ink rounded-md text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div>
          <OptimizerSettingsCard
            sport={sport}
            settings={settings}
            onChange={patch}
            onRun={run}
            running={running}
          />
          {lastMs !== null && (
            <Card className="mt-4 p-4">
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <Activity className="w-4 h-4 text-accent" />
                Last run · {lastMs}ms
              </div>
            </Card>
          )}
        </div>

        <div>
          <div className="flex gap-1 mb-3 border-b border-slate-200">
            <TabBtn active={tab === "pool"} onClick={() => setTab("pool")}>
              Player Pool
            </TabBtn>
            <TabBtn active={tab === "results"} onClick={() => setTab("results")}>
              Generated Lineups
            </TabBtn>
          </div>

          {running ? (
            <OptimizerLoadingPanel />
          ) : tab === "pool" ? (
            <div className="space-y-4">
              <EspnSyncPanel sport={sport} playerNames={players.map((p) => p.name)} />
              <PlayerPoolTable sport={sport} players={players} />
            </div>
          ) : (
            <div className="space-y-4">
              <LineupResultsPanel lineups={lastResult ?? []} sport={sport} />
              <RecommendationsPanel sport={sport} lineups={lastResult ?? []} />
            </div>
          )}
        </div>
      </div>

      <ImportDialog sport={sport} open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
        (active ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}
