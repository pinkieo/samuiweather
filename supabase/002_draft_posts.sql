-- ============================================================
-- Sammi Draft Posts — Run in Supabase SQL Editor
-- https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/sql
-- ============================================================

create table if not exists draft_posts (
  id               bigint generated always as identity primary key,

  -- Content
  title            text        not null,
  body             text        not null,
  subreddit        text        not null default 'weathersamui',
  flair            text,

  -- Data sources used
  spire_snapshot   jsonb       default '{}',   -- precip, wind, temp at generation time
  radar_status     text,                        -- 'clear' | 'rain' | 'storm'

  -- Workflow flags
  is_data_optimized boolean    not null default false,  -- true = cleared for posting
  is_posted        boolean     not null default false,
  posted_at        timestamptz,
  reddit_post_id   text,                         -- filled after actual post

  -- Meta
  generated_by     text        default 'sammi-ai',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Auto-update updated_at
create trigger draft_posts_updated_at
  before update on draft_posts
  for each row execute function update_updated_at();

-- Index for workflow queries
create index if not exists draft_posts_workflow_idx
  on draft_posts (is_data_optimized, is_posted, created_at desc);
