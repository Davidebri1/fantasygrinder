-- Fantasy Grinder — Postgres schema (R1 / R4 deliverable)
-- Replaces the Supabase tables used by the Flutter app.
-- Target: Postgres 15+ on Render.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- slates: one row per DraftKings contest for a given sport
-- Mirrors the original supabase/public/slates table semantics:
--   sport, slate_date, slate_time, name, file_name, source_format, is_active
-- Plus an extension for app-side audit and a raw-blob column for the original CSV.
-- ───────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

create table if not exists public.slates (
  id              uuid primary key default gen_random_uuid(),
  sport           text not null check (sport in ('nba', 'mma', 'golf')),
  slate_date      date not null,
  slate_time      time not null,
  name            text not null,
  file_name       text,
  source_format   text not null default 'csv' check (source_format in ('csv', 'excel')),
  roster_blob     bytea,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists slates_sport_active_idx
  on public.slates (sport, is_active, slate_date, slate_time);

-- ───────────────────────────────────────────────────────────────────────────
-- nba_projection_rows: historical projections, "latest row per player wins"
-- Mirrors the original supabase/public/nba_projection_rows table.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.nba_projection_rows (
  id                 uuid primary key default gen_random_uuid(),
  slate_id           uuid references public.slates (id) on delete cascade,
  projection_date    date not null,
  player_id          text not null,
  name               text not null,
  projection         double precision not null,
  stddev             double precision,
  created_at         timestamptz not null default now()
);
create index if not exists nba_projection_rows_latest_idx
  on public.nba_projection_rows (projection_date, lower(name), created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- mma_projection_rows: same shape, MMA-keyed
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.mma_projection_rows (
  id                 uuid primary key default gen_random_uuid(),
  slate_id           uuid references public.slates (id) on delete cascade,
  projection_date    date not null,
  fighter_id         text not null,
  name               text not null,
  projection         double precision not null,
  stddev             double precision,
  bout               text,
  created_at         timestamptz not null default now()
);
create index if not exists mma_projection_rows_latest_idx
  on public.mma_projection_rows (projection_date, lower(name), created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- golf_projection_rows
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.golf_projection_rows (
  id                 uuid primary key default gen_random_uuid(),
  slate_id           uuid references public.slates (id) on delete cascade,
  projection_date    date not null,
  player_id          text not null,
  name               text not null,
  projection         double precision not null,
  stddev             double precision,
  tee_time           timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists golf_projection_rows_latest_idx
  on public.golf_projection_rows (projection_date, lower(name), created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- nba_injury_rows: ESPN-synced injuries per slate
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.nba_injury_rows (
  id                    uuid primary key default gen_random_uuid(),
  slate_id              uuid references public.slates (id) on delete cascade,
  player_id             text not null,
  name                  text not null,
  team                  text,
  status                text,
  severity              text,
  short_comment         text,
  long_comment          text,
  updated_at            timestamptz,
  raw_row               jsonb,
  ingested_at           timestamptz not null default now()
);
create index if not exists nba_injury_rows_slate_idx
  on public.nba_injury_rows (slate_id, lower(name));

-- ───────────────────────────────────────────────────────────────────────────
-- nba_news_rows: ESPN-synced news per slate
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.nba_news_rows (
  id                    uuid primary key default gen_random_uuid(),
  slate_id              uuid references public.slates (id) on delete cascade,
  player_id             text,
  title                 text,
  published             timestamptz,
  link                  text,
  raw_row               jsonb,
  ingested_at           timestamptz not null default now()
);
create index if not exists nba_news_rows_slate_idx
  on public.nba_news_rows (slate_id, published desc);

-- ───────────────────────────────────────────────────────────────────────────
-- optimization_runs: audit trail of every /api/optimize call
-- Helps debugging parity failures in production.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.optimization_runs (
  id                  uuid primary key default gen_random_uuid(),
  sport               text not null,
  solver_backend      text not null,
  strategy            text not null,
  request_settings    jsonb not null,
  result_count        integer not null,
  top_score           double precision,
  elapsed_ms          integer not null,
  warnings            jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists optimization_runs_sport_created_idx
  on public.optimization_runs (sport, created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- slate_state: per-slate user-editable state (locks, exclusions, exposures)
-- Replaces the Flutter app's local shared_preferences state files.
-- The original was per-device; we make it per-slate-with-cookie-token so it
-- survives across devices for the same anonymous session.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.slate_state (
  id                  uuid primary key default gen_random_uuid(),
  slate_id            uuid not null references public.slates (id) on delete cascade,
  session_token       text not null,
  payload             jsonb not null,
  updated_at          timestamptz not null default now(),
  unique (slate_id, session_token)
);

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- Migration helper: a one-shot Python script under
--   backend/django/manage.py import_from_supabase <dump.json>
-- reads the existing Supabase data dump (JSON or SQL export) and inserts rows
-- using the same shapes shown above. Run once on first deploy.
-- ───────────────────────────────────────────────────────────────────────────
