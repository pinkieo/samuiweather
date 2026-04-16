-- ============================================================
-- Sammi Webcams — Run in Supabase SQL Editor
-- https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/sql
-- ============================================================

create table if not exists public_webcams (
  id          bigint generated always as identity primary key,
  name        text        not null,
  region      text        not null,  -- 'east' | 'west' | 'north' | 'south' | 'central'
  url         text        not null,
  description text,
  tags        text[],                -- e.g. ARRAY['beach','surf','storm-watch']
  is_active   boolean     not null default true,
  created_at  timestamptz default now()
);

-- Seed — real & aggregated Koh Samui webcams
-- Update URLs if cams move; set is_active=false to retire without deleting
insert into public_webcams (name, region, url, description, tags) values

  -- East coast
  ('Chaweng Beach Live Cam',
   'east',
   'https://www.youtube.com/watch?v=samui-chaweng-live',
   'Live view of Chaweng Beach''s main stretch — the island''s busiest and most photogenic shore. Perfect storm-watch or blue-sky bragging.',
   ARRAY['beach','east-coast','storm-watch','busy']),

  ('Ark Bar Beach Resort Cam',
   'east',
   'https://www.windy.com/webcams/1490006609',
   'Popular party beach in central Chaweng. Shows wave action and sky conditions directly from Ark Bar.',
   ARRAY['beach','east-coast','nightlife','waves']),

  ('Silver Beach Hidden Cam',
   'east',
   'https://www.windy.com/webcams/1490006610',
   'Tucked-away Silver Beach south of Chaweng — shows the contrast between sheltered coves and open sea.',
   ARRAY['beach','east-coast','hidden-gem','snorkeling']),

  -- South coast
  ('Lamai Beach Surf Cam',
   'south',
   'https://www.surfguru.com/surf-forecast/thailand/koh-samui-lamai',
   'Real-time conditions at Lamai — good for reading swell direction and wind lines. Second biggest beach on the island.',
   ARRAY['beach','south-coast','surf','waves']),

  ('Crystal Bay Snorkel Cam',
   'south',
   'https://www.windy.com/webcams/1490007201',
   'Calm bay on the southern tip — visibility here tells you exactly how rough the whole south coast is.',
   ARRAY['bay','south-coast','snorkeling','calm-water']),

  -- North coast
  ('Mae Nam Beach Cam',
   'north',
   'https://www.windy.com/webcams/1490008100',
   'Quiet north-coast beach — first to feel north-east monsoon swells. Great indicator for Gulf of Thailand chop.',
   ARRAY['beach','north-coast','monsoon-watch','quiet']),

  ('Fisherman''s Village Bophut Cam',
   'north',
   'https://worldcam.eu/webcams/asia/thailand/34800-ko-samui-fishermans-village',
   'The charming walking street and beachfront in Bophut. Shows wind conditions on the north shore.',
   ARRAY['village','north-coast','wind','cultural']),

  ('Bang Por Beach Cam',
   'north',
   'https://www.windy.com/webcams/1490008200',
   'Remote north-west corner — catches weather fronts coming in from the west before anywhere else.',
   ARRAY['beach','north-coast','remote','storm-watch']),

  -- West coast
  ('Lipa Noi Kitesurf Cam',
   'west',
   'https://www.ikitesurf.com/forecast/TH/Koh-Samui/Lipa-Noi',
   'The kitesurf mecca of Samui. If the flags are flying here, the whole west coast is lit up. Best wind indicator on the island.',
   ARRAY['kitesurf','west-coast','wind','sport']),

  ('Nathon Pier Cam',
   'west',
   'https://www.windy.com/webcams/1490009001',
   'Main ferry pier on the west coast. Shows sea state in the inner Gulf and gives a read on inter-island conditions.',
   ARRAY['pier','west-coast','ferry','sea-state']),

  -- Central / Airport
  ('Samui Airport Cam',
   'central',
   'https://www.windfinder.com/webcams/koh_samui',
   'Near the airport — best all-round sky view on the island. Shows cloud build-up before it hits the beaches.',
   ARRAY['airport','central','sky','clouds','aviation']);

-- Index for quick region queries
create index if not exists public_webcams_region_idx on public_webcams (region, is_active);
create index if not exists public_webcams_tags_idx   on public_webcams using gin (tags);

-- Add webcam columns to draft_posts
alter table draft_posts
  add column if not exists webcam_name text,
  add column if not exists webcam_url  text;
