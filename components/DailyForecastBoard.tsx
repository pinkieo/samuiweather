import type { DailyBoard, ShowerShade, SkyKind } from '@/lib/daily-board';
import { GARDEN_STATION, MAP_H, MAP_W, islandPath } from '@/lib/daily-board-map';

const SHADE_FILL: Record<ShowerShade, string> = {
  unavailable: '#3d5c56',
  dry: '#1f8f64',
  possible: '#1a7f96',
  likely: '#1d6eb8',
  heavy: '#1a4f96',
};

const SKY_LABEL: Record<SkyKind, string> = {
  sun: 'Sunny',
  cloud: 'Cloudy',
  shower: 'Showers',
  thunder: 'Thunder',
  unavailable: 'Unavailable',
};

function SkyIcon({ kind }: { kind: SkyKind }) {
  const common = { width: 42, height: 42, viewBox: '0 0 42 42', 'aria-hidden': true as const };
  if (kind === 'sun') {
    return (
      <svg {...common}>
        <circle cx="21" cy="21" r="7" fill="#f6c453" />
        <g stroke="#f6c453" strokeWidth="2" strokeLinecap="round">
          <path d="M21 6v4M21 32v4M6 21h4M32 21h4M10 10l3 3M29 29l3 3M32 10l-3 3M13 29l-3 3" />
        </g>
      </svg>
    );
  }
  if (kind === 'shower') {
    return (
      <svg {...common}>
        <path d="M12 24h18a7 7 0 0 0 .4-14 9 9 0 0 0-17.2 2.2A6 6 0 0 0 12 24z" fill="#d7e6ef" />
        <g stroke="#7ec8e3" strokeWidth="2" strokeLinecap="round">
          <path d="M16 28l-1.5 5M21 28l-1.5 5M26 28l-1.5 5" />
        </g>
      </svg>
    );
  }
  if (kind === 'thunder') {
    return (
      <svg {...common}>
        <path d="M12 23h18a7 7 0 0 0 .4-14 9 9 0 0 0-17.2 2.2A6 6 0 0 0 12 23z" fill="#e7e1f4" />
        <path d="M19 22l-3 7h5l-2 7 8-10h-5l3-4z" fill="#f0c36a" />
      </svg>
    );
  }
  if (kind === 'cloud') {
    return (
      <svg {...common}>
        <path d="M12 28h18a7 7 0 0 0 .4-14 9 9 0 0 0-17.2 2.2A6 6 0 0 0 12 28z" fill="#d5e2ea" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="21" cy="21" r="8" fill="none" stroke="#9fb4c0" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

function HourStack({ label }: { label: string }) {
  if (label === '—' || label === 'Calm') return <span>{label}</span>;
  const parts = label.split(' ').filter(Boolean);
  if (parts.length < 2) return <span>{label}</span>;
  return (
    <span className="block">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="block">
          {part}
        </span>
      ))}
    </span>
  );
}

function IslandMap({ shade }: { shade: ShowerShade }) {
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-[92px] w-full" role="img" aria-label="Koh Samui">
      <rect width={MAP_W} height={MAP_H} rx="12" fill="#073044" />
      <path d={islandPath()} fill={SHADE_FILL[shade]} stroke="#d5efe4" strokeWidth="1.2" />
      <circle cx={GARDEN_STATION.x} cy={GARDEN_STATION.y} r="3.2" fill="#f0c36a" />
    </svg>
  );
}

export default function DailyForecastBoard({ board }: { board: DailyBoard }) {
  return (
    <main
      data-daily-board
      lang="en"
      className="flex h-[720px] w-[1280px] overflow-hidden bg-[#071820] text-[#f4f7f8]"
    >
      <div data-presenter-slot="empty" className="h-full w-[300px] shrink-0 bg-[#041016]" />
      <section className="flex min-w-0 flex-1 flex-col px-5 py-3">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9ec9c2]">
              Koh Samui
            </p>
            <h1 className="mt-0.5 text-[26px] font-semibold leading-none">Today</h1>
          </div>
          <div className="text-right">
            <p className="text-[16px] text-[#d5e4ea]">{board.dateLabel}</p>
            <p className="mt-1 text-[12px] text-[#9fb4c0]">
              {board.mode === 'sample'
                ? 'Sample forecast — not live'
                : board.mode === 'unavailable'
                  ? 'Forecast unavailable'
                  : board.issuedLabel ?? 'Forecast'}
            </p>
          </div>
        </header>

        {board.mode === 'sample' ? (
          <p className="mt-2 rounded-md border border-[#f0c36a] bg-[#3a2e12] px-3 py-1 text-[13px] font-semibold text-[#f6d78a]">
            Sample data for layout only. These are not today’s live numbers.
          </p>
        ) : null}

        <div className="mt-2 grid grid-cols-4 gap-2.5">
          {board.blocks.map((block) => (
            <article
              key={block.id}
              data-block={block.id}
              data-shade={block.shade}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#d7ebe6]">
                  {block.label}
                </h2>
                <span className="text-[10px] text-[#8eacb6]">{block.hourRange}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <SkyIcon kind={block.sky} />
                <div>
                  <p className="text-[28px] font-semibold leading-none">{block.tempLabel}</p>
                  <p className="text-[11px] text-[#9fb4c0]">
                    {SKY_LABEL[block.sky]}
                    {block.adjusted ? ' · adjusted' : ''}
                  </p>
                </div>
              </div>
              <p className="mt-1 min-h-[32px] text-[13px] leading-snug text-[#e7f2f6]">
                {block.rainWords ?? 'Rain chance unavailable'}
                {block.rainChancePct != null ? ` · ${Math.round(block.rainChancePct)}%` : ''}
              </p>
              <IslandMap shade={block.shade} />
            </article>
          ))}
        </div>

        <p className="mt-1.5 text-[11px] leading-snug text-[#8eacb6]">{board.mapCaption}</p>

        <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5">
          <div
            className="grid items-center gap-x-1 text-center"
            style={{ gridTemplateColumns: `52px repeat(${board.hours.length}, minmax(0, 1fr))` }}
          >
            <div />
            {board.hours.map((hour) => (
              <div key={`h-${hour.ictHour}`} className="text-[12px] font-semibold text-[#f4f7f8]">
                {String(hour.ictHour).padStart(2, '0')}
              </div>
            ))}
            <div className="py-0.5 text-left text-[10px] uppercase tracking-wide text-[#8eacb6]">Rain</div>
            {board.hours.map((hour) => (
              <div key={`r-${hour.ictHour}`} className="text-[11px] text-[#d5eef8]">
                {hour.rainLabel}
              </div>
            ))}
            <div className="py-0.5 text-left text-[10px] uppercase tracking-wide text-[#8eacb6]">Thunder</div>
            {board.hours.map((hour) => (
              <div key={`t-${hour.ictHour}`} className="text-[10px] text-[#ead9f8]">
                {hour.thunderLabel}
              </div>
            ))}
            <div className="py-0.5 text-left text-[10px] uppercase tracking-wide text-[#8eacb6]">UV</div>
            {board.hours.map((hour) => (
              <div key={`u-${hour.ictHour}`} className="text-[10px] leading-tight text-[#f6e3b0]">
                <HourStack label={hour.uvLabel} />
              </div>
            ))}
            <div className="py-0.5 text-left text-[10px] uppercase tracking-wide text-[#8eacb6]">Wind</div>
            {board.hours.map((hour) => (
              <div key={`w-${hour.ictHour}`} className="px-0.5 text-[10px] leading-tight text-[#d5e4ea]">
                <HourStack label={hour.windLabel} />
              </div>
            ))}
          </div>
        </div>

        <p className="mt-1.5 text-[15px] font-medium leading-snug text-[#f7f3e8]">{board.bestForToday}</p>
        <p className="text-[11px] leading-snug text-[#9fb4c0]">{board.biasSummary}</p>
        <p data-board-credit className="mt-auto pt-1 text-[10px] leading-snug text-[#8ea6b0]">
          {board.credit}
        </p>
      </section>
    </main>
  );
}
