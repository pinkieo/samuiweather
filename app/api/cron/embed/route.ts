import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — enough for 100 posts

// Subreddits to sync (per architecture doc)
const SUBREDDITS = ['kohsamui', 'weathersamui'];
const LIMIT      = 100;

// ── Auth guard ────────────────────────────────────────────────────────────────
// Call with: Authorization: Bearer <CRON_SECRET>
// Or from Vercel Cron: automatically adds the header.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode — no secret set
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ── Reddit fetch ──────────────────────────────────────────────────────────────

interface RedditPost {
  title: string; selftext: string; url: string;
  permalink: string; author: string; score: number;
  num_comments: number; created_utc: number; link_flair_text?: string;
}

async function fetchFeed(sub: string, sort: string, t = ''): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${LIMIT}${t ? `&t=${t}` : ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SamuiConcierge/1.0' } });
  if (!res.ok) return [];
  const json = await res.json() as { data: { children: { data: RedditPost }[] } };
  return json.data.children.map(c => c.data);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  // Fetch all feeds in parallel
  const fetches = SUBREDDITS.flatMap(sub => [
    fetchFeed(sub, 'new'),
    fetchFeed(sub, 'hot'),
    fetchFeed(sub, 'top', 'week'),
  ]);
  const batches = await Promise.all(fetches);
  const allPosts = batches.flat();

  // Deduplicate
  const seen = new Set<string>();
  const posts = allPosts.filter(p => {
    if (seen.has(p.permalink)) return false;
    seen.add(p.permalink);
    return true;
  });

  stats.fetched = posts.length;

  for (const post of posts) {
    try {
      const content = [post.title, post.selftext?.slice(0, 800)].filter(Boolean).join('\n\n');
      const postUrl = `https://reddit.com${post.permalink}`;

      // Check existing
      const { data: existing } = await supabase
        .from('island_embeddings')
        .select('id, score')
        .eq('url', postUrl)
        .maybeSingle();

      // Skip if score unchanged (no new content)
      if (existing && existing.score === post.score) {
        stats.skipped++;
        continue;
      }

      // Embed
      const embRes = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: content,
      });
      const embedding = embRes.data[0].embedding;

      if (existing) {
        await supabase.from('island_embeddings')
          .update({ embedding, score: post.score, content })
          .eq('url', postUrl);
        stats.updated++;
      } else {
        await supabase.from('island_embeddings').insert({
          source: 'reddit', title: post.title, content,
          url: postUrl, author: post.author, score: post.score,
          metadata: { num_comments: post.num_comments, created_utc: post.created_utc, flair: post.link_flair_text ?? null },
          embedding,
        });
        stats.inserted++;
      }

      await new Promise(r => setTimeout(r, 150)); // rate limit buffer
    } catch (err) {
      console.error('[cron/embed]', post.title.slice(0, 40), err);
      stats.errors++;
    }
  }

  console.log('[cron/embed] done', stats);
  return NextResponse.json({ ok: true, stats });
}

// Allow Vercel Cron to call via GET as well
export async function GET(req: NextRequest) {
  return POST(req);
}
