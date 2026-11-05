# Fantasy Grinder

A DFS lineup optimizer for **NBA, NFL, MMA and Golf**. It pulls the live slate from ESPN's public
API, builds the roster, and runs a real optimizer in the browser — lineups, exposure, stacking, and
"which of these should I actually enter" for the contest you are playing.

| | |
|---|---|
| **Live site** | <https://mavis-fantasy-grinder.pages.dev> — Cloudflare Pages, built from `frontend/react` |
| **Repository** | <https://github.com/Davidebri1/mavis-fantasy-grinder> |
| **Frontend** | `frontend/react` — Vite + React 18 + TypeScript + Tailwind |
| **Optimizer** | `frontend/react/src/optimizer` — branch-and-bound solver with an LP bound, runs in a Web Worker |
| **Backend** | `backend/django` — Django + Postgres (slates, injury/news feeds, audit log, server-side solver). **In the repo and CI-tested; not deployed.** |

```bash
cd frontend/react
npm install
npm run dev      # local dev server
npm run build    # -> dist/ (this is what gets published)
npm test         # vitest: 48 tests (stacks, portfolio, entry-value model, types, utils)
```

Publish and prove the live site is that exact build:

```bash
node scripts/mavis-deploy-cloudflare.mjs    # uploads dist/ to the Pages project
node scripts/mavis-verify-deploy.mjs        # compares SHA256 of every asset, local vs live
```

**Status (2026-11-04):** live at `https://mavis-fantasy-grinder.pages.dev`, serving the build in this
repo's tip commit — verified by SHA256, not by assumption.

---

## What is real, and what is modelled

This is the most important section in this file, so it is first.

**Live and real** — everything ESPN publishes: player names, teams, positions, injuries, season
averages, today's games and headshots. The app fetches these at runtime from ESPN's public API.

**Modelled, and labelled as modelled everywhere they appear** — three numbers that DraftKings owns
and ESPN does not publish:

| Number | Where it comes from | How the app says so |
|---|---|---|
| **Projection** | DraftKings scoring applied to the player's ESPN season average | "Proj (est.)" on every column, row and export |
| **Salary** | `$150 × projected points + $800`, snapped to $100, clamped to $3,000–$11,500 — so salary-cap maths behaves the way a DFS player expects | "Salary (est.)" everywhere |
| **Ownership** | The player's percentile in the projection ranking — used only to find contrarian leverage | "Own % (est.)" everywhere |

The product does not claim these are DraftKings numbers, and it does not sell them as such. If you
need true DraftKings salaries, this app does not have them.

**The ROI estimate is a model.** It is built from this app's projections, the contest settings you
enter, and a payout model that puts 70% of the prize pool on first place. It is labelled "est. ROI
(model)" in the UI, and every pick also shows its modelled cash rate. It is not a DraftKings payout
projection and it is not a promise.

**Sample data is loud.** If the live ESPN feed cannot be reached, the app falls back to a bundled
sample roster — and it says so in an amber banner across the top of the screen, not in a quiet
status line. Lineups built from sample data are for demonstration only.

---

## The optimizer

One solver, three objectives, three simulation modes.

**Objectives (deterministic):**

- **Max Projection** — the highest total projected points. Cash games and single-entry.
- **Balanced (Value)** — projection per dollar of salary. Efficient builds.
- **Salary Cap** — 70/30 salary-to-projection weight. Stars-and-scrubs builds.

**Simulation modes:**

- **Off** — one exact solve of the roster. The fastest path.
- **Monte Carlo** — 1k–10k correlated outcome samples, one solve each, best unique lineups kept.
- **Contrarian** — like Monte Carlo, but each simulated score is divided by √ownership so low-owned
  ceiling plays gain leverage over chalk.

**Portfolio and stacking** are real constraints, not decoration:

- `portfolio.ts` is a best-first branch-and-bound search with an LP bound on the remaining space.
  On a 421-player NFL pool it reproduces the exact brute-force optimum (134) over all 148,318 legal
  rosters, and a projection bump is swapped into the lineup immediately.
- Stack rules are enforced, not suggested. 150 lineups built against an LV@SF rule all held at least
  four LV@SF players; after the rule was changed, 0 of 150 survived it.
- Exposure is computed from the finished portfolio and independently recounted against the same
  numbers.
- When a rule cannot be met — an infeasible cap, an impossible stack — the app says so instead of
  quietly returning a lineup that violates it.

**Stacks** (targeting a game, a position, or a team) are a first-class control, and the "Stacks" tab
shows the exposure of every stack you built.

---

## What this app does not do

Stated plainly, because a customer shipping this to other people needs to know the edges:

- **The Django backend is not deployed.** The live site is the frontend on Cloudflare Pages, running
  the in-browser optimizer. The backend exists in this repo, is covered by CI, and is one Render
  Blueprint (`backend/django/render.yaml`) away from running — but nothing on the live site calls it
  today.
- **No DraftKings salary, projection, ownership or contest data.** See *What is real, and what is
  modelled* above.
- **No accounts, no login, no payment.** State is per-device via `localStorage`.
- **No live contest results.** Nothing here is connected to a real contest after you enter it.

---

## Deployment

**Cloudflare Pages** is where the public site lives.

```bash
cd frontend/react
npm run build
node scripts/mavis-deploy-cloudflare.mjs        # or: npx wrangler pages deploy dist --project-name=mavis-fantasy-grinder
node scripts/mavis-verify-deploy.mjs            # SHA256 every asset, local vs live
```

`mavis-verify-deploy.mjs` is the point of the setup: it fetches the live site, reads the assets the
live HTML actually references, hashes them, and compares against the local `dist/`. A deploy is
"done" when that script passes — not when a command returns zero.

### The Django backend (optional, not live)

```bash
cd backend/django
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

`backend/django/render.yaml` provisions the web service and Postgres on Render. `config/settings.py`
reads `DATABASE_URL` (password URL-decoded, `sslmode` honoured) and falls back to the individual
`PG*` variables.

`requirements.txt` pins `pulp>=2.8,<3`. PuLP 4 is a Rust-backed rewrite whose `LpVariable` no longer
takes `(name, cat="Binary")`; the solver here is written against the 2.x API. Porting to PuLP 4 is a
rewrite, not a patch.

### Local dev (one command)

```bash
pwsh bin/dev.ps1         # Windows  |  ./bin/dev  # macOS/Linux
```

---

## Verified

| | |
|---|---|
| **Frontend** | 0 TypeScript errors, 48 vitest tests passing, production build clean |
| **Backend** | 42 pytest tests, run in CI on every push |
| **Optimizer** | Exact brute-force optimum reproduced (134) over 148,318 legal NFL rosters; Monte Carlo returns 20 unique lineups in ~15–20 ms |
| **Stacks** | 150/150 lineups held ≥4 LV@SF players under an LV@SF rule; 0/150 survived a changed rule |
| **Exposure** | Exposure maths independently recounted against the same portfolio — exact |
| **Deployment** | Every asset referenced by the live HTML hash-matched against the local build |

---

## Repository layout

```
frontend/react/            the app — this is what ships
  src/optimizer/           solver, portfolio, stacks, worker
  src/lib/espn-live.ts     live ESPN fetch + the modelled salary/projection/ownership layer
  src/lib/data-provenance.ts   one place that says what is real and what is modelled
  scripts/mavis-*.mjs      deploy, verify, layout-check tooling
backend/django/            Django + Postgres service (CI-tested, not deployed)
docs/wiki/                 the project wiki — see docs/wiki/mavis-index.md
docs/architecture.md       system shape and data flow
```

Artifacts created for this project carry the `mavis-` prefix and a descriptive subject
(`mavis-deploy-cloudflare.mjs`, `mavis-fantasy-grinder-home-screen.png`, `docs/wiki/mavis-*.md`) so
they are never mistaken for someone else's file.
