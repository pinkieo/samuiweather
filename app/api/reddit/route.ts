import { NextResponse } from 'next/server';

export const revalidate = 3600;

export interface RedditPost {
  title: string;
  url: string;
  permalink: string;
  score: number;
  num_comments: number;
  created_utc: number;
  author: string;
}

export interface SammiResponse {
  posts: RedditPost[];
  sammiSays: string;
  sammiMood: 'positive' | 'cautious' | 'alert' | 'neutral';
}

// ─── Keyword-based Sammi persona ─────────────────────────────────────────────

const ALERT_KEYWORDS = [
  'warning', 'danger', 'scam', 'robbery', 'theft', 'stolen', 'avoid',
  'sick', 'hospital', 'jellyfish', 'accident', 'emergency', 'sting',
];
const BEACH_KEYWORDS = [
  'beach', 'swim', 'snorkel', 'dive', 'surf', 'water', 'sea', 'ocean',
  'wave', 'tide', 'coral', 'kayak', 'longtail',
];
const FOOD_KEYWORDS = [
  'restaurant', 'food', 'eat', 'dinner', 'lunch', 'brunch', 'cafe',
  'bar', 'cocktail', 'seafood', 'night market', 'street food',
];
const EVENT_KEYWORDS = [
  'event', 'festival', 'party', 'concert', 'songkran', 'market',
  'show', 'performance', 'celebration',
];
const RAIN_KEYWORDS = [
  'rain', 'storm', 'flood', 'wet', 'thunder', 'lightning', 'typhoon',
  'monsoon', 'weather',
];

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function buildSammiSays(posts: RedditPost[]): { text: string; mood: SammiResponse['sammiMood'] } {
  const allTitles = posts.map((p) => p.title).join(' ');

  if (matchesAny(allTitles, ALERT_KEYWORDS)) {
    const alert = posts.find((p) => matchesAny(p.title, ALERT_KEYWORDS));
    return {
      mood: 'alert',
      text: `Darling, a heads-up: the community is flagging something worth your attention — "${alert?.title ?? 'see below'}". Stay switched on and enjoy Samui safely.`,
    };
  }

  if (matchesAny(allTitles, RAIN_KEYWORDS)) {
    return {
      mood: 'cautious',
      text: `Locals are chatting about the weather. Pack that tiny umbrella — Samui showers are warm and short, and the rainbows afterwards are spectacular.`,
    };
  }

  if (matchesAny(allTitles, EVENT_KEYWORDS)) {
    const event = posts.find((p) => matchesAny(p.title, EVENT_KEYWORDS));
    return {
      mood: 'positive',
      text: `Something's happening on the island! "${event?.title ?? 'Check below'}" — I'd recommend going. Samui locals know how to throw a proper party.`,
    };
  }

  if (matchesAny(allTitles, FOOD_KEYWORDS)) {
    return {
      mood: 'positive',
      text: `The community is talking food — always a good sign. Tonight I'd steer you toward the night market end of Fisherman's Village. Trust me on this one.`,
    };
  }

  if (matchesAny(allTitles, BEACH_KEYWORDS)) {
    return {
      mood: 'positive',
      text: `Beach buzz is high today. Crystal Bay and Silver Beach are your quieter alternatives to Chaweng if you prefer your toes in the sand without the selfie sticks.`,
    };
  }

  return {
    mood: 'neutral',
    text: `${posts.length} fresh posts from the community. Nothing alarming — Samui is in fine form today. Enjoy the island, darling.`,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      'https://www.reddit.com/r/kohsamui/new.json?limit=5',
      {
        signal: controller.signal,
        headers: {
          // Reddit blocks the default Node.js user agent
          'User-Agent': 'SamuiWeatherDashboard/1.0 (samui-dashboard; contact: samui@weather.app)',
          Accept: 'application/json',
        },
        next: { revalidate: 300 }, // cache 5 minutes
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Reddit API ${res.status}`);
    }

    const json = await res.json() as {
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    };

    const children = json?.data?.children ?? [];
    const posts: RedditPost[] = children.slice(0, 5).map((child) => {
      const d = child.data;
      return {
        title: String(d.title ?? ''),
        url: String(d.url ?? ''),
        permalink: `https://reddit.com${String(d.permalink ?? '')}`,
        score: Number(d.score ?? 0),
        num_comments: Number(d.num_comments ?? 0),
        created_utc: Number(d.created_utc ?? 0),
        author: String(d.author ?? ''),
      };
    });

    const { text: sammiSays, mood: sammiMood } = buildSammiSays(posts);

    return NextResponse.json({ posts, sammiSays, sammiMood } satisfies SammiResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
