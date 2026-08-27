-- Production sammi_daily_forecast was missing conv_ceiling_min (pre-013).
-- Percent mapping in 013 now uses (0, 1) exclusive of 1.0 so a stored 1% is not
-- multiplied to 100%.
--
-- Apply this file by running the canonical view definition:
--   supabase/013_sammi_forecast_views.sql
--
-- This file is a pointer only (no duplicate 700-line view).
SELECT 1;
