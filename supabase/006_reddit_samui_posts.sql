-- ============================================================
-- Reddit Samui posts cache — daily fetch + AI “topic of the day”
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/sql
-- ============================================================

create table if not exists reddit_samui_posts (
  id             uuid primary key default gen_random_uuid(),
  reddit_id      text not null unique,
  title          text,
  content        text,
  url            text,
  author         text,
  upvotes        integer default 0,
  subreddit      text,
  posted_utc     timestamptz,
  created_at     timestamptz default now(),
  fetched_date   date,
  used           boolean default false,
  summary        text,
  best_answer    text
);

create index if not exists reddit_samui_posts_fetched_used_idx
  on reddit_samui_posts (fetched_date desc, used);

create index if not exists reddit_samui_posts_upvotes_idx
  on reddit_samui_posts (upvotes desc nulls last);

comment on table reddit_samui_posts is
  'Raw Reddit pulls + optional Sammi daily topic (summary/best_answer on selected row).';
