-- Enable RLS on the four public tables that were left open to the anon key.
--
-- The browser does not query these tables. Next.js routes and scripts use the
-- service-role key, which bypasses RLS. anon and authenticated therefore get
-- no SELECT policy and no INSERT, UPDATE, or DELETE policy.
--
-- sammi_forecast reads weather_forecast. sammi_daily_forecast reads
-- sammi_forecast. Both were security-definer views, so the anon key could
-- still read forecast columns through them. security_invoker makes those
-- reads follow weather_forecast RLS. The service role bypasses RLS.
-- anon and authenticated lose table privileges on the views.

ALTER TABLE public.island_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_webcams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_forecast ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_history ENABLE ROW LEVEL SECURITY;

ALTER VIEW public.sammi_forecast SET (security_invoker = true);
ALTER VIEW public.sammi_daily_forecast SET (security_invoker = true);

REVOKE ALL ON TABLE public.sammi_forecast FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sammi_daily_forecast FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sammi_forecast TO service_role;
GRANT SELECT ON TABLE public.sammi_daily_forecast TO service_role;
