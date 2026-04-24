import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type ValidationRow = {
  id: string;
  location_id: string;
  forecast_valid_utc: string;
  captured_at: string;
  spire_snapshot: Record<string, unknown> | null;
  reference_grid_snapshot: Record<string, unknown> | null;
  reference_grid_provider?: string | null;
  schema_version?: string | null;
  observation: Record<string, unknown> | null;
  observation_at_utc?: string | null;
  observation_source?: string | null;
};

function n(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return null;
}

function dStr(a: number | null, b: number | null, unit: string) {
  if (a == null || b == null) return '—';
  return `${(a - b).toFixed(2)}${unit}`;
}

/**
 * Internal dashboard: ` /admin/validation?token=ADMIN_VALIDATION_TOKEN` (or same as `CRON_SECRET` if
 * `ADMIN_VALIDATION_TOKEN` is missing). Needs .env: SUPABASE_* and a valid token.
 */
export default async function AdminValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const expected =
    process.env.ADMIN_VALIDATION_TOKEN?.trim() || process.env.CRON_SECRET?.trim();

  if (!expected) {
    return (
      <div className="min-h-dvh bg-slate-950 p-6 text-slate-200">
        <h1 className="text-lg font-bold text-amber-200">Admin validation</h1>
        <p className="mt-2 text-sm text-slate-400">Set `ADMIN_VALIDATION_TOKEN` (or `CRON_SECRET`) in the environment.</p>
      </div>
    );
  }
  if (token !== expected) {
    notFound();
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return (
      <div className="min-h-dvh bg-slate-950 p-6 text-red-200">
        Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY
      </div>
    );
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('weather_validation')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="min-h-dvh bg-slate-950 p-6 text-amber-100">
        <h1 className="font-mono text-sm">Supabase: {error.message}</h1>
        <p className="mt-2 text-sm text-slate-400">Apply `supabase/017_weather_validation.sql` (and 018) in the project.</p>
      </div>
    );
  }

  const rows = (data ?? []) as unknown as ValidationRow[];

  return (
    <div className="min-h-dvh overflow-auto bg-slate-950 p-4 text-slate-100 md:p-8">
      <h1 className="text-sm font-black uppercase tracking-widest text-cyan-400">Weather validation</h1>
      <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
        Spire snapshot vs reference grid (internal). Δ = lead temp minus reference. GW3001 komt in `observation` zodra
        geladen.
      </p>
      <p className="mt-2 text-xs text-slate-600">{rows.length} row(s) · max 200</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[800px] border-collapse text-left text-[10px]">
          <thead>
            <tr className="border-b border-white/10 bg-slate-900/80 text-[8px] font-black uppercase tracking-wide text-slate-500">
              <th className="p-2">captured (UTC)</th>
              <th className="p-2">location</th>
              <th className="p-2">valid hour</th>
              <th className="p-2">Spire T°C</th>
              <th className="p-2">ref T°C</th>
              <th className="p-2">ΔT</th>
              <th className="p-2">Spire mm/h</th>
              <th className="p-2">ref mm</th>
              <th className="p-2">schema</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sp = r.spire_snapshot ?? {};
              const rg = r.reference_grid_snapshot;
              const sTemp = n(sp.temp);
              const rTemp = rg ? n(rg.tempC) : null;
              const sPr = n(sp.precipRate);
              const rPr = rg ? n(rg.precipMm) : null;
              return (
                <tr
                  key={r.id}
                  className="border-b border-white/5 odd:bg-slate-900/30 hover:bg-white/[0.04]"
                >
                  <td className="p-2 font-mono text-slate-400">
                    {new Date(r.captured_at).toISOString().slice(0, 19)}Z
                  </td>
                  <td className="p-2 text-cyan-200/80">{r.location_id}</td>
                  <td className="p-2 font-mono text-slate-500">
                    {r.forecast_valid_utc}
                  </td>
                  <td className="p-2">{sTemp != null ? sTemp.toFixed(1) : '—'}</td>
                  <td className="p-2">{rTemp != null ? rTemp.toFixed(1) : '—'}</td>
                  <td className="p-2 text-amber-200/90">{dStr(sTemp, rTemp, '°')}</td>
                  <td className="p-2">{sPr != null ? sPr.toFixed(2) : '—'}</td>
                  <td className="p-2">{rPr != null ? rPr.toFixed(2) : '—'}</td>
                  <td className="p-2 text-slate-600">{r.schema_version ?? '1'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-slate-500">No rows yet — run the validation cron 1–2 times.</p>
        )}
      </div>
    </div>
  );
}
