/** 本周战报: Mon–Fri seal stamps of each day's final pick, plus the 「建议锦少约谈」 line. */
import { useMemo } from 'react';
import { COPY } from '@/data/copy';
import { weeklyReport } from '@/draw/eggs';
import { todayKey } from '@/lib/date';
import { useStore } from '@/state/store';

function shortName(name: string): string {
  const chars = Array.from(name);
  return chars.length <= 2 ? name : chars.slice(0, 2).join('');
}

export function WeeklyStrip(props: { compact?: boolean }) {
  const { compact = false } = props;
  const history = useStore((s) => s.history);
  const dayDate = useStore((s) => s.day.date);
  const phase = useStore((s) => s.phase);
  const curId = useStore((s) => s.current?.id ?? null);
  const today = todayKey();
  // The entry is pushed when the stick leaves the tube; don't spoil it before the reveal.
  const hideCurrent = phase === 'armed' || phase === 'drawing';
  const report = useMemo(
    () => weeklyReport(hideCurrent && curId ? history.filter((e) => e.draw.id !== curId) : history, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dayDate` is a cache key: recompute the report when the day rolls over
    [history, today, dayDate, hideCurrent, curId],
  );

  const summary = report.days.map((d, i) => `${COPY.weekly.days[i]}：${d.name ?? COPY.weekly.empty}`).join('，');

  return (
    <section aria-label={COPY.weekly.title} className={compact ? '' : 'row-card p-4'}>
      {!compact && <h3 className="mb-3 font-brush text-[19px] tracking-[0.15em] text-gold-soft">{COPY.weekly.title}</h3>}
      <ol className="flex items-end gap-2" aria-label={summary}>
        {report.days.map((d, i) => (
          <li key={d.date} className="flex flex-col items-center gap-1" aria-hidden="true">
            <span
              className="day-seal"
              data-filled={!!d.name}
              data-today={d.date === today}
              style={{ fontSize: d.name && Array.from(shortName(d.name)).length > 1 ? 14 : 18 }}
              title={d.name ?? COPY.weekly.empty}
            >
              {d.name ? shortName(d.name) : '·'}
            </span>
            <span className={`text-[11px] tracking-wider ${d.date === today ? 'text-gold-soft' : 'text-paper/55'}`}>
              {COPY.weekly.days[i]}
            </span>
          </li>
        ))}
      </ol>
      {report.line ? (
        <p className={`${compact ? 'mt-1.5 max-w-[260px] text-[12px]' : 'mt-3 text-[14px]'} leading-snug tracking-wide text-gold-soft`}>
          {report.line}
        </p>
      ) : null}
    </section>
  );
}
