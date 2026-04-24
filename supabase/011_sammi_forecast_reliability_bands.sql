-- Patch: Sammi reliability bands 48h / 120h (was 48h / 168h) + kans_*_sammi + bilingual hints
-- Run if you already applied 010 before this change; otherwise 010 is enough.

CREATE OR REPLACE VIEW public.sammi_forecast AS
SELECT
  s.location_id,
  s.issuance_time_utc,
  s.valid_time_utc,
  s.valid_time_ict,
  s.temperature_c,
  s.kans_regen_pct,
  s.kans_onweer_pct,
  s.kans_mist_pct,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_regen_pct END AS kans_regen_pct_sammi,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_onweer_pct END AS kans_onweer_pct_sammi,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_mist_pct END AS kans_mist_pct_sammi,
  s.cape,
  s.resolution,
  s.reliability,
  CASE
    WHEN s.reliability = 'laag' AND COALESCE(s.cape, 0) > 2000 THEN
      'Mid-week PM convection trend — showers possible, especially around midday'
    WHEN s.reliability = 'laag' THEN
      'Further out: qualitative trend only (no hard %)'
    WHEN COALESCE(s.kans_onweer_pct, 0) > 30 OR COALESCE(s.cape, 0) > 2000 THEN
      'Thunder possible — stay alert'
    WHEN COALESCE(s.kans_regen_pct, 0) > 40 THEN
      'Shower chance, especially in the afternoon'
    WHEN COALESCE(s.kans_mist_pct, 0) > 20 THEN
      'Fog possible'
    ELSE
      'Good beach conditions'
  END AS samui_advice
FROM (
  SELECT
    wf.location_id,
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c AS temperature_c,
    wf.probability_of_precipitation_1hr AS kans_regen_pct,
    wf.probability_of_thunderstorm AS kans_onweer_pct,
    COALESCE(
      wf.probability_of_fog,
      (wf.values_json->>'probability_of_fog')::double precision
    ) AS kans_mist_pct,
    wf.cape,
    CASE
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '48 hours' THEN
        'hourly'
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '120 hours' THEN
        'mixed'
      ELSE
        '6_hourly_trend'
    END AS resolution,
    CASE
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '48 hours' THEN
        'hoog'
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '120 hours' THEN
        'medium'
      ELSE
        'laag'
    END AS reliability
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc >= now() - interval '12 hours'
) s
ORDER BY s.location_id, s.valid_time_utc;

COMMENT ON VIEW public.sammi_forecast IS
  'Sammi: reliability hoog ≤48h, medium ≤120h, laag >120h from issuance; hide hard % in laag via kans_*_sammi.';
