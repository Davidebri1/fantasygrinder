/**
 * Lineup count picker — how many lineups to build.
 *
 * The counts are the ones a daily contest actually uses: 2 for a double, 20
 * for a mid-size multi, 150 for the maximum a contest site will take. A
 * custom field goes up to 2000 for the big ones.
 */
import { cn } from "@/lib/utils";

const PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100, 125, 150];

export const MAX_LINEUPS = 2000;

export function LineupCountPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            "min-w-[38px] h-8 px-2 text-sm num transition-colors",
            value === n
              ? "bg-action text-canvas font-semibold rounded-1 shadow-action"
              : "control hover:text-ink",
          )}
        >
          {n}
        </button>
      ))}
      <label className="flex items-center gap-2 ml-1">
        <span className="label">Custom</span>
        <input
          type="number"
          min={1}
          max={MAX_LINEUPS}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.min(MAX_LINEUPS, Math.max(1, Math.round(n))));
          }}
          className="num w-24 h-8 px-2 text-sm bg-inset text-ink rounded-1 border border-line focus:border-brand"
        />
      </label>
    </div>
  );
}
