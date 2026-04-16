-- ============================================================
-- Sammi Analytics — Run in Supabase SQL Editor
-- https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/sql
-- ============================================================

-- Hourly weather snapshots (actual conditions, logged by /api/cron/log-weather)
create table if not exists weather_log (
  id           uuid        default gen_random_uuid() primary key,
  logged_at    timestamptz default now(),

  -- SPIRE actuals
  temp         numeric,
  feels_like   numeric,
  wind_speed   numeric,
  wind_dir     numeric,
  wind_gust    numeric,
  precip_rate  numeric,
  pop          numeric,
  humidity     numeric,
  uv_index     numeric,
  cloud_cover  numeric,
  radar_status text,       -- 'clear' | 'light_rain' | 'rain' | 'storm'
  valid_time   timestamptz
);

create index if not exists weather_log_logged_at_idx
  on weather_log (logged_at desc);

-- Add reality-check columns to draft_posts
alter table draft_posts
  add column if not exists reality_check       text,
  add column if not exists reality_check_score numeric,
  add column if not exists reality_check_at    timestamptz;
