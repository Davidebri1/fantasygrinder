# Product — what Fantasy Grinder is

## The short version

As of 2026-11-03, Fantasy Grinder is a DFS (daily fantasy sports) lineup optimizer covering **NBA, MMA
and Golf**, built as a **Django + Postgres backend** with a **React/Vite frontend**.

As of `Davidebri1/mavis-fantasy-grinder@7aec943` (2026-11-03), the repository at `C:\Users\D\mavis-fantasy-grinder`
held:

- `backend/django/` — Django + Postgres service. Apps `nba`, `mma`, `golf`, `common`; the optimizer
  package with engines (`bnb`, `milp_ortools`, `milp_pulp`), simulation (`cholesky`, `monte_carlo`),
  sport models (`nba`, `nba_classic_solver`, `mma`, `golf`) and `strategies.py`; integrations for
  ESPN and the Odds API; pytest suites for endpoints, feeds, engine, integrations and parity vectors.
- `frontend/react/` — React 18 + TypeScript + Tailwind, built by Vite into `dist/`. This is the part
  that gets published to the public site.

See [mavis-repository-extraction.md](mavis-repository-extraction.md) for how this repository came to be, and
[mavis-locations.md](mavis-locations.md) for where the code lives on disk.

## The two layers, and which one is the product

This is the single most load-bearing distinction in the project, and it has been stated in the repo's own
README since the React + Django rewrite.

As of `Davidebri1/mavis-fantasy-grinder@7aec943` (2026-11-03), `README.md` stated: the product is Django +
Postgres + React, one service for deployment, and **"the in-browser optimizer is a fallback demo mode,
not the product."**

> **Superseded 2026-11-04.** The README no longer says that, and the claim was wrong about what is
> actually shipping. The live site — <https://mavis-fantasy-grinder.pages.dev> — is the **frontend
> only**, on Cloudflare Pages, running the **in-browser optimizer**. The Django backend is in the
> repo and CI-tested but **not deployed**, and nothing on the live site calls it. The correct
> statement is: the in-browser optimizer is what the customer is using today; the backend is the
> planned next layer. See [mavis-deployment.md](mavis-deployment.md).

1. **Backend layer — Django + Postgres.** It owns slates, players, injury rows, news rows,
   the audit log, ESPN sync and the Odds API. It is **not deployed** as of 2026-11-04; it is one
   Render Blueprint (`backend/django/render.yaml`) away from running.
2. **Frontend layer — React/Vite. Always required.** It renders the player pool, the generated lineups,
   the recommendations panel, player avatars and the export actions. This is the whole of what ships today.
3. **In-browser optimizer — what the live site runs.** `frontend/react/src/optimizer/` is a
   TypeScript port of the same engine and the same five strategies, so the app works with no backend
   at all. As of `7aec943` it contained `milp.ts`, `lp.ts`, `nba_classic.ts`, `portfolio.ts`,
   `stacks.ts`, `simulate.ts`, `sports.ts`, `strategies.ts` and `worker.ts`.

The practical consequence, restated on 2026-11-04: a deploy that leaves the backend unreachable is
not a broken product — the product runs entirely in the browser — but the backend's features
(server-side slates, audit log, Odds API) are simply absent until it is deployed.

## The five strategies

As of `Davidebri1/mavis-fantasy-grinder@7aec943` (2026-11-03), `backend/django/optimizer/strategies.py`
defined five strategies, and `frontend/react/src/pages/SportSelectionScreen.tsx` presented the same
five to the user as *"Five strategies, one engine"*:

| Strategy | What it optimises | Notes from the 2026-11-03 source |
|---|---|---|
| **Max Projection** | Highest sum of projection | One solve, then ±5% perturbation to generate diversity. |
| **Balanced** | Projection per dollar of salary | Score is projection ÷ (salary ÷ 1000). One solve, then ±8% perturbation. |
| **Salary Cap** | Spend the salary cap | A weighted blend favouring salary spend 70% over projection 30%. One solve, then ±8% perturbation. |
| **Contrarian** | Leverage against projected ownership | Same as Monte Carlo but each simulated score is divided by √(ownership ÷ 100). |
| **Monte Carlo** | Lineups that won under random conditions | Samples correlated slates, solves each, collects unique results and returns the top K. |

The five presets are the same for every sport. **Max Projection is the default**; it was moved there from
Monte Carlo because the old default made first-time users wait around 30 seconds for a 10k-simulation run
they did not need (recorded in the repo README before the 2026-11-03 extraction).

The engine underneath is one solver (MILP / simplex) — as of 2026-11-03 the backend exposed
`pulp` and `ortools` backends, and the frontend carried both an LP path and a MILP path. What varies
between strategies is the objective function, not the solver.

## The stacking feature

Added in commit `c415472` ("Glass rebuild + stacking: frosted-glass dark theme, real stack rules,
exposure report, hero art"), 2026-11-03.

A *stack* is a small set of players who belong together and score together — two teammates, the best
players from both sides of one game, or two fighters in one bout. As of
`Davidebri1/mavis-fantasy-grinder@7aec943` (2026-11-03), `frontend/react/src/optimizer/stacks.ts` is the
implementation, and its own module docstring records the important constraint: the module **only
proposes**. It never builds a lineup and never talks to the solver. It returns a `StackRule` that the
engine writes into the build when the user picks that stack.

Three scopes were supported as of 2026-11-03:

- **Team stack** — teammates together in one lineup.
- **Game stack** — the best players from both sides of one game, so a shootout is paid twice.
- **Card stack** — MMA fight-night cards grouped by bout, with one fighter per bout unless the user
  allows the opposite. The internal variant label also distinguishes a single **bout** from a whole card.

The user-facing panel, `frontend/react/src/components/StacksPanel.tsx`, is what turns a proposed stack
into a rule. The design promise recorded on the home screen on 2026-11-03 was: *"Stacks that shape the
lineup, not just the score"* — and the optimizer tells the user when a rule could not be met, rather
than silently ignoring it.

## Related capabilities, with their dates

- **ESPN live sync** (scores, schedule, injury and news) — present by commit `35b7c2b` (2026-10-31),
  wired to the backend and to the pool view.
- **Browse page** (ESPN scores/schedule plus player search) — commit `b90e184`, 2026-10-31.
- **Shared optimizer screen across sports** (one settings card, tabs, recommendations, export) —
  commit `36db807`, 2026-10-31.
- **Portfolio / exposure engine** — `frontend/react/src/optimizer/portfolio.ts` plus
  `src/components/ExposureReport.tsx`, commit `c415472`, 2026-11-03. The hero copy on 2026-11-03
  described it as showing "where your exposure sits before you enter anything".
- **Hero artwork** — `frontend/react/public/hero/*.webp` (stadium bowl, field lines, blurred field),
  commit `c415472`, 2026-11-03.
- **Player headshots for every sport** (32 fighters, 32 golfers), commit `8848153`, 2026-10-31.

## Open point worth carrying forward

**Resolved 2026-11-04.** The README and RUNBOOK described **Netlify** and **Render** as the
production targets while the live site was on **Surge** — a deploy-document drift that would have
sent a customer to the wrong host. Both documents were rewritten on 2026-11-04 to state what is
actually true: the public site is Cloudflare Pages at
<https://mavis-fantasy-grinder.pages.dev>, the backend is in the repo but not deployed, and a deploy
is only "done" when `mavis-verify-deploy.mjs` passes.

**Still open:** the Django backend has never been deployed. Its features (server-side slates, audit
log, Odds API) are absent from the live site until it is.
