-- Samui radar-cell archive and nowcast provenance.
--
-- There is no 30-day radar deleter in this repository, in vercel.json, or in
-- the cron-job.org setup scripts. RainViewer weather-maps.json only lists
-- about 2 hours of past frames. This table is the archive that can hold a
-- full Northeast-monsoon season.
--
-- Retention is 180 days (about October–February, plus margin). The purge
-- function refuses a shorter window, so it cannot be put back to 30 days by
-- passing a smaller argument.
--
-- Do not apply this file to production as part of the preview. The ingest
-- logs and continues when the tables are absent.

create table if not exists public.samui_radar_archive (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  frame_time_utc timestamptz not null,
  kind text not null,
  cells jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists samui_radar_archive_frame_idx
  on public.samui_radar_archive (location_id, frame_time_utc desc);

comment on table public.samui_radar_archive is
  'RainViewer cells sampled for Koh Samui. Kept 180 days so one NE-monsoon season survives. Not radar image bytes.';

create table if not exists public.samui_nowcast_run (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  ran_at_utc timestamptz not null,
  state text not null,
  reason text not null,
  radar_time_utc timestamptz null,
  eta_source text null,
  eta_earliest_utc timestamptz null,
  eta_latest_utc timestamptz null,
  provenance jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists samui_nowcast_run_ran_idx
  on public.samui_nowcast_run (location_id, ran_at_utc desc);

comment on table public.samui_nowcast_run is
  'One nowcast decision per ingest: radar time, cells, ETA window, original vs published probability. Kept 180 days.';

create or replace function public.purge_samui_radar_archive(p_retention_days integer default 180)
returns void
language plpgsql
as $$
declare
  days integer := greatest(coalesce(p_retention_days, 180), 180);
begin
  delete from public.samui_radar_archive
  where frame_time_utc < now() - make_interval(days => days);
  delete from public.samui_nowcast_run
  where ran_at_utc < now() - make_interval(days => days);
end;
$$;

comment on function public.purge_samui_radar_archive(integer) is
  'Delete Samui radar archive and nowcast rows older than max(argument, 180) days.';

alter table public.samui_radar_archive enable row level security;
alter table public.samui_nowcast_run enable row level security;
