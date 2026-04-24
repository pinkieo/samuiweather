-- Sammi: public.sammi_forecast (hourly) + public.sammi_daily_forecast (per Bangkok day)
-- Run in Supabase after weather_forecast + 014/008 columns exist.
-- Replaces 012 (superseded). PostgREST: refresh schema if columns change.
--
-- Reliability (vs issuance/updated, Spire-style): high <=48h, medium <=120h, low >120h
-- kans_*_pct_sammi: 0-100, NULL in low band (no "hard" % for Sammi per product policy)
--
-- 42P16: DROP before CREATE; types cannot change in OR REPLACE

DROP VIEW IF EXISTS public.sammi_daily_forecast CASCADE;
DROP VIEW IF EXISTS public.sammi_forecast CASCADE;

-- 1) Hourly: all engine columns + Sammi columns
CREATE OR REPLACE VIEW public.sammi_forecast AS
WITH base AS (
  SELECT
    wf.location_id,
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c,
    wf.wind_speed_ms,
    wf.wind_direction_deg,
    wf.wind_gust_ms,
    wf.total_cloud_cover,
    wf.low_cloud_cover,
    wf.mid_cloud_cover,
    wf.high_cloud_cover,
    wf.ceiling_m,
    wf.cape,
    wf.lifted_index,
    /* Thunderstorm bundle: prefer columns (020), else values_json */
    COALESCE(
      wf.pwat,
      (NULLIF(btrim(wf.values_json->>'precipitable_water'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'precipitable_water_entire_atmosphere'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'total_column_integrated_water_vapour'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'tcw'), ''))::double precision
    ) AS precipitable_water_kg_m2,
    COALESCE(
      wf.dcape,
      (NULLIF(btrim(wf.values_json->>'downdraft_cape'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'downdraft_CAPE'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'dcape'), ''))::double precision
    ) AS dcape,
    COALESCE(
      wf.cin,
      (NULLIF(btrim(wf.values_json->>'convective_inhibition'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'cin'), ''))::double precision,
      (NULLIF(btrim(wf.values_json->>'CIN'), ''))::double precision
    ) AS cin,
    wf.probability_of_precipitation_1hr,
    wf.probability_of_precipitation_24hr,
    COALESCE(
      wf.probability_of_thunderstorm,
      (NULLIF(btrim(wf.values_json->>'probability_of_thunderstorm'), ''))::double precision
    ) AS probability_of_thunderstorm,
    COALESCE(
      wf.probability_of_fog,
      (NULLIF(btrim(wf.values_json->>'probability_of_fog'), ''))::double precision
    ) AS probability_of_fog,
    wf.precipitation_rate,
    wf.relative_humidity,
    wf.values_json,
    wf.beach_score,
    wf.radar_status,
    wf.updated_at
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc < (now() + interval '20 days')
),
n AS (
  SELECT
    b.*,
    /* 0-100, accepts Spire 0-1 or 0-100 */
    CASE
      WHEN b.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
      WHEN b.probability_of_precipitation_1hr::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_precipitation_1hr::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_precipitation_1hr * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_precipitation_1hr::double precision)
    END AS rain_pct_0_100,
    CASE
      WHEN b.probability_of_thunderstorm IS NULL THEN NULL::double precision
      WHEN b.probability_of_thunderstorm::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_thunderstorm::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_thunderstorm * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_thunderstorm::double precision)
    END AS thunder_pct_0_100,
    CASE
      WHEN b.probability_of_fog IS NULL THEN NULL::double precision
      WHEN b.probability_of_fog::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_fog::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_fog * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_fog::double precision)
    END AS fog_pct_0_100,
    CASE
      WHEN b.valid_time_utc <= COALESCE(b.issuance_time_utc, b.updated_at) + interval '48 hours' THEN
        'high'::text
      WHEN b.valid_time_utc <= COALESCE(b.issuance_time_utc, b.updated_at) + interval '120 hours' THEN
        'medium'::text
      ELSE
        'low'::text
    END AS reliability
  FROM base b
)
SELECT
  n.location_id,
  n.issuance_time_utc,
  n.valid_time_utc,
  n.valid_time_ict,

  n.air_temperature_c AS temperature_c,
  ROUND(
    ((n.air_temperature_c * 9.0 / 5.0) + 32.0)::numeric,
    1
  ) AS temperature_f,

  n.precipitation_rate,
  /* 0-1 (chart / math), consistent with kans / 100 */
  (CASE
    WHEN n.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
    WHEN n.probability_of_precipitation_1hr::double precision <= 1.0
      THEN n.probability_of_precipitation_1hr::double precision
    ELSE n.probability_of_precipitation_1hr::double precision / 100.0
  END) AS precip_prob_1h,

  n.probability_of_precipitation_24hr,
  n.probability_of_thunderstorm,
  n.probability_of_fog,

  n.cape,
  n.lifted_index,
  n.precipitable_water_kg_m2,
  n.dcape,
  n.cin,
  n.wind_speed_ms AS wind_speed,
  n.wind_gust_ms AS wind_gust,
  n.wind_direction_deg,
  n.total_cloud_cover,
  n.low_cloud_cover,
  n.mid_cloud_cover,
  n.high_cloud_cover,
  n.ceiling_m,
  n.relative_humidity,
  n.beach_score,
  n.radar_status,
  n.values_json,
  n.updated_at AS last_updated,

  CASE
    WHEN n.valid_time_utc <= COALESCE(n.issuance_time_utc, n.updated_at) + interval '48 hours' THEN
      'hourly'::text
    WHEN n.valid_time_utc <= COALESCE(n.issuance_time_utc, n.updated_at) + interval '120 hours' THEN
      'mixed'::text
    ELSE
      '6_hourly_trend'::text
  END AS resolution,

  /* Sammi: 0-100, hidden when reliability = low */
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.rain_pct_0_100::numeric, 0)
  END) AS kans_regen_pct_sammi,
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.thunder_pct_0_100::numeric, 0)
  END) AS kans_onweer_pct_sammi,
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.fog_pct_0_100::numeric, 0)
  END) AS kans_mist_pct_sammi,

  n.reliability,

  /*
   * ---------------------------------------------------------------------------
   * sammi_tropical_tier (Tier 1) — CAPE + PWAT + CIN + ceiling (samui_thunderstorm_guide)
   * ---------------------------------------------------------------------------
   * CIN (J/kg) “lid” bands (same for hourly + daily, daily uses 10–18 BKK max CIN as weakest cap):
   *   0  to  -25  “No lid”         → cin > -25 (or NULL) — very high chance storms break out
   *  -25 to  -50  “Weak lid”       → cin > -50 AND cin <= -25 — storms usually still come
   *  -50 to -100  “Moderate lid”   → cin >= -100 AND cin < -50 — possible but more uncertain
   *  < -100       “Strong lid”     → cin < -100 — storms strongly suppressed
   * Extra: low ceiling_m (m AGL) = grey, softer visibility at the beach
   * ---------------------------------------------------------------------------
   */
  (CASE
    WHEN n.reliability = 'low' THEN
      'long_range'::text
    WHEN n.cape IS NULL AND n.precipitable_water_kg_m2 IS NULL THEN
      NULL::text
    /* “Exceptional” airmass (PWAT>65 or CAPE>3000) — still respect strong/moderate lid */
    WHEN
      COALESCE(n.precipitable_water_kg_m2, 0::double precision) > 65::double precision
      OR COALESCE(n.cape, 0::double precision) > 3000::double precision THEN
      (CASE
        WHEN n.cin IS NOT NULL AND n.cin < -100::double precision THEN
          'capped_uncertain' /* Strong lid */
        WHEN
          n.cin IS NOT NULL
          AND n.cin >= -100::double precision
          AND n.cin < -50::double precision THEN
          'mixed' /* Moderate lid */
        ELSE
          'exceptional' /* No lid or Weak lid */
      END)
    /* CAPE>2000 + PWAT>55 (Tier 1 storm-favourable) by lid */
    WHEN
      COALESCE(n.cape, 0::double precision) > 2000::double precision
      AND COALESCE(n.precipitable_water_kg_m2, 0::double precision) > 55::double precision
      AND n.cin IS NOT NULL
      AND n.cin < -100::double precision THEN
      'capped_uncertain' /* Strong lid: storms much less likely even if airmass is juicy */
    WHEN
      COALESCE(n.cape, 0::double precision) > 2000::double precision
      AND COALESCE(n.precipitable_water_kg_m2, 0::double precision) > 55::double precision
      AND n.cin IS NOT NULL
      AND n.cin >= -100::double precision
      AND n.cin < -50::double precision THEN
      'mixed' /* Moderate lid */
    WHEN
      COALESCE(n.cape, 0::double precision) > 2000::double precision
      AND COALESCE(n.precipitable_water_kg_m2, 0::double precision) > 55::double precision
      AND (n.cin IS NULL OR n.cin > -50::double precision) THEN
      'storm_likely' /* No lid + Weak lid */
    /* CAPE 1000–2000 + PWAT 45–55 — classic “PM shower” day by lid */
    WHEN
      n.cape >= 1000::double precision
      AND n.cape <= 2000::double precision
      AND n.precipitable_water_kg_m2 >= 45::double precision
      AND n.precipitable_water_kg_m2 <= 55::double precision
      AND n.cin IS NOT NULL
      AND n.cin < -100::double precision THEN
      'capped_uncertain'
    WHEN
      n.cape >= 1000::double precision
      AND n.cape <= 2000::double precision
      AND n.precipitable_water_kg_m2 >= 45::double precision
      AND n.precipitable_water_kg_m2 <= 55::double precision
      AND n.cin IS NOT NULL
      AND n.cin >= -100::double precision
      AND n.cin < -50::double precision THEN
      'mixed'
    WHEN
      n.cape >= 1000::double precision
      AND n.cape <= 2000::double precision
      AND n.precipitable_water_kg_m2 >= 45::double precision
      AND n.precipitable_water_kg_m2 <= 55::double precision
      AND (n.cin IS NULL OR n.cin > -50::double precision) THEN
      'afternoon_showers'
    /* Drier, lighter-CAPE airmass + optional low ceiling (grijs strandweer) */
    WHEN
      n.cape < 1000::double precision
      AND n.precipitable_water_kg_m2 < 45::double precision
      AND n.ceiling_m IS NOT NULL
      AND n.ceiling_m < 800::double precision THEN
      'mixed'
    WHEN
      n.cape < 1000::double precision
      AND n.precipitable_water_kg_m2 < 45::double precision
      AND (n.ceiling_m IS NULL OR n.ceiling_m >= 1000::double precision) THEN
      'stable'
    WHEN
      n.cin IS NOT NULL
      AND n.cin < -100::double precision
      AND NOT (
        n.cape < 1000::double precision
        AND n.precipitable_water_kg_m2 < 45::double precision
      ) THEN
      'capped_uncertain'
    ELSE
      'mixed'
  END) AS sammi_tropical_tier,

  /* Tier 2 (DCAPE gust-risk): 500 / 800 / 1200 (samui_thunderstorm_guide) */
  (CASE
    WHEN n.dcape IS NULL THEN
      NULL::text
    WHEN n.dcape < 500::double precision THEN
      'calm'
    WHEN n.dcape < 800::double precision THEN
      'light_gusts'
    WHEN n.dcape < 1200::double precision THEN
      'strong_gusts'
    ELSE
      'severe_gusts'
  END) AS sammi_wind_tier,

  /*
   * --- sammi_convective_line: short English for tourists; CIN + CAPE + PWAT + ceiling + DCAPE
   * Order: most specific first. NULL CIN: treat as no lid (permissive, same as before).
   */
  (CASE
    WHEN n.reliability = 'low' THEN
      NULL::text
    WHEN n.cape IS NULL AND n.precipitable_water_kg_m2 IS NULL AND n.dcape IS NULL THEN
      NULL::text
    WHEN
      n.reliability <> 'low'
      AND n.cape IS NULL
      AND n.precipitable_water_kg_m2 IS NULL
      AND n.dcape IS NOT NULL
      AND n.dcape >= 800::double precision THEN
      'Sudden strong gusts possible with storms — secure beach umbrellas and light kit.'
    WHEN
      n.cin IS NOT NULL
      AND n.cin < -100::double precision
      AND (COALESCE(n.cape, 0::double precision) > 2000::double precision
        OR COALESCE(n.precipitable_water_kg_m2, 0::double precision) > 55::double precision) THEN
      'Strong lid today — storms less likely even if the air is unstable.'
    WHEN
      n.precipitable_water_kg_m2 > 65::double precision
      OR n.cape > 3000::double precision THEN
      'Serious heat and moisture today — any storm can be extra punchy. Stay close to cover.'
    WHEN
      n.cin IS NOT NULL
      AND n.cin >= -100::double precision
      AND n.cin < -50::double precision
      AND n.cape > 2000::double precision
      AND n.precipitable_water_kg_m2 > 55::double precision THEN
      'Middling lid today — watch the afternoon; storms are possible but not a given.'
    WHEN
      n.cape > 2000::double precision
      AND n.precipitable_water_kg_m2 > 55::double precision
      AND (n.cin IS NULL OR n.cin > -50::double precision) THEN
      'Thunderstorms likely late afternoon — plan indoor activities after 3 PM.'
    WHEN
      n.cin IS NOT NULL
      AND n.cin >= -100::double precision
      AND n.cin < -50::double precision
      AND n.cape >= 1000::double precision
      AND n.cape <= 2000::double precision
      AND n.precipitable_water_kg_m2 >= 45::double precision
      AND n.precipitable_water_kg_m2 <= 55::double precision THEN
      'A hint of a lid today — a dry morning is possible, but keep an eye on the afternoon sky.'
    WHEN
      n.cape >= 1000::double precision
      AND n.cape <= 2000::double precision
      AND n.precipitable_water_kg_m2 >= 45::double precision
      AND n.precipitable_water_kg_m2 <= 55::double precision
      AND (n.cin IS NULL OR n.cin > -50::double precision) THEN
      'Dry right now, chance of showers later this afternoon.'
    WHEN
      n.cape < 1000::double precision
      AND n.precipitable_water_kg_m2 < 45::double precision
      AND (n.ceiling_m IS NULL OR n.ceiling_m >= 1000::double precision) THEN
      'Right now dry and sunny — perfect beach weather.'
    WHEN
      n.cape < 1000::double precision
      AND n.precipitable_water_kg_m2 < 45::double precision
      AND n.ceiling_m IS NOT NULL
      AND n.ceiling_m < 1000::double precision THEN
      'Right now dry, but a low cloud base can make things feel a bit grey — the water is still lovely.'
    WHEN
      n.cin IS NOT NULL
      AND n.cin < -100::double precision
      AND (n.cape >= 1000::double precision OR n.precipitable_water_kg_m2 >= 45::double precision) THEN
      'Strong lid today — storms less likely for now, but the hourly can still shift.'
    WHEN
      n.cape >= 1000::double precision
      OR n.precipitable_water_kg_m2 >= 45::double precision THEN
      'A few showers or storms may bubble up this afternoon; mornings are often the calmest.'
    ELSE
      'Hour to hour, keep the strip in view — you will find a sweet window for the beach.'
  END) AS sammi_convective_line
FROM n;

COMMENT ON VIEW public.sammi_forecast IS
  'Hourly: kans_*; Tier1 CAPE+PWAT+CIN+ceiling; Tier2 DCAPE; CIN “lid” bands from samui_thunderstorm_guide.pdf; sammi_tropical_tier, sammi_wind_tier, sammi_convective_line.';

-- 2) Daily (Bangkok calendar day) per location
CREATE OR REPLACE VIEW public.sammi_daily_forecast AS
WITH h AS (
  SELECT
    sf.location_id,
    (sf.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::date AS forecast_date,
    (sf.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::time AS ict_time_bkk,
    sf.temperature_c,
    sf.kans_regen_pct_sammi,
    sf.kans_onweer_pct_sammi,
    sf.kans_mist_pct_sammi,
    sf.cape,
    sf.precipitable_water_kg_m2,
    sf.dcape,
    sf.cin,
    sf.ceiling_m,
    sf.reliability
  FROM public.sammi_forecast sf
),
agg AS (
  SELECT
    h.location_id,
    h.forecast_date,
    ROUND(AVG(h.temperature_c)::numeric, 1) AS avg_temp_c,
    ROUND(MAX(h.temperature_c)::numeric, 1) AS max_temp_c,
    ROUND(MIN(h.temperature_c)::numeric, 1) AS min_temp_c,
    /* Nette %: AVG rain (ignores null hours); max thunder/mist (null if no data that day) */
    ROUND(AVG(h.kans_regen_pct_sammi)::numeric, 0) AS avg_rain_pct,
    ROUND(MAX(h.kans_onweer_pct_sammi)::numeric, 0) AS max_thunder_pct,
    ROUND(MAX(h.kans_mist_pct_sammi)::numeric, 0) AS max_mist_pct,
    MAX(h.cape) AS max_cape,
    /* Samui guide: convective window ~10:00–18:00 Bangkok (sea-breeze) */
    MAX(
      CASE
        WHEN h.ict_time_bkk >= time '10:00' AND h.ict_time_bkk <= time '18:00' THEN h.cape
      END
    ) AS conv_cape_max,
    MAX(
      CASE
        WHEN h.ict_time_bkk >= time '10:00' AND h.ict_time_bkk <= time '18:00' THEN h.precipitable_water_kg_m2
      END
    ) AS conv_pwat_max,
    MAX(
      CASE
        WHEN h.ict_time_bkk >= time '10:00' AND h.ict_time_bkk <= time '18:00' THEN h.dcape
      END
    ) AS conv_dcape_max,
    /* Weakest cap in window (CIN is <= 0; max value = closest to 0) */
    MAX(
      CASE
        WHEN h.ict_time_bkk >= time '10:00' AND h.ict_time_bkk <= time '18:00' THEN h.cin
      END
    ) AS conv_cin_max,
    /* Lowest cloud base in sea-breeze window (m AGL) — visibility / “beach grey” */
    MIN(
      CASE
        WHEN h.ict_time_bkk >= time '10:00' AND h.ict_time_bkk <= time '18:00' THEN h.ceiling_m
      END
    ) AS conv_ceiling_min,
    ROUND(
      MAX(
        CASE
          WHEN h.ict_time_bkk >= time '12:00' THEN h.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_afternoon_rain_pct,
    ROUND(
      MAX(
        CASE
          WHEN h.ict_time_bkk < time '12:00' THEN h.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_morning_rain_pct,
    CASE
      WHEN bool_or(h.reliability = 'low') THEN
        'low'::text
      WHEN bool_or(h.reliability = 'medium') THEN
        'medium'::text
      ELSE
        'high'::text
    END AS reliability
  FROM h
  GROUP BY
    h.location_id,
    h.forecast_date
),
advice0 AS (
  SELECT
    a.*,
    /* advice_core: first matching branch wins. conv_cin_max = MAX(CIN) 10–18h = easiest moment for a break. */
    (CASE
      WHEN a.reliability = 'low' AND COALESCE(a.max_cape, 0::numeric) > 2000::numeric THEN
        'Long-range only — the hourly is your friend for the next two days of sun and rain.'

      WHEN a.reliability = 'low' THEN
        'This is a long-range peek — the hourly is clearest for the next 48 hours.'

      WHEN
        a.reliability <> 'low'
        AND (a.conv_cape_max IS NOT NULL OR a.conv_pwat_max IS NOT NULL)
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max < -100::double precision
        AND (COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
          OR COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision) THEN
        'Strong lid today — storms less likely even if the air is unstable. Enjoy the calmer side of the day.'

      WHEN
        a.reliability <> 'low'
        AND (a.conv_cape_max IS NOT NULL OR a.conv_pwat_max IS NOT NULL)
        AND (
          COALESCE(a.conv_pwat_max, 0::double precision) > 65::double precision
          OR COALESCE(a.conv_cape_max, 0::double precision) > 3000::double precision
        )
        AND (a.conv_cin_max IS NULL OR a.conv_cin_max >= -100::double precision) THEN
        'A very juicy sky — if storms fire, they can pour. Keep a flexible plan and stay safe on the roads.'

      WHEN
        a.reliability <> 'low'
        AND (a.conv_cape_max IS NOT NULL OR a.conv_pwat_max IS NOT NULL)
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max >= -100::double precision
        AND a.conv_cin_max < -50::double precision
        AND COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
        AND COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision THEN
        'A middling lid today — afternoon storms are possible, but not guaranteed. A dry morning is still on the cards.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cape_max IS NOT NULL
        AND a.conv_pwat_max IS NOT NULL
        AND COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
        AND COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision
        AND (a.conv_cin_max IS NULL OR a.conv_cin_max > -50::double precision) THEN
        'Thunderstorms likely late afternoon — plan indoor activities after 3 PM.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cape_max IS NOT NULL
        AND a.conv_pwat_max IS NOT NULL
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max >= -100::double precision
        AND a.conv_cin_max < -50::double precision
        AND a.conv_cape_max >= 1000::double precision
        AND a.conv_cape_max <= 2000::double precision
        AND a.conv_pwat_max >= 45::double precision
        AND a.conv_pwat_max <= 55::double precision THEN
        'Dry right now, chance of showers later this afternoon — the sky may wait to decide in the end.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cape_max IS NOT NULL
        AND a.conv_pwat_max IS NOT NULL
        AND a.conv_cape_max >= 1000::double precision
        AND a.conv_cape_max <= 2000::double precision
        AND a.conv_pwat_max >= 45::double precision
        AND a.conv_pwat_max <= 55::double precision
        AND (a.conv_cin_max IS NULL OR a.conv_cin_max > -50::double precision) THEN
        'Dry right now, chance of showers later this afternoon.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cape_max IS NOT NULL
        AND a.conv_pwat_max IS NOT NULL
        AND a.conv_cape_max < 1000::double precision
        AND a.conv_pwat_max < 45::double precision
        AND (a.conv_ceiling_min IS NULL OR a.conv_ceiling_min >= 1000::double precision) THEN
        'Right now dry and sunny — perfect beach weather.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cape_max IS NOT NULL
        AND a.conv_pwat_max IS NOT NULL
        AND a.conv_cape_max < 1000::double precision
        AND a.conv_pwat_max < 45::double precision
        AND a.conv_ceiling_min IS NOT NULL
        AND a.conv_ceiling_min < 1000::double precision THEN
        'Sunny in spirit, but a low cloud base can make the day feel a little grey — the sea is still clear enough for a swim.'

      WHEN
        a.reliability <> 'low'
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max < -100::double precision
        AND (
          a.conv_cape_max IS NULL
          OR a.conv_pwat_max IS NULL
          OR NOT (
            a.conv_cape_max < 1000::double precision
            AND a.conv_pwat_max < 45::double precision
          )
        ) THEN
        'Strong lid today — big storms are less likely, though the hour-by-hour can still wobble. Peek at the strip.'

      WHEN
        a.reliability <> 'low'
        AND (a.conv_cape_max IS NOT NULL OR a.conv_pwat_max IS NOT NULL)
        AND (
          COALESCE(a.conv_cape_max, 0::double precision) >= 1000::double precision
          OR COALESCE(a.conv_pwat_max, 0::double precision) >= 45::double precision
        ) THEN
        'Showers or storms may pop up — mornings are often the pick for sand and water time.'

      WHEN
        (COALESCE(a.max_thunder_pct, 0::numeric) > 35::numeric
          OR COALESCE(a.max_cape, 0::numeric) > 2000::numeric)
        AND a.reliability <> 'low' THEN
        'Storms on the menu — have a plan B, especially after lunch and toward sunset.'

      WHEN
        COALESCE(a.max_afternoon_rain_pct, 0::numeric) > 45::numeric
        AND COALESCE(a.max_morning_rain_pct, 0::numeric) < 25::numeric
        AND COALESCE(a.avg_rain_pct, 0::numeric) > 30::numeric THEN
        'Rain leans to the afternoon — catch the calmer, drier feel in the first half of the day.'

      WHEN COALESCE(a.avg_rain_pct, 0::numeric) > 40::numeric THEN
        'A wet-leaning day — you can still catch sunny gaps between the bands, especially early on.'

      WHEN COALESCE(a.max_mist_pct, 0::numeric) > 25::numeric THEN
        'Soft mist or low cloud in places — go slow on the roads and enjoy the soft light.'

      WHEN
        a.reliability = 'high'
        AND COALESCE(a.avg_rain_pct, 0::numeric) < 30::numeric
        AND COALESCE(a.max_thunder_pct, 0::numeric) < 20::numeric THEN
        'A lovely window for sun and sand — SPF, water, and a quick look at the hourly to fine-tune the day.'

      ELSE
        'Warm, relaxed island day — a light layer for AC, a hat for the sun, and the hourly for timing.'
    END) AS advice_core,
    /* CIN (conv_cin_max) = MAX(CIN) 10–18h BKK = weakest cap in that window — see samui_thunderstorm_guide */
    (CASE
      WHEN a.reliability = 'low' THEN
        'long_range'::text
      WHEN a.conv_cape_max IS NULL AND a.conv_pwat_max IS NULL THEN
        NULL::text
      WHEN
        COALESCE(a.conv_pwat_max, 0::double precision) > 65::double precision
        OR COALESCE(a.conv_cape_max, 0::double precision) > 3000::double precision THEN
        (CASE
          WHEN
            a.conv_cin_max IS NOT NULL
            AND a.conv_cin_max < -100::double precision THEN
            'capped_uncertain' /* Strong lid */
          WHEN
            a.conv_cin_max IS NOT NULL
            AND a.conv_cin_max >= -100::double precision
            AND a.conv_cin_max < -50::double precision THEN
            'mixed' /* Moderate lid */
          ELSE
            'exceptional' /* No or Weak lid */
        END)
      WHEN
        COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
        AND COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max < -100::double precision THEN
        'capped_uncertain'
      WHEN
        COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
        AND COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max >= -100::double precision
        AND a.conv_cin_max < -50::double precision THEN
        'mixed'
      WHEN
        COALESCE(a.conv_cape_max, 0::double precision) > 2000::double precision
        AND COALESCE(a.conv_pwat_max, 0::double precision) > 55::double precision
        AND (a.conv_cin_max IS NULL OR a.conv_cin_max > -50::double precision) THEN
        'storm_likely'
      WHEN
        a.conv_cape_max >= 1000::double precision
        AND a.conv_cape_max <= 2000::double precision
        AND a.conv_pwat_max >= 45::double precision
        AND a.conv_pwat_max <= 55::double precision
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max < -100::double precision THEN
        'capped_uncertain'
      WHEN
        a.conv_cape_max >= 1000::double precision
        AND a.conv_cape_max <= 2000::double precision
        AND a.conv_pwat_max >= 45::double precision
        AND a.conv_pwat_max <= 55::double precision
        AND a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max >= -100::double precision
        AND a.conv_cin_max < -50::double precision THEN
        'mixed'
      WHEN
        a.conv_cape_max >= 1000::double precision
        AND a.conv_cape_max <= 2000::double precision
        AND a.conv_pwat_max >= 45::double precision
        AND a.conv_pwat_max <= 55::double precision
        AND (a.conv_cin_max IS NULL OR a.conv_cin_max > -50::double precision) THEN
        'afternoon_showers'
      WHEN
        a.conv_cape_max < 1000::double precision
        AND a.conv_pwat_max < 45::double precision
        AND a.conv_ceiling_min IS NOT NULL
        AND a.conv_ceiling_min < 800::double precision THEN
        'mixed'
      WHEN
        a.conv_cape_max < 1000::double precision
        AND a.conv_pwat_max < 45::double precision
        AND (a.conv_ceiling_min IS NULL OR a.conv_ceiling_min >= 1000::double precision) THEN
        'stable'
      WHEN
        a.conv_cin_max IS NOT NULL
        AND a.conv_cin_max < -100::double precision
        AND NOT (
          a.conv_cape_max < 1000::double precision
          AND a.conv_pwat_max < 45::double precision
        ) THEN
        'capped_uncertain'
      WHEN
        COALESCE(a.conv_cape_max, 0::double precision) >= 1000::double precision
        OR COALESCE(a.conv_pwat_max, 0::double precision) >= 45::double precision THEN
        'mixed'
      ELSE
        NULL::text
    END) AS sammi_tropical_tier,
    (CASE
      WHEN a.conv_dcape_max IS NULL THEN
        NULL::text
      WHEN a.conv_dcape_max < 500::double precision THEN
        'calm'
      WHEN a.conv_dcape_max < 800::double precision THEN
        'light_gusts'
      WHEN a.conv_dcape_max < 1200::double precision THEN
        'strong_gusts'
      ELSE
        'severe_gusts'
    END) AS sammi_wind_tier
  FROM agg a
)
SELECT
  x.location_id,
  x.forecast_date,
  x.avg_temp_c,
  x.max_temp_c,
  x.min_temp_c,
  x.avg_rain_pct AS kans_regen_pct_sammi,
  x.max_thunder_pct AS kans_onweer_pct_sammi,
  x.max_mist_pct AS kans_mist_pct_sammi,
  x.avg_rain_pct AS chance_of_rain_pct,
  x.max_thunder_pct AS chance_of_thunder_pct,
  x.max_mist_pct AS chance_of_fog_pct,
  x.reliability AS reliability_level,
  x.reliability,
  x.conv_cape_max,
  x.conv_pwat_max,
  x.conv_cin_max,
  x.conv_dcape_max,
  x.conv_ceiling_min,
  x.sammi_tropical_tier,
  x.sammi_wind_tier,
  rtrim(
    COALESCE(x.advice_core, ''::text) || CASE
      /* Tier 2 DCAPE */
      WHEN
        x.reliability <> 'low'
        AND COALESCE(x.conv_dcape_max, 0::double precision) > 1200::double precision THEN
        ' Sudden blast-like winds possible near storms — skip small boats and inflatables today.'::text
      WHEN
        x.reliability <> 'low'
        AND COALESCE(x.conv_dcape_max, 0::double precision) > 800::double precision
        AND COALESCE(x.conv_dcape_max, 0::double precision) <= 1200::double precision THEN
        ' Sudden strong gusts possible with storms — secure beach umbrellas.'::text
      ELSE
        ''::text
    END
  ) AS sammi_advice
FROM advice0 x;

COMMENT ON VIEW public.sammi_daily_forecast IS
  'Per Bangkok day: kans, conv max 10–18h BKK (CIN = weakest cap, ceiling = min base); CIN lids per samui_thunderstorm_guide.pdf; sammi_tropical_tier, sammi_wind_tier, sammi_advice + DCAPE suffix.';
