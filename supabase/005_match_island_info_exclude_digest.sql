-- Exclude daily digest rows from vector similarity search (digest is injected separately in chat).
-- Run in Supabase SQL Editor after deploying app code that writes source = 'reddit_digest'.

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
  where e.source is distinct from 'reddit_digest'
    and e.embedding is not null
    and (1 - (e.embedding <=> query_embedding)) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;
