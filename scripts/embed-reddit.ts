#!/usr/bin/env npx tsx
/**
 * Sammi Embedding Pipeline
 * Fetches the latest r/kohsamui posts, creates OpenAI embeddings,
 * and upserts them into Supabase island_embeddings.
 *
 * Usage:
 *   npx tsx scripts/embed-reddit.ts
 *
 * Requires in .env.local:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local from project root
config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL            = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY          = process.env.OPENAI_API_KEY!;
const REDDIT_LIMIT  = 100;   // max per request
const REDDIT_PAGES  = 5;     // pages per feed = up to 500 posts per feed
const SUBREDDITS    = ['kohsamui', 'weathersamui'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error('❌  Missing env vars. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai   = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Reddit fetch ──────────────────────────────────────────────────────────────

interface RedditChild {
  data: {
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    author: string;
    score: number;
    num_comments: number;
    created_utc: number;
    link_flair_text?: string;
  };
}

async function fetchFeed(
  subreddit: string,
  sort: string,
  params: string = '',
): Promise<RedditChild['data'][]> {
  const posts: RedditChild['data'][] = [];
  let after = '';

  for (let page = 0; page < REDDIT_PAGES; page++) {
    const url =
      `https://www.reddit.com/r/${subreddit}/${sort}.json` +
      `?limit=${REDDIT_LIMIT}${params}${after ? `&after=${after}` : ''}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'SamuiConcierge/1.0 (contact: samui@weather.app)' },
    });
    if (!res.ok) { console.warn(`  r/${subreddit} ${sort} p${page+1} failed (${res.status})`); break; }

    const json = await res.json() as {
      data: { children: RedditChild[]; after: string | null };
    };

    const batch = json.data.children.map(c => c.data);
    posts.push(...batch);
    console.log(`    r/${subreddit} ${sort}${params} page ${page + 1}: ${batch.length} posts`);

    if (!json.data.after || batch.length < REDDIT_LIMIT) break;
    after = json.data.after;

    await new Promise(r => setTimeout(r, 500));
  }

  return posts;
}

async function fetchRedditPosts(): Promise<RedditChild['data'][]> {
  const feeds = SUBREDDITS.flatMap(sub => [
    fetchFeed(sub, 'new'),
    fetchFeed(sub, 'hot'),
    fetchFeed(sub, 'top', '&t=month'),
    fetchFeed(sub, 'top', '&t=year'),
  ]);

  const results = await Promise.all(feeds);
  const allPosts = results.flat();

  // Deduplicate by permalink
  const seen = new Set<string>();
  return allPosts.filter(p => {
    if (seen.has(p.permalink)) return false;
    seen.add(p.permalink);
    return true;
  });
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',   // 1536 dims, fast & cheap
    input: text,
  });
  return res.data[0].embedding;
}

// ── Upsert to Supabase ────────────────────────────────────────────────────────

async function upsertPost(post: RedditChild['data']): Promise<void> {
  const content = [
    post.title,
    post.selftext?.slice(0, 1000) ?? '',
  ].filter(Boolean).join('\n\n');

  const embedding = await embedText(content);

  const postUrl = `https://reddit.com${post.permalink}`;

  // Skip if already stored
  const { data: existing } = await supabase
    .from('island_embeddings')
    .select('id')
    .eq('url', postUrl)
    .maybeSingle();

  if (existing) {
    // Update embedding + score in case content changed
    const { error } = await supabase
      .from('island_embeddings')
      .update({ embedding, score: post.score, content })
      .eq('url', postUrl);
    if (error) console.error(`  ✗ update ${post.title.slice(0, 60)} — ${error.message}`);
    else console.log(`  ↻ ${post.title.slice(0, 60)}`);
    return;
  }

  const { error } = await supabase
    .from('island_embeddings')
    .insert({
      source:   'reddit',
      title:    post.title,
      content,
      url:      postUrl,
      author:   post.author,
      score:    post.score,
      metadata: {
        num_comments: post.num_comments,
        created_utc:  post.created_utc,
        flair:        post.link_flair_text ?? null,
      },
      embedding,
    });

  if (error) {
    console.error(`  ✗ ${post.title.slice(0, 60)}  —  ${error.message}`);
  } else {
    console.log(`  ✓ ${post.title.slice(0, 60)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏝️  Sammi Embedding Pipeline starting…\n');

  console.log('📡  Fetching Reddit posts…');
  const posts = await fetchRedditPosts();
  console.log(`    ${posts.length} posts found\n`);

  console.log('🧠  Embedding and upserting to Supabase…');
  for (const post of posts) {
    await upsertPost(post);
    // Small delay to stay within OpenAI rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n✅  Done! Sammi\'s brain has been updated.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
