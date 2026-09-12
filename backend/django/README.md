# Fantasy Grinder Django backend

Django 5 + DRF REST API for DFS lineup optimization. Replaces the Flutter app's
Supabase + inline compute with a self-hosted Python service.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Django 5 + DRF | Mature, batteries included |
| DB | Postgres 15 (Render) | Self-hosted, no vendor lock |
| Math | NumPy + SciPy | Cholesky, bipartite match |
| MILP (default) | PuLP + CBC | BSD-licensed, deterministic, parity-tested |
| MILP (opt-in) | Google OR-Tools CP-SAT | 5–10× faster, opt-in via `solver_backend=ortools` |
| File I/O | pandas + openpyxl + reportlab | CSV, XLSX, PDF parity with Flutter exports |
| Server | Gunicorn (4 sync workers, 120s timeout) | Sufficient for our MILP solve times |
| Async | Celery + Redis | Optional, for batch optimize >100 lineups |

## Local dev quickstart

```bash
# 1. Install
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. Database (Postgres)
createdb fantasy_grinder
cp .env.example .env  # then edit DATABASE_URL

# 3. Migrate
python manage.py migrate

# 4. Seed sample slates (NBA, MMA, Golf)
python manage.py load_sample_data

# 5. Run
python manage.py runserver 0.0.0.0:8000

# 6. OpenAPI
# Available at http://localhost:8000/api/schema/swagger-ui/
```

## URL map

| Path | Purpose |
|---|---|
| `/api/slates/` | List/create slates |
| `/api/slates/<uuid>/` | Slate detail (with players) |
| `/api/players/` | List players for active slate |
| `/api/import/csv/` | CSV roster import |
| `/api/import/excel/` | XLSX roster import |
| `/api/optimize/` | Generate lineups (the core endpoint) |
| `/api/export/csv/` | Lineup CSV export |
| `/api/export/excel/` | Lineup XLSX export |
| `/api/export/injury-pdf/` | NBA injury report PDF |
| `/api/feed/odds/` | Pull player props from The Odds API |
| `/api/feed/espn/` | Sync ESPN news/injury |
| `/api/schema/` | OpenAPI 3 schema |
| `/api/schema/swagger-ui/` | Swagger UI |
| `/admin/` | Django admin |

## Module layout

```
backend/django/
├── manage.py
├── requirements.txt
├── pytest.ini
├── config/                       # Django project settings
│   ├── settings.py               # base
│   ├── urls.py
│   ├── wsgi.py
│   ├── asgi.py
│   └── permissions.py            # IsAdminOrLocalhost
├── apps/
│   ├── common/                   # shared models, helpers, sample data
│   ├── nba/                      # NBA-specific endpoints, models, services
│   ├── mma/
│   └── golf/
├── optimizer/                    # pure-Python optimizer engine
│   ├── engines/
│   │   ├── milp_pulp.py
│   │   └── milp_ortools.py
│   ├── simulation/
│   │   ├── cholesky.py
│   │   └── monte_carlo.py
│   ├── sports/
│   │   ├── nba.py
│   │   ├── mma.py
│   │   └── golf.py
│   ├── strategies.py
│   ├── schema.py                 # dataclasses (sport-agnostic types)
│   └── run.py                    # CLI entrypoint
├── integrations/
│   ├── odds_api.py
│   ├── espn.py
│   └── injury_pdf.py
├── api/                          # DRF router + viewsets
│   ├── slates.py
│   ├── players.py
│   ├── optimize.py
│   ├── import_export.py
│   └── feeds.py
└── tests/                        # pytest
    ├── parity/
    │   ├── vectors/
    │   └── test_parity.py
    ├── engine/
    │   ├── test_milp_pulp.py
    │   ├── test_milp_ortools.py
    │   ├── test_cholesky.py
    │   └── test_strategies.py
    └── api/
        └── test_endpoints.py
```
