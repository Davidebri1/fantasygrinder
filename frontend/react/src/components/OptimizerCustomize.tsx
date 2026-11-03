/**
 * Customize the optimizer — the controls that change how the portfolio is
 * built.
 *
 * Kept behind a disclosure because most days you never touch them: the
 * defaults produce the right lineup for a cash game. When you do need them,
 * they are grouped by what they actually change: what you are optimising
 * for, how the roster is allowed to be shaped, and how much variance you
 * want to sample.
 */
import {
  OBJECTIVES,
  SIMULATION_MODES,
  type ObjectiveFunction,
  type SimulationMode,
  strategyFromParts,
} from "@/types";
import { cn } from "@/lib/utils";
import type { OptimizerUiSettings } from "./optimizer-settings";

type Sport = "nba" | "nfl" | "mma" | "golf";

function partsFromStrategy(s: OptimizerUiSettings["strategy"]): {
  objective: ObjectiveFunction;
  sim: SimulationMode;
} {
  if (s === "monteCarlo") return { objective: "maxProjection", sim: "monteCarlo" };
  if (s === "contrarian") return { objective: "maxProjection", sim: "contrarian" };
  return { objective: s, sim: "off" };
}

export function OptimizerCustomize({
  sport,
  settings,
  onChange,
}: {
  sport: Sport;
  settings: OptimizerUiSettings;
  onChange: (patch: Partial<OptimizerUiSettings>) => void;
}) {
  const { objective, sim } = partsFromStrategy(settings.strategy);

  const setObjective = (value: ObjectiveFunction) =>
    onChange({ strategy: strategyFromParts(value, sim) });
  const setSim = (value: SimulationMode) =>
    onChange({ strategy: strategyFromParts(objective, value) });

  return (
    <div className="space-y-5">
      <Group title="What you are optimising for">
        <div className="space-y-2">
          {OBJECTIVES.map((o) => (
            <OptionRow
              key={o.value}
              name={o.value}
              title={o.label}
              detail={o.description}
              selected={objective === o.value}
              onSelect={() => setObjective(o.value)}
            />
          ))}
        </div>
      </Group>

      <Group title="How the roster may be shaped">
        <NumberField
          label="Salary cap"
          value={settings.salary_cap}
          min={1000}
          step={500}
          onChange={(v) => onChange({ salary_cap: v })}
        />
        <NumberField
          label="Max exposure"
          value={settings.max_exposure}
          min={1}
          max={100}
          step={5}
          suffix="%"
          hint="No player appears in more than this share of the portfolio."
          onChange={(v) => onChange({ max_exposure: v })}
        />
        <NumberField
          label="Minimum projection"
          value={settings.min_projection}
          min={0}
          step={0.5}
          decimal
          onChange={(v) => onChange({ min_projection: v })}
        />
        <Toggle
          label="Unique lineups"
          detail="Off means the same optimal lineup is repeated for each entry."
          checked={settings.unique_lineups}
          onChange={(v) => onChange({ unique_lineups: v })}
        />
        {sport === "nba" && (
          <Choice
            label="Contest type"
            value={settings.contest_type}
            options={[
              { value: "classic", label: "Classic" },
              { value: "showdown", label: "Showdown" },
            ]}
            onChange={(v) =>
              onChange({ contest_type: v as OptimizerUiSettings["contest_type"] })
            }
          />
        )}
        {sport === "mma" && (
          <Toggle
            label="Allow opponents"
            detail="Off means you cannot hold both fighters from one bout."
            checked={settings.allow_opponents}
            onChange={(v) => onChange({ allow_opponents: v })}
          />
        )}
      </Group>

      <Group title="How much variance to sample">
        <div className="space-y-2">
          {SIMULATION_MODES.map((m) => (
            <OptionRow
              key={m.value}
              name={m.value}
              title={m.label}
              detail={m.description}
              selected={sim === m.value}
              onSelect={() => setSim(m.value)}
            />
          ))}
        </div>
        {sim !== "off" && (
          <NumberField
            label="Simulations"
            value={settings.simulation_count}
            min={100}
            step={100}
            onChange={(v) => onChange({ simulation_count: v })}
          />
        )}
      </Group>

      <Group title="Correlation between players">
        <NumberField
          label="Teammates"
          value={settings.teammate_correlation}
          min={0}
          max={1}
          step={0.05}
          decimal
          onChange={(v) => onChange({ teammate_correlation: v })}
        />
        <NumberField
          label="Opponents"
          value={settings.opponent_correlation}
          min={-1}
          max={1}
          step={0.05}
          decimal
          onChange={(v) => onChange({ opponent_correlation: v })}
        />
        {sport === "mma" && (
          <NumberField
            label="Same card"
            value={settings.card_correlation}
            min={0}
            max={1}
            step={0.05}
            decimal
            onChange={(v) => onChange({ card_correlation: v })}
          />
        )}
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="label font-medium text-ink mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function OptionRow({
  name,
  title,
  detail,
  selected,
  onSelect,
}: {
  name: string;
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full text-left px-3 py-2 rounded-2 border transition-colors",
        selected
          ? "border-brand bg-brand-wash"
          : "border-line bg-surface-2 hover:border-line-strong",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="label-quiet">{name}</span>
      </div>
      <p className="label-quiet mt-0.5">{detail}</p>
    </button>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex gap-1 p-1 rounded-2 bg-inset border border-line">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "flex-1 h-7 text-sm rounded-1 transition-colors",
              value === o.value
                ? "bg-surface-1 text-ink font-medium shadow-1"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-[var(--brand)]"
      />
      <span>
        <span className="text-sm text-ink">{label}</span>
        {detail && <span className="label-quiet block">{detail}</span>}
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  decimal,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  decimal?: boolean;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(
              decimal ? n : Math.round(n),
            );
          }}
          className="num w-28 h-8 px-2 text-sm bg-inset text-ink rounded-1 border border-line focus:border-brand"
        />
        {suffix && <span className="label">{suffix}</span>}
        {hint && <span className="label-quiet">{hint}</span>}
      </div>
    </div>
  );
}
