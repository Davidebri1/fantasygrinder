/**
 * Optimizer settings card — shared by every sport.
 *
 * Renders the common controls (objective, simulation, unique lineups,
 * solver, lineups, cap, min projection) plus the sport-specific ones
 * (NBA: contest type / bring-back / correlations; MMA: allow opponents /
 * card correlation).
 */
import { PlayCircle } from "lucide-react";

import {
  OBJECTIVES,
  ObjectiveFunction,
  SIMULATION_MODES,
  SimulationMode,
  type Strategy,
  strategyFromParts,
} from "@/types";
import { cn } from "@/lib/utils";

export interface OptimizerUiSettings {
  strategy: Strategy;
  salary_cap: number;
  num_lineups: number;
  min_projection: number;
  simulation_count: number;
  unique_lineups: boolean;
  solver: "branchBound" | "simplex";
  contest_type: "classic" | "showdown";
  teammate_correlation: number;
  opponent_correlation: number;
  enable_bring_back: boolean;
  allow_opponents: boolean;
  card_correlation: number;
}

export function defaultUiSettings(sport: "nba" | "mma" | "golf"): OptimizerUiSettings {
  return {
    strategy: "maxProjection",
    salary_cap: 50_000,
    num_lineups: 20,
    min_projection: 0,
    simulation_count: 1_000,
    unique_lineups: true,
    solver: "branchBound",
    contest_type: "classic",
    teammate_correlation: 0.35,
    opponent_correlation: sport === "mma" ? -0.4 : 0.2,
    enable_bring_back: false,
    allow_opponents: false,
    card_correlation: 0.1,
  };
}

/** Reverse-map a legacy Strategy value into (objective, simulationMode). */
function partsFromStrategy(s: Strategy): { objective: ObjectiveFunction; sim: SimulationMode } {
  if (s === "monteCarlo") return { objective: "maxProjection", sim: "monteCarlo" };
  if (s === "contrarian") return { objective: "maxProjection", sim: "contrarian" };
  return { objective: s, sim: "off" };
}

interface Props {
  sport: "nba" | "mma" | "golf";
  settings: OptimizerUiSettings;
  onChange: (patch: Partial<OptimizerUiSettings>) => void;
  onRun: () => void;
  running: boolean;
}

export function OptimizerSettingsCard({ sport, settings, onChange, onRun, running }: Props) {
  const { objective, sim } = partsFromStrategy(settings.strategy);
  const simulationOn = sim !== "off";

  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-soft">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-base font-semibold tracking-tight">Optimizer Settings</h3>
        <p className="text-xs text-ink-subtle mt-0.5">
          Pick what "best" means (objective), then optionally add variance sampling.
        </p>
      </div>

      <div className="px-4 py-4 space-y-4">
        <Field label="Objective (deterministic)">
          <div className="space-y-1.5">
            {OBJECTIVES.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex items-start gap-2 border rounded-md px-3 py-2 cursor-pointer transition-colors",
                  objective === o.value ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <input
                  type="radio"
                  name="objective"
                  checked={objective === o.value}
                  onChange={() => onChange({ strategy: strategyFromParts(o.value, sim) })}
                  className="mt-0.5 accent-[#2c5282]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-[11px] text-ink-subtle leading-snug">{o.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Simulation (optional variance sampling)">
          <div className="space-y-1.5">
            {SIMULATION_MODES.map((m) => (
              <label
                key={m.value}
                className={cn(
                  "flex items-start gap-2 border rounded-md px-3 py-2 cursor-pointer transition-colors",
                  sim === m.value ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <input
                  type="radio"
                  name="simulation"
                  checked={sim === m.value}
                  onChange={() => onChange({ strategy: strategyFromParts(objective, m.value) })}
                  className="mt-0.5 accent-[#2c5282]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{m.label}</span>
                  <span className="block text-[11px] text-ink-subtle leading-snug">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        {simulationOn && (
          <Field label="Simulations" hint="1k is fast; 10k is the GPP sweet spot.">
            <NumberInput
              value={settings.simulation_count}
              min={100}
              step={1000}
              onChange={(v) => onChange({ simulation_count: v })}
            />
          </Field>
        )}

        {sport === "nba" && (
          <Field label="Contest type">
            <select
              className="border border-slate-300 rounded-md w-full px-2 py-1.5 text-sm bg-white"
              value={settings.contest_type}
              onChange={(e) => onChange({ contest_type: e.target.value as "classic" | "showdown" })}
            >
              <option value="classic">Classic ($50k)</option>
              <option value="showdown">Showdown ($50k)</option>
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Lineups">
            <NumberInput value={settings.num_lineups} min={1} max={500} onChange={(v) => onChange({ num_lineups: v })} />
          </Field>
          <Field label="Salary cap">
            <NumberInput value={settings.salary_cap} min={1000} step={500} onChange={(v) => onChange({ salary_cap: v })} />
          </Field>
        </div>

        <Field label="Min projection">
          <NumberInput value={settings.min_projection} min={0} step={0.5} decimal onChange={(v) => onChange({ min_projection: v })} />
        </Field>

        <label className="flex items-start gap-2 text-sm border border-slate-200 rounded-md px-3 py-2">
          <input
            type="checkbox"
            checked={settings.unique_lineups}
            onChange={(e) => onChange({ unique_lineups: e.target.checked })}
            className="mt-0.5 rounded border-slate-300 text-brand focus:ring-brand"
          />
          <span className="min-w-0">
            <span className="block font-medium text-ink">Unique lineups</span>
            <span className="block text-[11px] text-ink-subtle leading-snug">
              On: N distinct lineups (the N best different combinations). Off: the single optimal lineup repeated N times.
            </span>
          </span>
        </label>

        <Field label="Solver">
          <div className="grid grid-cols-2 gap-2">
            {([
              ["branchBound", "Branch & Bound", "Integer search — returns the lineups."],
              ["simplex", "Simplex (LP relaxation)", "Shows the LP bound. Same lineups."],
            ] as const).map(([val, title, desc]) => (
              <button
                key={val}
                type="button"
                onClick={() => onChange({ solver: val })}
                className={cn(
                  "text-left border rounded-md px-3 py-2 transition-colors",
                  settings.solver === val ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <span className="block text-sm font-medium text-ink">{title}</span>
                <span className="block text-[11px] text-ink-subtle leading-snug">{desc}</span>
              </button>
            ))}
          </div>
        </Field>

        <details className="border border-slate-200 rounded-md">
          <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-ink select-none">Advanced</summary>
          <div className="px-3 py-3 space-y-3 border-t border-slate-200">
            {sport === "nba" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Teammate corr.">
                    <NumberInput value={settings.teammate_correlation} min={0} max={1} step={0.05} decimal onChange={(v) => onChange({ teammate_correlation: v })} />
                  </Field>
                  <Field label="Opponent corr.">
                    <NumberInput value={settings.opponent_correlation} min={-1} max={1} step={0.05} decimal onChange={(v) => onChange({ opponent_correlation: v })} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.enable_bring_back}
                    onChange={(e) => onChange({ enable_bring_back: e.target.checked })}
                    className="rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span>Bring-back (opponent from same game required)</span>
                </label>
              </>
            )}
            {sport === "mma" && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.allow_opponents}
                    onChange={(e) => onChange({ allow_opponents: e.target.checked })}
                    className="rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span>Allow both fighters from same bout</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Opponent corr.">
                    <NumberInput value={settings.opponent_correlation} min={-1} max={1} step={0.05} decimal onChange={(v) => onChange({ opponent_correlation: v })} />
                  </Field>
                  <Field label="Card corr.">
                    <NumberInput value={settings.card_correlation} min={0} max={1} step={0.05} decimal onChange={(v) => onChange({ card_correlation: v })} />
                  </Field>
                </div>
              </>
            )}
          </div>
        </details>

        <button
          type="button"
          disabled={running}
          onClick={onRun}
          className={cn(
            "w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-700 text-white font-medium px-4 py-2.5 rounded-md transition-colors",
            running && "opacity-60 cursor-not-allowed",
          )}
        >
          <PlayCircle className="w-5 h-5" />
          {running ? "Generating…" : "Generate Lineups"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-ink-muted mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-ink-subtle mt-1">{hint}</div>}
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  decimal,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimal?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (Number.isFinite(v)) onChange(v);
      }}
      className="border border-slate-300 rounded-md w-full px-2 py-1.5 text-sm bg-white tabular-nums"
    />
  );
}
