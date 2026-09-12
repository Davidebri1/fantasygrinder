import { useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";

import { Card } from "@/components/Card";
import { ImportDialog } from "@/components/ImportDialog";
import { LineupResultsPanel } from "@/components/LineupResultsPanel";
import { OptimizerLoadingPanel } from "@/components/OptimizerLoadingPanel";
import { PlayerPoolTable } from "@/components/PlayerPoolTable";

import { useAppStore } from "@/store";
import { runOptimize as runOptimizer } from "@/optimizer";
import { DEFAULT_MMA_SETTINGS, MmaSettings } from "@/types";

export function MmaHomeScreen() {
  const [importOpen, setImportOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const players = useAppStore((s) => s.players["mma"]);
  const loadSample = useAppStore((s) => s.loadSample);
  const lastResult = useAppStore((s) => s.lastResult);
  const setLastResult = useAppStore((s) => s.setLastResult);

  const [settings, setSettings] = useState<MmaSettings>(DEFAULT_MMA_SETTINGS);

  useEffect(() => {
    if (players.length === 0) loadSample("mma");
  }, [players.length, loadSample]);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const result = runOptimizer(
        {
          sport: "mma",
          strategy: settings.strategy,
          salaryCap: settings.salary_cap,
          numLineups: settings.num_lineups,
          minProjection: settings.min_projection,
          simulationCount: settings.simulation_count,
          allowOpponents: settings.allow_opponents,
          opponentCorrelation: settings.opponent_correlation,
          cardCorrelation: settings.card_correlation,
          seed: 42,
        },
        players.map((p) => ({
          id: p.id,
          name: p.name,
          sport: p.sport,
          salary: p.salary,
          projection: p.projection,
          opponentId: p.opponent_id,
          bout: p.bout,
          projectedOwnership: p.projected_ownership,
          isLocked: p.is_locked,
          isExcluded: p.is_excluded,
          isLiked: p.is_liked,
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
      setRunning(false);
    }, 30);
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">MMA Optimizer</h1>
          <p className="text-sm text-ink-muted mt-1">{players.length} fighters loaded</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadSample("mma")}
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div>
          <Card className="p-4">
            <h3 className="font-medium mb-2 text-base">Optimizer Settings</h3>
            <label className="block text-xs font-medium text-ink-muted mb-1">Strategy</label>
            <select
              className="border border-slate-300 rounded-md w-full px-2 py-1.5 text-sm bg-white mb-3"
              value={settings.strategy}
              onChange={(e) =>
                setSettings({ ...settings, strategy: e.target.value as MmaSettings["strategy"] })
              }
            >
              <option value="monteCarlo">Monte Carlo</option>
              <option value="maxProjection">Max Projection</option>
              <option value="contrarian">Contrarian</option>
              <option value="balanced">Balanced</option>
              <option value="salaryCap">Salary Cap</option>
            </select>
            <label className="block text-xs font-medium text-ink-muted mb-1 mt-2">Lineups</label>
            <input
              type="number"
              value={settings.num_lineups}
              onChange={(e) =>
                setSettings({ ...settings, num_lineups: parseInt(e.target.value, 10) || 1 })
              }
              className="border border-slate-300 rounded-md w-full px-2 py-1.5 text-sm bg-white mb-3"
            />
            <label className="flex items-center gap-2 text-sm mt-3">
              <input
                type="checkbox"
                checked={settings.allow_opponents}
                onChange={(e) => setSettings({ ...settings, allow_opponents: e.target.checked })}
                className="rounded border-slate-300 text-brand focus:ring-brand"
              />
              Allow both fighters from same bout
            </label>
            <button
              onClick={run}
              disabled={running || players.length === 0}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-brand hover:bg-brand-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md"
            >
              Generate Lineups
            </button>
          </Card>
        </div>
        <div>
          {running ? (
            <OptimizerLoadingPanel />
          ) : lastResult && lastResult.length > 0 ? (
            <LineupResultsPanel lineups={lastResult} sport="mma" />
          ) : (
            <PlayerPoolTable sport="mma" players={players} />
          )}
        </div>
      </div>

      <ImportDialog sport="mma" open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
