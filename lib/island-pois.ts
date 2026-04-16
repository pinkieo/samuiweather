/** Named Koh Samui venues for map POIs, Sammi flyTo, and Intelligence Cards. */

export type PoiKind = 'restaurant' | 'beach_club';

export interface IslandPoi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: PoiKind;
  /** Ambience / crowd profile */
  atmosphere: string;
  /** Tactical parking / access */
  parkingAdvice: string;
  /** Match user chat + Sammi JSON `mapFlyTo` */
  aliases: string[];
}

export const ISLAND_POIS: IslandPoi[] = [
  {
    id: 'carnival_beach_club',
    name: 'Carnival Beach Club',
    lat: 9.5746,
    lon: 100.0764,
    kind: 'beach_club',
    atmosphere:
      'Upscale beach-club energy in Choeng Mon — sunbeds, DJ-forward afternoons, family-friendly water (shallow for a long stretch).',
    parkingAdvice:
      'Use the small lot off Choeng Mon beach road near the club entrance; at peak hours grab any parallel spot on the main road and walk 2 minutes — turning circles are tight for cars.',
    aliases: [
      'carnival',
      'carnival beach',
      'choeng mon carnival',
      'carnival beach club',
    ],
  },
  {
    id: 'fishermans_village',
    name: "Fisherman's Village",
    lat: 9.5314,
    lon: 100.0782,
    kind: 'restaurant',
    atmosphere:
      'Bophut’s shophouse strip — boutique dining, cocktail bars, and the Walking Street market vibe (nights).',
    parkingAdvice:
      'Avoid the south main gate after 18:30 — park near The Wharf (north) or east-side streets and walk in.',
    aliases: [
      'fishermans village',
      "fisherman's village",
      'fisherman village',
      'bophut village',
      'bophut',
    ],
  },
  {
    id: 'ark_bar',
    name: 'Ark Bar',
    lat: 9.5128,
    lon: 100.0646,
    kind: 'beach_club',
    atmosphere:
      'Chaweng’s headline beach party — fire shows, high tempo, central sand.',
    parkingAdvice:
      'Central Chaweng parking fills fast — use Central Samui or side sois east of the beach road, not the beachfront lane.',
    aliases: ['ark bar', 'arkbar', 'chaweng beach club'],
  },
  {
    id: 'coco_tams',
    name: "Coco Tam's",
    lat: 9.5321,
    lon: 100.0776,
    kind: 'beach_club',
    atmosphere:
      'Bophut beach swings and sunset drinks — relaxed, Instagram-class silhouettes.',
    parkingAdvice:
      'Same playbook as Fisherman’s: Wharf-side or east approach; skip the congested village entrance.',
    aliases: ['coco tams', 'cocotams', 'coco tam'],
  },
  {
    id: 'dining_on_the_rocks',
    name: 'Dining on the Rocks',
    lat: 9.4639,
    lon: 100.0612,
    kind: 'restaurant',
    atmosphere:
      'Six Senses edge-deck fine dining — low light, high ticket, special-occasion calm.',
    parkingAdvice:
      'Valet at Six Senses reception — the access road is steep; don’t leave scooters halfway on the bend.',
    aliases: ['dining on the rocks', 'six senses dining', 'six senses restaurant'],
  },
];

const byId = new Map(ISLAND_POIS.map(p => [p.id, p]));

export function getPoiById(id: string): IslandPoi | undefined {
  return byId.get(id);
}

/** IDs allowed in Sammi `mapFlyTo` JSON */
export const MAP_FLY_TO_IDS = ISLAND_POIS.map(p => p.id);
