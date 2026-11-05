# Fantasy Grinder

A DFS lineup optimizer for **NBA, MMA, and Golf** with **player headshots**, **smart recommendations**, and a **full database backend** (ESPN sync, Odds API, audit log). The backend is mandatory, not optional.

## Where this lives

| | |
|---|---|
| **Live site** | <https://mavis-fantasy-grinder.pages.dev> (Cloudflare Pages, built from `frontend/react`) |
| **Repository** | `github.com/Davidebri1/mavis-fantasy-grinder` — this repo, home of the app |
| **Frontend** | `frontend/react` — Vite + React 18 + TypeScript + Tailwind |
| **Backend** | `backend/django` — Django + Postgres (ESPN sync, Odds API, audit log) |
| **Optimizer** | `frontend/react/src/optimizer` — in-browser MILP/simplex solver, portfolio + stacks |

```bash
cd frontend/react
npm install
npm run dev      # local dev server
npm run build    # -> dist/ (this is what gets published)
npm test         # vitest, includes stacks + portfolio suites
```

Publish it to Cloudflare Pages and then prove the live site is that exact build:

```bash
node scripts/mavis-deploy-cloudflare.mjs    # uploads dist/ to the Pages project
node scripts/mavis-verify-deploy.mjs        # compares SHA256 of every asset, local vs live
```

**Status as of 2026-11-04:** live at `https://mavis-fantasy-grinder.pages.dev`, serving the
build in this repo's tip commit — verified by SHA256, not by assumption.

## Architecture — what the product actually is

The product is **Django + Postgres + React**. One service for deployment (Render Blueprint provisions web service + database). The in-browser optimizer is a fallback demo mode, not the product.

| Layer | What | Status |
|---|---|---|
| **Django + Postgres** | Slates, players, injury rows, news rows, audit log, ESPN sync, Odds API | **Mandatory** — this is the app |
| **React frontend** | Player pool, lineups, recommendations, avatars, exports | Always required |
| **In-browser optimizer** | Same 5 strategies as the backend, in TypeScript, for offline demo | Fallback when backend unreachable |

## Optimizer structure — facts vs samples

The solver is ONE engine (MILP / simplex). What varies is the objective:

**Objectives (deterministic facts — "this IS the best lineup by X"):**
- **Max Projection** — highest Σ projection. Cash games, single-entry.
- **Balanced (Value)** — projection per dollar. Efficient builds.
- **Salary Cap** — 70/30 salary-to-projection weight. Stars-and-scrubs.

**Simulation modes (probabilistic samples — "lineups that won under random conditions"):**
- **Off** (default) — no simulation. Pure deterministic.
- **Monte Carlo** — 1k–10k correlated outcome samples, optimize each.
- **Contrarian** — like Monte Carlo but scores ÷ √ownership for leverage.

These are separate controls in the UI because they are different kinds of answers. The default is **Max Projection, simulation off** — a fact, fast, no waiting.

## Value-adds no competitor ships

1. **Player headshots** — every player in the pool, in every generated lineup, in the recommendations panel. Three-tier fallback (NBA CDN → deterministic initials). Visual recognition is the primary scan signal and every competitor is text-only.
2. **Smart recommendations** — the optimizer produces lineups; the recommendations panel answers "which ones should I enter?" per contest type (cash / GPP / single) with bankroll awareness, ROI estimate, and per-pick reasoning.
3. **ESPN injury + news sync** — public ESPN API → Postgres → inline OUT-badges next to affected players in your pool. Mandatory, wired, tested.

## Deployment — Render, one Blueprint

```bash
git init && git add . && git commit -m "init"
gh repo create fantasy-grinder --public --source=. --push
# Render Dashboard → New Blueprint → render.yaml → provisions web + Postgres
# Render shell: python manage.py migrate && python manage.py load_sample_data
# Netlify: import repo, build = cd frontend/react && npm run build, publish = dist
#   env: VITE_API_URL=https://<your-service>.onrender.com
```

### Local dev (one command)

```bash
pwsh bin/dev.ps1         # Windows  |  ./bin/dev  # macOS/Linux
```

### Offline demo (no backend)

`frontend/react/dist/index.html` opens standalone — the optimizer, sample data, and recommendations work; ESPN sync shows a clear "backend not configured" state instead of failing silently.

## Verified

- **Backend**: 48 pytest passing (engine, parity vectors, integrations, API, injury/news feeds).
- **Frontend**: 0 TypeScript errors, 13 vitest passing, 5s build, 215 KB gzipped.
- **Optimizer**: NBA Classic maxProjection 385.0 on 30-player sample. MMA opponent-exclusion 264.0. Monte Carlo 20 unique lineups in 14–20ms.
- **Recommendations**: cash (350% ROI), GPP (4150% at $3 entry), single-entry — all bankroll-capped, all sorted correctly.

## Deployment — one service, no vendor shopping

**Render for everything.** Frontend, backend, Postgres. The `render.yaml` Blueprint at the repo root creates all three with one click.

```bash
# 1. Push the repo to GitHub
git init && git add . && git commit -m "init"
gh repo create fantasy-grinder --public --source=. --push

# 2. Render Dashboard → New Blueprint → select render.yaml
#    Provisions:
#      - fantasy-grinder-api (Django web service)
#      - fantasy_grinder_db  (Postgres)

# 3. Wait for the first deploy. Run migrations via Render shell:
#      python manage.py migrate
#      python manage.py load_sample_data

# 4. Netlify: import the repo. Build command: cd frontend/react && npm install && npm run build
#    Publish dir:   frontend/react/dist
#    Env var:       VITE_API_URL=https://<your-render-service>.onrender.com
```

The customer gets `https://<your-site>.netlify.app` — a hosted web app with the in-browser optimizer, ESPN sync, and full database backend. No app downloads, no terminals.

### Local dev (one command)

```bash
pwsh bin/dev.ps1         # Windows
./bin/dev                # macOS / Linux
```

The script creates a venv, installs Python deps, builds the React app, runs migrations, seeds sample data, and starts Django on `:8000` with the React build served at `/`. Open <http://localhost:8000/>.

## For the customer who wants offline / no-account

`frontend/react/dist/index.html` — drag the `dist/` folder anywhere (Netlify Drop, S3, GitHub Pages, USB stick) and double-click `index.html`. The optimizer, sample data, CSV/Excel export, and recommendations all work without any backend. Only ESPN sync is offline-disabled (it needs the backend).

```
C:\Users\D\Desktop\FantasyGrinder\        ← the deliverable
  ├── index.html
  ├── favicon.svg
  ├── netlify.toml                       ← tells Netlify to serve as SPA
  └── assets\
      ├── index-*.js                     (in-browser optimizer + UI, 668 KB / 215 KB gz)
      └── index-*.css
```

## Verified

- **Optimizer**: NBA Classic maxProjection on 30-player sample: 8 slots, $40,500, 385.0 projection. NBA Monte Carlo (1000 sims): 20 unique lineups in 14–20ms.
- **MMA**: opponent-exclusion correctly produces 264.0 with `allow_opponents=False` (1 per bout), 408.0 with `True` (all 6).
- **Golf**: maxProjection on 12-player pool produces valid 6-golfer lineups under $50k.
- **Recommendations**: Cash / GPP / Single-entry profiles tested via Node:
  ```
  $3 GPP, $30 bankroll → 3 picks, 4150% est. ROI, sorted by projection × leverage
  $20 GPP, $100 bankroll → 5 picks, 2025% est. ROI
  $5 Cash, $50 bankroll → 5 picks, 350% est. ROI, sorted by raw projection
  ```
  (ROI model is intentionally simple — real DK payout tables in v1.1.)
- **Frontend build**: 5s, 215 KB gzipped, 0 TypeScript errors.
- **Backend tests**: 42 pytest passing (engine + parity + integration + API).

## Default strategy is Max Projection, not Monte Carlo

We changed the default away from Monte Carlo. The original legacy default made first-time users wait ~30 seconds for a 10k-sim run that most of them didn't need.

- **Default: Max Projection** — 1 MILP solve, ~10ms. Right answer for cash games and single-entry tournaments.
- **Monte Carlo** is still selectable in the Strategy dropdown, now labeled "Monte Carlo (GPP)", and shows a banner explaining it's for tournament / multi-entry play where variance matters.
- **Smart Recommendations** picks the right strategy per contest type at the lineup-selection step, not at the generate-lineups step — so the customer doesn't have to think about it.

If the customer is a serious tournament player, they switch to Monte Carlo themselves. If they're new, they get a fast correct answer on first try.

## What's in scope, what's not

In scope:
- 3 sports × 5 strategies
- Player headshots (with multi-tier fallback: NBA CDN → initials)
- CSV / XLSX export
- ESPN injury + news sync
- Odds API integration (server-side; needs `ODDS_API_KEY` env)
- Smart recommendations
- Late-swap import (NBA)
- Postgres audit log

Out of scope (v1):
- Auth / per-user accounts (the customer is anonymous; per-device state via localStorage)
- Real-money contest integration
- Mobile native apps (this is web; the JS bundle is responsive)
