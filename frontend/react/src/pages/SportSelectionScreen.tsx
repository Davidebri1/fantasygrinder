import { HeroPanel } from "@/components/HeroPanel";

export function SportSelectionScreen() {
  return (
    <div className="space-y-6">
      <HeroPanel />

      {/* ── Shared engine ────────────────────────────────────────────
          The hero cards sit in their own band above this section, so
          nothing here reaches into them. */}
      <section className="panel p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-semibold tracking-tight text-ink">
              Four strategies, one engine
            </h2>
            <p className="label mt-1">
              Every sport ships with the same four strategy presets.
            </p>
          </div>
        </div>
        <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
          {[
            ["Monte Carlo", "Diversified tournament builds driven by correlated simulations."],
            ["Max Projection", "The best possible lineup by projection. Best for cash games."],
            ["Balanced", "Maximize projection per dollar — efficient salary usage."],
            ["Salary Cap", "Spend aggressively while keeping projections reasonable."],
          ].map(([title, body]) => (
            <li key={title} className="border-t border-line pt-3">
              <strong className="font-medium text-ink">{title}</strong>
              <p className="label mt-0.5">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Stacks ─────────────────────────────────────────────────── */}
      <section className="panel p-6 md:p-8">
        <h2 className="font-condensed text-2xl font-semibold tracking-tight text-ink">
          Stacks that shape the lineup, not just the score
        </h2>
        <p className="label mt-1 max-w-[70ch]">
          Players on the same team score together. The optimizer can be told
          to build that in, and it will tell you when a rule could not be met.
        </p>
        <ul className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-4">
          {[
            [
              "Team stack",
              "A quarterback and his receivers, or any two teammates, together in one lineup.",
            ],
            [
              "Game stack",
              "The best players from both sides of one game, so a shootout is paid twice.",
            ],
            [
              "Card stack",
              "Fight-night cards grouped by bout, with one fighter per bout unless you allow it.",
            ],
          ].map(([title, body]) => (
            <li key={title} className="border-t border-line pt-3">
              <strong className="font-medium text-ink">{title}</strong>
              <p className="label mt-0.5">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
