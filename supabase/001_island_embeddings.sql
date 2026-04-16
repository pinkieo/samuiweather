-- ============================================================
-- Sammi's Vector Brain — Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/uykedplxcgxlmvbgsale/sql
-- ============================================================

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Island knowledge table
create table if not exists island_embeddings (
  id          bigint generated always as identity primary key,
  source      text        not null default 'reddit',  -- 'reddit' | 'manual' | 'news'
  title       text,
  content     text        not null,
  url         text,
  author      text,
  score       int         default 0,
  metadata    jsonb       default '{}',
  embedding   vector(1536),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 3. Index for fast cosine-similarity search
create index if not exists island_embeddings_embedding_idx
  on island_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. RPC: cosine-similarity search (called from Next.js)
create or replace function match_island_info(
  query_embedding  vector(1536),
  match_count      int     default 5,
  match_threshold  float   default 0.65
)
returns table (
  id          bigint,
  source      text,
  title       text,
  content     text,
  url         text,
  author      text,
  score       int,
  metadata    jsonb,
  similarity  float
)
language plpgsql
as $$
begin
  return query
  select
    e.id,
    e.source,
    e.title,
    e.content,
    e.url,
    e.author,
    e.score,
    e.metadata,
    (1 - (e.embedding <=> query_embedding))::float as similarity
  from island_embeddings e
  where (1 - (e.embedding <=> query_embedding)) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 5. Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger island_embeddings_updated_at
  before update on island_embeddings
  for each row execute function update_updated_at();
