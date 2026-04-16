import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';

/** Stable URL for upsert — not shown to users as a permalink */
export const DAILY_DIGEST_URL = 'https://samui.internal/daily-digest';

export const DAILY_DIGEST_SOURCE = 'reddit_digest' as const;

export interface RedditPostForDigest {
  title: string;
  selftext?: string;
  permalink: string;
  score: number;
  subreddit: string;
}

const DIGEST_MODEL = 'gpt-4o-mini';
const MAX_POSTS = 35;
const EXCERPT = 400;

function buildCorpus(posts: RedditPostForDigest[]): string {
  const sorted = [...posts].sort((a, b) => b.score - a.score).slice(0, MAX_POSTS);
  const lines = sorted.map((p) => {
    const body = (p.selftext ?? '').replace(/\s+/g, ' ').slice(0, EXCERPT);
    return `[r/${p.subreddit}] ${p.title}\n${body}`;
  });
  let text = lines.join('\n\n---\n\n');
  const maxChars = 14_000;
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…';
  return text;
}

/**
 * LLM summary of recent Reddit activity + upsert into island_embeddings.
 * Excluded from match_island_info (see supabase/005_*.sql); Sammi loads this row explicitly.
 */
export async function upsertDailyCommunityDigest(
  supabase: SupabaseClient,
  openai: OpenAI,
  posts: RedditPostForDigest[],
): Promise<{ ok: boolean; error?: string }> {
  if (posts.length === 0) {
    return { ok: false, error: 'no_posts' };
  }

  const corpus = buildCorpus(posts);

  let digestText: string;
  try {
    const completion = await openai.chat.completions.create({
      model: DIGEST_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You summarize Reddit discussions about Koh Samui for a concierge AI. ' +
            'Output plain text only (no markdown headings with #). Be factual and neutral. ' +
            'Max ~450 words. Structure with short section labels in ALL CAPS on their own line ' +
            '(e.g. HOTELS & STAYS, AREAS & BEACHES, ANIMALS & STREET DOGS, TRANSPORT, WEATHER, MISC) ' +
            '— omit a section if unsupported by the posts. Do not invent venues or events. ' +
            'No Reddit URLs.',
        },
        {
          role: 'user',
          content: `Posts and excerpts:\n\n${corpus}`,
        },
      ],
      max_tokens: 900,
      temperature: 0.25,
    });
    digestText = completion.choices[0]?.message?.content?.trim() ?? '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'digest_llm_failed';
    return { ok: false, error: msg };
  }

  if (!digestText) {
    return { ok: false, error: 'empty_digest' };
  }

  const title = 'Daily community digest (r/kohsamui · r/weathersamui · r/samui)';
  const embRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: digestText.slice(0, 8000),
  });
  const embedding = embRes.data[0].embedding;

  const metadata = {
    kind: 'daily_digest' as const,
    post_sample_size: Math.min(posts.length, MAX_POSTS),
    generated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('island_embeddings')
    .select('id')
    .eq('url', DAILY_DIGEST_URL)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('island_embeddings')
      .update({
        source: DAILY_DIGEST_SOURCE,
        title,
        content: digestText,
        author: 'sammi-pipeline',
        score: 0,
        metadata,
        embedding,
      })
      .eq('url', DAILY_DIGEST_URL);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('island_embeddings').insert({
      source: DAILY_DIGEST_SOURCE,
      title,
      content: digestText,
      url: DAILY_DIGEST_URL,
      author: 'sammi-pipeline',
      score: 0,
      metadata,
      embedding,
    });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
