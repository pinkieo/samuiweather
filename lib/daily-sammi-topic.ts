/**
 * AI selector: pick the best unused Reddit topic → natural Q + Sammi answer (with weather).
 * Uses OpenAI (same stack as Sammi). Optional xAI: set OPENAI_BASE_URL + model via env if desired.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getSamuiForecastMerged, formatTempC, formatWindMs, type SamuiWeatherForecastRow } from './spire';

export type RedditSamuiPost = {
  id: string;
  reddit_id: string;
  title: string | null;
  content: string | null;
  url: string | null;
  author: string | null;
  upvotes: number | null;
  subreddit: string | null;
  fetched_date: string | null;
  used: boolean | null;
};

export type DailySammiTopicResult = {
  ok: boolean;
  error?: string;
  chosenRedditId?: string;
  question?: string;
  answer?: string;
  summary?: string;
};

function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key);
}

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY required');
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  return new OpenAI(baseURL ? { apiKey: key, baseURL } : { apiKey: key });
}

function formatWeatherBlock(row: SamuiWeatherForecastRow | null): string {
  if (!row) return 'SPIRE forecast unavailable.';
  const pc = row.precipRate > 0.05 ? `${row.precipRate.toFixed(2)} mm/h` : 'dry strip';
  return [
    `Nowcast-ish hour: ${row.time}`,
    `${formatTempC(row.temp)}°C · feels ${formatTempC(row.feelsLike)}°C`,
    `Wind ${formatWindMs(row.windSpeed)} m/s · precip ${pc}`,
    `Cloud (display) ${row.cloudCover.toFixed(0)}%`,
  ].join('\n');
}

type AiPickJson = {
  chosen_reddit_id: string;
  question: string;
  answer: string;
  summary: string;
};

function parseJsonObject(raw: string): AiPickJson | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    const chosen = o.chosen_reddit_id ?? o.chosenRedditId;
    if (
      typeof chosen !== 'string' ||
      typeof o.question !== 'string' ||
      typeof o.answer !== 'string' ||
      typeof o.summary !== 'string'
    ) {
      return null;
    }
    return {
      chosen_reddit_id: chosen,
      question: o.question,
      answer: o.answer,
      summary: o.summary,
    };
  } catch {
    return null;
  }
}

/**
 * Loads unused posts (recent), asks the model to pick one and write Q+A, stores result on that row.
 */
export async function generateDailySammiTopic(options?: {
  supabase?: SupabaseClient;
  openai?: OpenAI;
  forecastRows?: SamuiWeatherForecastRow[] | null;
  limitCandidates?: number;
}): Promise<DailySammiTopicResult> {
  const supabase = options?.supabase ?? createServiceClient();
  const openai = options?.openai ?? getOpenAI();

  const { data: posts, error: qErr } = await supabase
    .from('reddit_samui_posts')
    .select(
      'id, reddit_id, title, content, url, author, upvotes, subreddit, fetched_date, used',
    )
    .eq('used', false)
    .order('upvotes', { ascending: false, nullsFirst: false })
    .limit(options?.limitCandidates ?? 15);

  if (qErr) {
    return { ok: false, error: qErr.message };
  }
  const list = (posts ?? []) as RedditSamuiPost[];
  if (list.length === 0) {
    return { ok: false, error: 'No unused reddit_samui_posts — run reddit fetcher first.' };
  }

  let rows = options?.forecastRows;
  if (!rows || rows.length === 0) {
    try {
      rows = await getSamuiForecastMerged();
    } catch {
      rows = null;
    }
  }
  const weatherBlock = formatWeatherBlock(rows?.[0] ?? null);

  const catalog = list
    .map(
      (p) =>
        `reddit_id: ${p.reddit_id}\ntitle: ${p.title ?? ''}\nurl: ${p.url ?? ''}\n excerpt: ${(p.content ?? '').slice(0, 500)}`,
    )
    .join('\n\n---\n\n');

  const systemPrompt = `You are the planner for Sammi — Koh Samui island concierge (sharp, evidence-based, dry wit). Your job is:
1) Pick the single most useful or entertaining thread for tourists from the list.
2) Rewrite it as a short natural question a guest might ask Sammi.
3) Write Sammi's best answer: practical, specific to Samui, 3–6 sentences unless urgency needs more.
4) Weave in the SPIRE/weather block when relevant (rain, wind, heat) — do not invent numbers outside that block.

Output ONLY valid JSON with keys: chosen_reddit_id (exact reddit_id from list), question, answer, summary (one line).
`;

  const model = process.env.OPENAI_DAILY_TOPIC_MODEL?.trim() || 'gpt-4o-mini';

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.75,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `WEATHER CHECK (SPIRE, use as ground truth for "now"):\n${weatherBlock}\n\nCANDIDATE POSTS:\n${catalog}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return { ok: false, error: 'Model did not return valid JSON.' };
  }

  const chosen = list.find((p) => p.reddit_id === parsed.chosen_reddit_id);
  if (!chosen) {
    return {
      ok: false,
      error: `Model chose unknown reddit_id: ${parsed.chosen_reddit_id}`,
    };
  }

  const { error: upErr } = await supabase
    .from('reddit_samui_posts')
    .update({
      used: true,
      summary: parsed.summary,
      best_answer: parsed.answer,
    })
    .eq('reddit_id', chosen.reddit_id);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  return {
    ok: true,
    chosenRedditId: chosen.reddit_id,
    question: parsed.question,
    answer: parsed.answer,
    summary: parsed.summary,
  };
}
