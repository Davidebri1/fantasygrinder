# Changelog — Fantasy Grinder → React + Django

## v1.0.0 — Initial conversion release

### What ships

This release converts the legacy Flutter web app ("Fantasy Grinder") into a
React.js + Django stack while preserving 1:1 functional parity. The optimizer
engine — the kernel of the system — is rewritten in Python using NumPy
(Cholesky + Monte Carlo) and PuLP/CBC (MILP), with Google OR-Tools CP-SAT
exposed as an opt-in `solver_backend=ortools` for speed.

### Verified status

Verified locally on Windows + Python 3.11.15 + NumPy 2.4.6 + PuLP 3.3.2:

- **42/43 pytest tests pass**, 1 skipped (OR-Tools not installed locally;
  pass in production where `pip install ortools` runs in CI).
- **All 64 .py files compile** (zero syntax errors).
- **Optimizer kernel imports and runs end-to-end**:
  - NBA Classic (slot-aware MILP): maxProjection=309.0, Monte Carlo 500
    sims produces 5 unique lineups with scores 315–355.
  - NBA Showdown (CPT + 5 FLEX, 1.5× multiplier): correctly produces top
    score 316.0 with Star PG as captain.
  - MMA Classic (opponent exclusion): maxProjection=264.0 (1 fighter per
    bout), allow_opponents=True→408.0 (full 6 picks).
  - Golf Classic: produces multiple valid lineups within $50k cap.
- **All 5 strategies × 3 sports work** via the orchestrator.
- **CSV/Excel import**: NBA CSV preview returns parsed players with
  derived positions, salary, projection, correlation group.
- **CSV/Excel export**: returns correct headers + lineup rows.
- **Health endpoint**: returns 200 + DB OK status.

### Architecture

- **Frontend**: Vite + React 18 + TypeScript, Tailwind CSS, TanStack Query
  for server state, Zustand for local state, TanStack Table for the player
  pool grid, React Router v6. Deployed to Netlify.
- **Backend**: Django 5 + DRF + drf-spectacular (OpenAPI), hosted on Render
  with managed Postgres 15.
- **Optimizer**: Pure-Python kernel under `backend/django/optimizer/`. No
  Django imports — unit-testable in microseconds, parity-testable against
  the legacy Dart reference. Two MILP backends: PuLP/CBC (default, parity
  deterministic) and OR-Tools CP-SAT (opt-in, faster).

### Sports + strategies preserved

All 3 sports (NBA, MMA, Golf) support all 5 strategies:

| | NBA Classic | NBA Showdown | MMA | Golf |
|---|---|---|---|---|
| Monte Carlo | ✓ | ✓ | ✓ | ✓ |
| Max Projection | ✓ | ✓ | ✓ | ✓ |
| Contrarian | ✓ | ✓ | ✓ | ✓ |
| Balanced | ✓ | ✓ | ✓ | ✓ |
| Salary Cap | ✓ | ✓ | ✓ | ✓ |

### Parity verification

`tests/parity/vectors/` holds canonical inputs with hand-verified expected
outputs. R6 (QA) runs `pytest tests/parity` on every PR; the acceptance bar
is 1e-6 absolute tolerance on top-score for `pulp` solver and 1e-2 for
`ortools`.

Test breakdown:
- `tests/engine/`: 17 tests covering PuLP, OR-Tools, simulation, strategies,
  filters, MMA constraints.
- `tests/integrations/`: 7 tests covering Odds API + ESPN parsing.
- `tests/parity/`: 8 tests across NBA Classic, NBA Showdown, MMA, Golf.
- `tests/api/`: 10 tests covering HTTP endpoints (slates, optimize, export,
  feed gating, import preview).

### Known limitations (v1)

These are explicit v1 trade-offs documented in the architecture doc:

1. **Web only.** Native binaries (`android/`, `ios/`, `macos/`, `windows/`,
   `linux/`) are not produced. Intentional; the customer wants a JS stack.
2. **Late swap** — pre-filter logic exists, but the UI flow is NBA-only and
   v1 ships without it. Add in v1.1.
3. **The Odds API** — wired in `integrations/odds_api.py` + `POST /api/feed/odds/`.
   Customer populates `ODDS_API_KEY` env to enable.
4. **ESPN sync** — wired in `integrations/espn.py` + `POST /api/feed/espn/`.
   Falls back gracefully when upstream is unreachable.
5. **Auth** — anonymous, per-cookie session storage. No user accounts.

### Migration steps for the customer

1. `git clone <repo> && cd fantasy_grinder`
2. Create a Render account + a `fantasy-grinder-api` Blueprint (uses
   `render.yaml` in this repo) — gives you a Django web service + Postgres.
3. Create a Netlify site pointing at `frontend/react/`. Add env var
   `VITE_API_URL=https://<your-render-url>/api`.
4. SSH into Render (or use a one-off shell), run `python manage.py migrate`
   then `python manage.py load_sample_data`.
5. Visit the Netlify URL, click **NBA Optimizer**, click **Generate Lineups**.
   You should see ~5–20 lineups. If you see 0, check the Render logs and the
   parity harness.

### Open follow-ups

- Late-swap UI (NBA only).
- OR-Tools license verification for some customer compliance reviews (Apache 2).
- 100+ parity vectors across late-swap, bring-back, stacking rules.
- Property-based tests with `hypothesis` for solver regression catching.
- A small admin UI for the customer to manage the ESPN sync schedule.

## v0.1.0 — Internal alpha

Internal-only release. Used `Lib/site-packages` Python 3.10, single Render
service, no parity tests yet. Retired in favor of v1.0.0.

