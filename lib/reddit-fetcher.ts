/**
 * Daily Reddit fetch → `reddit_samui_posts` (no embeddings).
 * Subreddits default to the same island set as `scripts/embed-reddit.ts`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_SUBREDDITS = ['kohsamui', 'weathersamui', 'samui'] as const;

const USER_AGENT = 'SamuiConcierge/1.1 (reddit-fetcher; contact: samui@weather.app)';

export type RedditFetchRow = {
  reddit_id: string;
  title: string;
  content: string | null;
  url: string;
  author: string;
  upvotes: number;
  subreddit: string;
  posted_utc: string | null;
  fetched_date: string;
};

type RedditChildData = {
  id: string;
  name: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  author: string;
  score: number;
  created_utc: number;
};

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, key);
}

async function fetchSubredditNew(
  subreddit: string,
  limit: number,
): Promise<RedditChildData[]> {
  const u = new URL(`https://www.reddit.com/r/${subreddit}/new.json`);
  u.searchParams.set('limit', String(Math.min(limit, 100)));
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`[reddit-fetcher] r/${subreddit} HTTP ${res.status}`);
    return [];
  }
  const json = (await res.json()) as {
    data?: { children?: { data: RedditChildData }[] };
  };
  const children = json.data?.children ?? [];
  return children.map((c) => c.data);
}

/**
 * Pull /new for each sub, upsert into `reddit_samui_posts`.
 * `reddit_id` = Reddit fullname (`t3_…`) for stable upserts.
 */
export async function fetchDailySamuiTopics(options?: {
  subreddits?: readonly string[];
  limitPerSub?: number;
  supabase?: SupabaseClient;
}): Promise<{ count: number; subreddits: string[]; error?: string }> {
  const subs = options?.subreddits?.length
    ? [...options.subreddits]
    : [...DEFAULT_SUBREDDITS];
  const limitPerSub = options?.limitPerSub ?? 20;
  const supabase = options?.supabase ?? createServiceClient();
  const fetchedDate = todayUtcDate();

  const rows: RedditFetchRow[] = [];

  for (const sub of subs) {
    const posts = await fetchSubredditNew(sub, limitPerSub);
    for (const d of posts) {
      const permalink = d.permalink.startsWith('/') ? d.permalink : `/${d.permalink}`;
      rows.push({
        reddit_id: d.name,
        title: d.title,
        content: d.selftext?.trim() ? d.selftext : null,
        url: `https://www.reddit.com${permalink}`,
        author: d.author ?? '[deleted]',
        upvotes: typeof d.score === 'number' ? d.score : 0,
        subreddit: sub,
        posted_utc: new Date(d.created_utc * 1000).toISOString(),
        fetched_date: fetchedDate,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (rows.length === 0) {
    return { count: 0, subreddits: subs };
  }

  const ids = rows.map((r) => r.reddit_id);
  const { data: existing } = await supabase
    .from('reddit_samui_posts')
    .select('reddit_id, used, summary, best_answer')
    .in('reddit_id', ids);

  const prev = new Map(
    (existing ?? []).map((e) => [
      e.reddit_id as string,
      e as { used?: boolean; summary?: string | null; best_answer?: string | null },
    ]),
  );

  const { error } = await supabase.from('reddit_samui_posts').upsert(
    rows.map((r) => {
      const old = prev.get(r.reddit_id);
      return {
        reddit_id: r.reddit_id,
        title: r.title,
        content: r.content,
        url: r.url,
        author: r.author,
        upvotes: r.upvotes,
        subreddit: r.subreddit,
        posted_utc: r.posted_utc,
        fetched_date: r.fetched_date,
        used: old?.used ?? false,
        summary: old?.summary ?? null,
        best_answer: old?.best_answer ?? null,
      };
    }),
    { onConflict: 'reddit_id' },
  );

  if (error) {
    console.error('[reddit-fetcher]', error.message);
    return { count: 0, subreddits: subs, error: error.message };
  }

  console.log(`[reddit-fetcher] upserted ${rows.length} rows`);
  return { count: rows.length, subreddits: subs };
}
