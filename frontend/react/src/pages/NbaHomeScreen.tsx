/**
 * NBA Optimizer page — orchestrates:
 *  1. Settings form (left col)
 *  2. Player pool + tabs (center col)
 *  3. Optimize + results (right col)
 *
 * The optimizer runs **in the browser** via the TS port under
 * `@/optimizer`. No server, no Python, no install.
 */
import { useEffect, useMemo, useState } from "react";
import { Activity, Download, Upload } from "lucide-react";

import { Card } from "@/components/Card";
import { EspnSyncPanel } from "@/components/EspnSyncPanel";
import { ImportDialog } from "@/components/ImportDialog";
import { LineupResultsPanel } from "@/components/LineupResultsPanel";
import { OptimizerLoadingPanel } from "@/components/OptimizerLoadingPanel";
import { OptimizerSettingsCard } from "@/components/OptimizerSettingsCard";
import { PlayerPoolTable } from "@/components/PlayerPoolTable";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";

import { useAppStore } from "@/store";
import { runOptimize as runOptimizer } from "@/optimizer";
import { exportLineupsCsv, exportLineupsXlsx } from "@/lib/export-client";

type Tab = "pool" | "results";

export function NbaHomeScreen() {
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("pool");
  const [running, setRunning] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const players = useAppStore((s) => s.players["nba"]);
  const loadSample = useAppStore((s) => s.loadSample);
  const settings = useAppStore((s) => s.nbaSettings);
  const updateSettings = useAppStore((s) => s.updateNbaSettings);
  const lastResult = useAppStore((s) => s.lastResult);
  const setLastResult = useAppStore((s) => s.setLastResult);

  // Auto-load sample data on first mount if the store is empty.
  useEffect(() => {
    if (players.length === 0) loadSample("nba");
  }, [players.length, loadSample]);

  const eligibleCount = useMemo(
    () =>
      players.filter(
        (p) =>
          !p.is_excluded &&
          p.salary > 0 &&
          (p.user_projection ?? p.projection) >= (settings.min_projection ?? 0),
      ).length,
    [players, settings.min_projection],
  );

  const runOptimize = () => {
    if (players.length === 0) return;
    setRunning(true);
    // Defer one tick so the loading panel can render.
    setTimeout(() => {
      const result = runOptimizer(
        {
          sport: "nba",
          strategy: settings.strategy,
          salaryCap: settings.salary_cap,
          numLineups: settings.num_lineups,
          minProjection: settings.min_projection,
          simulationCount: settings.simulation_count,
          contestType: settings.contest_type,
          uniqueLineups: settings.unique_lineups,
          teammateCorrelation: settings.teammate_correlation,
          opponentCorrelation: settings.opponent_correlation,
          seed: 42,
        },
        players.map((p) => ({
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
          projectedOwnership: p.projected_ownership,
          isLocked: p.is_locked,
          isExcluded: p.is_excluded,
          isLiked: p.is_liked,
          injuryStatus: p.injury_status,
          photoUrl: p.photo_url,
        })),
      );
      setLastResult(
        result.lineups.map((l) => ({
          assignments: l.assignments.map((a) => ({
            slot: a.slot,
            score_multiplier: a.scoreMultiplier,
            player_id: a.playerId,
            player_name: a.playerName,
          })),
          strategy: l.strategy as any,
          solver_backend: l.solverBackend as any,
          rank: l.rank,
          total_salary: l.totalSalary,
          total_projection: l.totalProjection,
          total_ceiling: l.totalCeiling,
          teams: l.teams,
          games: l.games,
          unique_key: l.uniqueKey,
        })),
      );
      setLastMs(result.elapsedMs);
      setRunning(false);
      setTab("results");
    }, 30);
  };

  const onExportCsv = () => {
    if (!lastResult) return;
    exportLineupsCsv(lastResult);
  };
  const onExportXlsx = () => {
    if (!lastResult) return;
    exportLineupsXlsx(lastResult);
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NBA Optimizer</h1>
          <p className="text-sm text-ink-muted mt-1">
            {players.length} players loaded · {eligibleCount} eligible · {lastResult?.length ?? 0} lineups generated
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadSample("nba")}
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
                onClick={onExportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={onExportXlsx}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 hover:border-brand bg-white text-ink rounded-md text-sm"
              >
                <Download className="w-4 h-4" />
                Excel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ─── Settings ────────────────────────────────────── */}
        <div>
          <OptimizerSettingsCard
            settings={settings}
            onChange={updateSettings}
            onRun={runOptimize}
            running={running}
          />
          {lastMs !== null && (
            <Card className="mt-4 p-4">
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <Activity className="w-4 h-4 text-accent" />
                Last run · {lastMs}ms · browser solver
              </div>
            </Card>
          )}
        </div>

        {/* ─── Pool / Results tabs ─────────────────────────── */}
        <div>
          <div className="flex gap-1 mb-3 border-b border-slate-200">
            <TabBtn active={tab === "pool"} onClick={() => setTab("pool")}>
              Player Pool
            </TabBtn>
            <TabBtn active={tab === "results"} onClick={() => setTab("results")}>
              Generated Lineups
              {lastResult && lastResult.length > 0 && (
                <span className="ml-2 text-xs text-ink-subtle tabular-nums">
                  ({lastResult.length})
                </span>
              )}
            </TabBtn>
          </div>
          {running ? (
            <OptimizerLoadingPanel />
          ) : tab === "pool" ? (
            <div className="space-y-4">
              <EspnSyncPanel sport="nba" playerNames={players.map((p) => p.name)} />
              <PlayerPoolTable sport="nba" players={players} />
            </div>
          ) : (
            <div className="space-y-4">
              <LineupResultsPanel lineups={lastResult ?? []} />
              <RecommendationsPanel sport="nba" lineups={lastResult ?? []} />
            </div>
          )}
        </div>
      </div>

      <ImportDialog sport="nba" open={importOpen} onClose={() => setImportOpen(false)} />
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
