import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export interface WebcamEntry {
  id: number;
  name: string;
  region: 'east' | 'west' | 'north' | 'south' | 'central';
  url: string;
  description: string;
}

export interface WebcamsResponse {
  cams: WebcamEntry[];
  featured: {
    cam: WebcamEntry | null;
    postTitle: string | null;
    postScore: number | null;
    postId: string | null;
  };
}

export async function GET() {
  try {
    const db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch all active webcams
    const { data: cams, error: camErr } = await db
      .from('public_webcams')
      .select('id, name, region, url, description')
      .eq('is_active', true)
      .order('region');

    if (camErr) throw new Error(camErr.message);

    // Fetch latest draft post that has a webcam attached
    const { data: posts } = await db
      .from('draft_posts')
      .select('id, title, webcam_url, webcam_name, reality_check_score')
      .not('webcam_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    const latestPost = posts?.[0] ?? null;
    const featuredCam = latestPost
      ? (cams ?? []).find((c: WebcamEntry) => c.url === latestPost.webcam_url) ??
        // Fallback: reconstruct from draft_post columns if not in active list
        (latestPost.webcam_url
          ? {
              id: -1,
              name:        latestPost.webcam_name ?? 'Featured Cam',
              region:      'central' as const,
              url:         latestPost.webcam_url,
              description: `Featured in Sammi's last post: "${latestPost.title}"`,
            }
          : null)
      : null;

    const response: WebcamsResponse = {
      cams: (cams ?? []) as WebcamEntry[],
      featured: {
        cam:       featuredCam ?? null,
        postTitle: latestPost?.title ?? null,
        postScore: latestPost?.reality_check_score ?? null,
        postId:    latestPost?.id ?? null,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
