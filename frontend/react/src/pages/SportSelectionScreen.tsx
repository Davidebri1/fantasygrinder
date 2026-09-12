import { Link } from "react-router-dom";
import { Card } from "@/components/Card";
import { BASKETBALL_ICON, GOLF_ICON, MMA_ICON } from "@/components/icons";

export function SportSelectionScreen() {
  return (
    <div>
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Choose your sport</h1>
        <p className="text-ink-muted mt-2">
          The same optimizer engine — five strategies, full DraftKings parity.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SportCard
          title="NBA Optimizer"
          description="Classic + Showdown. Bipartite position assignment, team stacking, bring-back rules."
          to="/nba"
          icon={BASKETBALL_ICON}
          badge="Most popular"
        />
        <SportCard
          title="MMA Optimizer"
          description="6-fighter rosters, opponent correlation modeling, allow/disallow both fighters in same bout."
          to="/mma"
          icon={MMA_ICON}
        />
        <SportCard
          title="Golf Optimizer"
          description="6-golfer rosters, optional card correlation, salary-cap tuning."
          to="/golf"
          icon={GOLF_ICON}
        />
      </div>

      <section className="mt-12 bg-white border border-slate-200 rounded-md p-6 shadow-soft">
        <h2 className="text-lg font-semibold tracking-tight">Five strategies, shared engine</h2>
        <p className="text-sm text-ink-muted mt-1">
          All three sports ship with the same five strategy presets.
        </p>
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
          {[
            ["Monte Carlo", "Diversified GPP builds driven by 10k correlated simulations."],
            ["Max Projection", "MILP-optimal base projection. Best for cash games."],
            ["Contrarian", "Divide score by √ownership for tournament leverage."],
            ["Balanced", "Maximize projection per dollar — efficient salary usage."],
            ["Salary Cap", "Spend aggressively while keeping projections reasonable."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 shrink-0" />
              <div>
                <strong className="font-medium">{title}</strong>
                <p className="text-ink-muted mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SportCard(props: { title: string; description: string; to: string; icon: React.ReactNode; badge?: string }) {
  return (
    <Link to={props.to} className="block">
      <Card className="p-6 hover:shadow-lg transition-shadow">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-md bg-brand/10 grid place-items-center text-brand">
            {props.icon}
          </div>
          {props.badge && (
            <span className="text-[10px] tracking-wide uppercase bg-brand/10 text-brand-700 px-1.5 py-0.5 rounded">
              {props.badge}
            </span>
          )}
        </div>
        <h3 className="text-lg font-semibold mt-3">{props.title}</h3>
        <p className="text-sm text-ink-muted mt-1">{props.description}</p>
      </Card>
    </Link>
  );
}
