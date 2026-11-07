# Fantasy Grinder — Operator Runbook

For the customer / ops team. **Last verified 2026-11-04 against the live site and this repo's tip.**

## What is live today

| Component | Where | Status |
|---|---|---|
| React frontend | **Cloudflare Pages** — <https://mavis-fantasy-grinder.pages.dev> | **Live.** Built from `frontend/react/`, published by `scripts/mavis-deploy-cloudflare.mjs`. |
| Optimizer | In the browser (Web Worker) | **Live.** This is what the public site runs. |
| Django API | `backend/django` | **Not deployed.** The code is in the repo and CI-tested, but nothing on the live site calls it. |
| Postgres | — | **Not deployed.** Comes with the Django service when it is deployed. |

The live site is frontend-only. Anything in this runbook that mentions `fantasy-grinder-api.onrender.com`
describes the backend **once it is deployed** — it is not running today.

## Health checks

```bash
# Frontend (live)
curl -I https://mavis-fantasy-grinder.pages.dev/
# → 200 OK, Content-Type: text/html

# Is the live site the build you think it is?
cd frontend/react
node scripts/mavis-verify-deploy.mjs
# → hashes every asset the live HTML references and compares it with dist/

# Backend liveness — only after the Django service is deployed
curl https://fantasy-grinder-api.onrender.com/api/health/
# → {"status":"ok","service":"fantasy-grinder-api","version":"1.0.0","db":"ok"}
```

**A deploy is not finished until `mavis-verify-deploy.mjs` passes.** A command returning zero is not
proof that the live site serves the new build.

## Common operations

### Re-seed sample data (NBA/MMA/Golf slates with players)

```bash
# Render shell, or locally:
cd backend/django
python manage.py load_sample_data --reset
```

### Tail the Django logs

Render Dashboard → `fantasy-grinder-api` → Logs. Filter by level:

- `INFO`: optimizer runs, requests
- `WARNING`: parity drift, slow runs
- `ERROR`: 500s, unhandled exceptions

### Run the parity harness against production data

```bash
cd backend/django
pytest tests/parity -q -v --tb=short
# CI runs the same suite on every push — see .github/workflows/ci.yml
```

### Toggle the optimizer backend

The optimizer accepts `solver_backend=pulp|ortools`. Default `pulp` is parity-safe; `ortools` is
opt-in for speed.

> The backend requirements pin `pulp>=2.8,<3`. PuLP 4 changed the `LpVariable` API and the solver
> code here is written against 2.x. Do not relax the pin without porting the solver.

```bash
curl -X POST $API/api/optimize/ -H 'Content-Type: application/json' -d '{
  "sport": "nba",
  "solver_backend": "ortools",
  "settings": { ... },
  "players": [ ... ]
}'
```

## Database migrations

```bash
cd backend/django
python manage.py makemigrations
python manage.py migrate
```

Migrations live under each app: `apps/<app>/migrations/*.py`.

## Deployment

### Frontend (Cloudflare Pages) — this is the live path

```bash
cd frontend/react
npm run build
node scripts/mavis-deploy-cloudflare.mjs
node scripts/mavis-verify-deploy.mjs      # must pass before you call it done
```

`mavis-deploy-cloudflare.mjs --dry-run` prints the file list and total size without uploading.

#### Deploy authentication — resolved once, never a per-deploy step

The publish path needs **no human at run time**. Wrangler's stored OAuth
session refreshes itself; the script uses that session and prints the account
and project it is about to publish to before anything is uploaded. Nobody is
asked to sign in per deploy, to paste a token, or to approve anything while
the publish runs.

```
node scripts/mavis-deploy-cloudflare.mjs --check   # auth + target, uploads nothing
```

- Account: `2699adb1984283a8486bc169c8376a21` (`Ebridavid@gmail.com's Account`)
- Token scope includes `pages (write)` — the publish needs nothing more.
- Credentials live at `C:\Users\D\.wrangler\config\default.toml`, outside the repo.
- The wrangler version is pinned to `4.157.0` because 4.158+ refuses an
  OAuth login in a non-interactive shell and demands a long-lived API token.
  A global wrangler newer than 4.157 is detected and passed over.
- The ONLY case that needs a human is a machine where the OAuth session is
  missing entirely (fresh machine, or a wiped `.wrangler`). Then, once:
  `npx wrangler@4.157.0 login`. That is the whole of it.

**If you are reading this because a previous run said "not authenticated":
that is the one-time case above. Fix it and move on — it is not a recurring
step and it is never a question for the customer.**

### Backend (Render) — not deployed yet

`backend/django/render.yaml` provisions the web service and Postgres. Render runs:

1. `pip install -r requirements.txt`
2. `python manage.py collectstatic --noinput`
3. `python manage.py migrate`
4. `gunicorn config.wsgi:application --workers 4 --timeout 120`

### Rollback

```bash
# Frontend: Cloudflare Pages dashboard → pick a previous deployment and roll back
# Backend:  Render Dashboard → Manual Deploy → pick a previous commit
```

## Parity troubleshooting

If `pytest tests/parity` fails on a new commit:

1. **Identify which vector failed**:
   `pytest tests/parity/test_parity.py::test_parity_top_score[nba_classic_maxproj_12p]`
2. **Check `top_score` vs `expected.top_score`**:
   - Within 1e-6 (pulp): solver outputs are within float noise — investigate.
   - Different by >1e-6: real drift — stop the deploy, file an issue.
3. **Compare lineups**: the test logs the returned lineup's `unique_key`. If the
   `expected.lineup_ids` is a *set* (multiple optima), accept any.
4. **Reproduce locally**: `pytest tests/parity -v --tb=long`.

## When to escalate

| Symptom | Owner | Action |
|---|---|---|
| Live site shows a sample-roster banner | Frontend | ESPN's feed is unreachable from the customer's network, or ESPN is down. The app is behaving correctly — do not treat it as an outage. |
| `api/optimize` returns `optimizer_error` | Backend | Check logs for stack trace. Usually a constraint solver issue. |
| `import/csv` returns `import_failed` | Backend | Verify the CSV has expected headers (`Name`, `Position`, `Salary`, `Game Info`). |
| Frontend 404 on `/nba` etc. | Frontend | Check the SPA rewrite rule (`_redirects` / Pages config) sends unknown paths to `/index.html`. |
| Parity test flakey | Backend | Solver noise. Re-run with explicit `seeds` in the request. |

## Capacity notes

| Item | Today | At scale |
|---|---|---|
| Cloudflare Pages | Static CDN, no server | Fine well past launch traffic |
| Render web dyno (not live) | 4 workers × 120s timeout | CPU-bound: optimize of a 150-player NBA Monte Carlo takes ~30s with 10k sims |
| Postgres (not live) | Starter (1 GB / 0.25 CU) | Upgrade to Standard when audit table > ~100k rows |
| Solver throttling | 30/min/IP (`OptimizeThrottle`) | Adjust in `config/settings.py` if GTM requires higher |

## Incident contact

| Severity | Channel | Response |
|---|---|---|
| P0: optimizer returning wrong results | Slack #engineering-war-room | < 1h |
| P1: API 5xx | Slack #engineering | < 4h business |
| P2: cosmetic, parity drift | Linear backlog | < 1 week |
