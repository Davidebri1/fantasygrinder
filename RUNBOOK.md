# Fantasy Grinder — Operator Runbook

This runbook is for the customer / ops team. It assumes the system is deployed as
described in `README.md`. Last verified against commit hash on Render/Netlify.

## What lives where

| Component | Where | How it's run |
|---|---|---|
| React frontend | Netlify (`fantasy-grinder.netlify.app`) | `npm run build` from `frontend/react/` |
| Django API | Render (`fantasy-grinder-api.onrender.com`) | `gunicorn config.wsgi:application --workers 4` |
| Postgres | Render (`fantasy_grinder_db`, plan: starter) | Managed by Render |
| Static files | Served by Django (whitenoise) for dev; S3 in prod (TODO) |  |

## Health checks

```bash
# Backend liveness
curl https://fantasy-grinder-api.onrender.com/api/health/
# → {"status":"ok","service":"fantasy-grinder-api","version":"1.0.0","db":"ok"}

# Frontend
curl -I https://fantasy-grinder.netlify.app/
# → 200 OK with `Content-Type: text/html`
```

## Common operations

### Re-seed sample data (NBA/MMA/Golf slates with players)

```bash
# SSH into the Render web service (or run via Render shell)
python manage.py load_sample_data --reset
```

### Tail the Django logs

Render Dashboard → `fantasy-grinder-api` → Logs. Filter by level:
- `INFO`: optimizer runs, requests
- `WARNING`: parity drift, slow runs
- `ERROR`: 500s, unhandled exceptions

### Run the parity harness against production data

```bash
# Local
cd backend/django
pytest tests/parity -q -v --tb=short

# CI (GitHub Actions — see .github/workflows/ci.yml)
```

### Toggle the optimizer backend

The optimizer accepts `solver_backend=pulp|ortools`. Default `pulp` is parity-safe;
`ortools` is opt-in for speed. Toggle per-request from the React UI:

- Settings card → "Advanced" → "Solver backend" (in v1.1)

Or via API:
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

### Frontend (Netlify)

Production builds auto-deploy from the main branch. PR previews deploy automatically.

```bash
# Manual deploy
netlify deploy --prod --dir=frontend/react/dist
```

### Backend (Render)

Production deploys from `main`. Render runs the steps in `render.yaml`:
1. `pip install -r requirements.txt`
2. `python manage.py collectstatic --noinput`
3. `python manage.py migrate` (auto-run on every deploy)
4. `gunicorn config.wsgi:application --workers 4 --timeout 120`

### Rollback

```bash
# Frontend: Netlify Dashboard → Deploys → "Publish deploy" on a previous deploy
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
| `api/optimize` returns `optimizer_error` | Backend | Check logs for stack trace. Usually a constraint solver issue. |
| `import/csv` returns `import_failed` | Backend | Verify the CSV has expected headers (`Name`, `Position`, `Salary`, `Game Info`). Re-export from DraftKings. |
| Frontend 404 on `/nba` etc. | Frontend | Confirm `_redirects` rule in `netlify.toml` is `from=/* to=/index.html status=200`. |
| Parity test flakey | Backend | Solver noise. Re-run with explicit `seeds` in the request. |

## Capacity notes

| Item | Today | At scale |
|---|---|---|
| Render web dyno | 4 workers × 120s timeout | CPU-bound: optimize of a 150-player NBA Monte Carlo takes ~30s with 10k sims |
| Postgres | Starter (1 GB / 0.25 CU) | Upgrade to Standard when audit table > ~100k rows |
| Netlify | 100 GB bandwidth/mo | Fine until ~50k MAU |
| Solver throttling | 30/min/IP (`OptimizeThrottle`) | Adjust in `config/settings.py` if GTM requires higher |

## Incident contact

| Severity | Channel | Response |
|---|---|---|
| P0: optimizer returning wrong results | Slack #engineering-war-room | < 1h |
| P1: API 5xx | Slack #engineering | < 4h business |
| P2: cosmetic, parity drift | Linear backlog | < 1 week |
