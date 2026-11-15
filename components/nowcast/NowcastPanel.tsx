'use client';

/**
 * EXPERIMENTAL rain nowcast panel. Styles live in nowcast-panel.css
 * (imported by app/nowcast-preview/page.tsx). Fetching is unchanged.
 *
 * Class hooks:
 *   .nowcast-panel            root <section>; data-state = loading | ok | unavailable | error; data-stale = true | false
 *   .nowcast-header           title row
 *   .nowcast-title            "Rain nowcast · Bo Phut"
 *   .nowcast-badges           Experimental + optional STALE
 *   .nowcast-badge            shared badge look
 *   .nowcast-badge--experimental   always visible "Experimental" label
 *   .nowcast-badge--stale          "STALE" badge, only rendered when the newest radar frame is > 20 min old
 *   .nowcast-verdict          one-line hedged verdict (data-category = approaching | overhead | near | receding | passing | stationary | none)
 *   .nowcast-radar            scope, clock, legend, motion loop (presentational)
 *   .nowcast-meta             frame time / age / update line
 *   .nowcast-cells            cell table; rows .nowcast-cell + .nowcast-cell--<status>; cells .nowcast-cell-name|distance|motion|text
 *   .nowcast-nocells / .nowcast-farcells   empty / "more cells not listed" notes
 *   .nowcast-disclaimer, .nowcast-source   footer lines
 *   .nowcast-loading, .nowcast-unavailable state messages
 * Page wrapper (app/nowcast-preview/page.tsx): .nowcast-page, .nowcast-preview-banner.
 * State is explicit: loading / ok / unavailable. Never shows a verdict it did not receive from /api/nowcast.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NowcastResponse } from '@/lib/nowcast/service';
import NowcastRadar from './NowcastRadar';

const REFRESH_MS = 120_000;
/** Same radius the verdict uses for "rain within N km"; farther cells stay in the JSON only. */
const TABLE_MAX_EDGE_KM = 70;

export default function NowcastPanel({ endpoint = '/api/nowcast' }: { endpoint?: string }) {
  const [data, setData] = useState<NowcastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      const json = (await res.json()) as NowcastResponse;
      setData(json);
      setError(null);
    } catch {
      setData(null);
      setError('Could not reach the nowcast service.');
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const stale = data?.status === 'ok' && data.verdict.stale;
  const nearby = data?.status === 'ok' ? data.cells.filter((c) => c.edgeKm <= TABLE_MAX_EDGE_KM) : [];

  return (
    <section className="nowcast-panel" data-state={error ? 'error' : (data?.status ?? 'loading')} data-stale={stale ? 'true' : 'false'}>
      <header className="nowcast-header">
        <h2 className="nowcast-title">Rain nowcast &middot; Bo Phut</h2>
        <div className="nowcast-badges">
          <span className="nowcast-badge nowcast-badge--experimental">Experimental</span>
          {stale && <span className="nowcast-badge nowcast-badge--stale">STALE</span>}
        </div>
      </header>

      {!data && !error && <p className="nowcast-loading">Loading radar nowcast&hellip;</p>}

      {error && <p className="nowcast-unavailable">Nowcast unavailable: {error}</p>}

      {data?.status === 'unavailable' && (
        <p className="nowcast-unavailable">
          Nowcast unavailable ({data.reason}). {data.detail}
        </p>
      )}

      {data?.status === 'ok' && (
        <>
          <p className="nowcast-verdict" data-category={data.verdict.category}>
            <span className="nowcast-verdict-mark" aria-hidden="true" />
            <span className="nowcast-verdict-text">{data.verdict.text}</span>
          </p>
          <NowcastRadar cells={data.cells} frameUnix={data.frame.newestUnix} />
          <p className="nowcast-meta">
            Newest radar frame {data.frame.newestIct} (Bangkok time), {Math.round(data.frame.ageMin)} min old &middot; updated{' '}
            {data.generatedAtIct} &middot; {data.frame.unique} distinct scans
          </p>

          {nearby.length > 0 && (
            <div className="nowcast-table-wrap">
            <table className="nowcast-cells">
              <thead>
                <tr>
                  <th scope="col">Cell</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Motion</th>
                  <th scope="col">Outlook</th>
                </tr>
              </thead>
              <tbody>
                {nearby.map((c) => (
                  <tr key={c.tid} className={`nowcast-cell nowcast-cell--${c.status}`}>
                    <td className="nowcast-cell-name">
                      #{c.tid} &middot; {c.areaKm2} km&sup2; &middot; {c.maxDbz} dBZ &middot; {c.trend}
                    </td>
                    <td className="nowcast-cell-distance">{c.edgeKm} km</td>
                    <td className="nowcast-cell-motion">
                      {c.heading === null ? 'nearly stationary' : `${c.speedKmh} km/h toward ${c.heading}\u00b0`} ({c.conf} confidence)
                    </td>
                    <td className="nowcast-cell-text">{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {nearby.length === 0 && <p className="nowcast-nocells">No radar rain cells within {TABLE_MAX_EDGE_KM} km of Bo Phut.</p>}
          {data.cells.length > nearby.length && (
            <p className="nowcast-farcells">
              {data.cells.length - nearby.length} more cell(s) farther than {TABLE_MAX_EDGE_KM} km not listed.
            </p>
          )}

          <p className="nowcast-disclaimer">{data.disclaimer}</p>
          <p className="nowcast-source">Source: {data.source}</p>
        </>
      )}
    </section>
  );
}
