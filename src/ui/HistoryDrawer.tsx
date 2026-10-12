/** 签簿: last 14 days of draws grouped by date, the weekly report, anti-repeat and 清空. */
import { useMemo, useState } from 'react';
import type { HistoryEntry } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { LEVELS } from '@/data/fortunes';
import { addDays, parseDayKey, shortDateZh, toChineseNumeral, todayKey, weekdayZh } from '@/lib/date';
import { useStore } from '@/state/store';
import { Drawer, SwitchRow } from '@/ui/Drawer';
import { WeeklyStrip } from '@/ui/WeeklyStrip';

function groupByDate(history: HistoryEntry[], since: string): { date: string; entries: HistoryEntry[] }[] {
  const map = new Map<string, HistoryEntry[]>();
  for (const e of history) {
    if (e.draw.date < since) continue;
    const list = map.get(e.draw.date) ?? [];
    list.push(e);
    map.set(e.draw.date, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => b.draw.ts - a.draw.ts) }));
}

function dayLabel(date: string, today: string): string {
  if (date === today) return `今天 · ${shortDateZh(date)}`;
  if (date === addDays(today, -1)) return `昨天 · ${shortDateZh(date)}`;
  const d = parseDayKey(date);
  return `${shortDateZh(date)} · ${Number.isNaN(d.getTime()) ? '' : weekdayZh(d)}`;
}

export function HistoryDrawer() {
  const history = useStore((s) => s.history);
  const antiRepeat = useStore((s) => s.settings.antiRepeat);
  const updateSettings = useStore((s) => s.updateSettings);
  const clearHistory = useStore((s) => s.clearHistory);
  const showToast = useStore((s) => s.showToast);
  const lockedId = useStore((s) => s.day.lockedDrawId);
  const [confirming, setConfirming] = useState(false);
  const today = todayKey();
  const groups = useMemo(() => groupByDate(history, addDays(today, -(CFG.limits.historyDays - 1))), [history, today]);

  return (
    <Drawer id="history" title={COPY.history.title} subtitle={COPY.history.daysShown}>
      <WeeklyStrip />

      <div className="row-card mt-3 px-4">
        <SwitchRow
          label={COPY.history.antiRepeat}
          hint={COPY.history.antiRepeatHint}
          checked={antiRepeat}
          onChange={(v) => updateSettings({ antiRepeat: v })}
        />
      </div>

      {groups.length === 0 ? (
        <p className="mt-10 text-center font-brush text-[20px] tracking-[0.12em] text-paper/60">{COPY.history.empty}</p>
      ) : (
        <div className="mt-2">
          {groups.map((g) => (
            <section key={g.date} aria-labelledby={`h-${g.date}`}>
              <h3 id={`h-${g.date}`} className="section-title !text-[17px]">
                {dayLabel(g.date, today)}
              </h3>
              <ul className="flex flex-col gap-2">
                {g.entries.map((e) => (
                  <Entry key={e.draw.id} e={e} locked={e.draw.id === lockedId} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {history.length > 0 ? (
        <div className="mt-6">
          {confirming ? (
            <div className="row-card flex flex-col gap-3 p-4" role="group" aria-label={COPY.history.clear}>
              <p className="text-[14px] text-paper/85">{COPY.history.clearConfirm}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-cinnabar flex-1"
                  onClick={() => {
                    clearHistory();
                    setConfirming(false);
                    showToast(COPY.toast.historyCleared);
                  }}
                >
                  {COPY.history.clear}
                </button>
                <button type="button" className="btn btn-ghost flex-1" onClick={() => setConfirming(false)} autoFocus>
                  {COPY.actions.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost w-full" onClick={() => setConfirming(true)}>
              {COPY.history.clear}
            </button>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

function Entry({ e, locked }: { e: HistoryEntry; locked: boolean }) {
  const d = e.draw;
  const time = new Date(d.ts);
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  return (
    <li className={`row-card relative overflow-hidden p-3 ${e.vetoed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-[12px] tracking-widest text-gold/80">第{toChineseNumeral(d.stickNo)}签</span>
        <span className="level-badge !px-2 !py-0 !text-[13px]" data-level={d.level}>
          {LEVELS[d.level].short}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-brush text-[20px] ${e.vetoed ? 'line-through decoration-[#ff8f86]/70' : 'text-gold-soft'}`}
        >
          {d.restaurantName}
        </span>
        <span className="flex-none text-[11px] tabular-nums text-paper/45">{hhmm}</span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-paper/70">{e.copy.jie}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] tracking-wider">
        {e.confirmed ? (
          <span className="rounded-md bg-cinnabar/80 px-1.5 py-0.5 text-gold-soft">
            {COPY.history.confirmed}
            {locked ? ' · 今日' : ''}
          </span>
        ) : null}
        {e.vetoed ? (
          <span className="rounded-md border border-[#ff8f86]/50 px-1.5 py-0.5 text-[#ffb3ab]">{COPY.history.vetoed}</span>
        ) : null}
        {d.treat ? <span className="rounded-md bg-gold/80 px-1.5 py-0.5 text-ink">{COPY.reveal.treatBadge}</span> : null}
        {d.team ? <span className="rounded-md border border-gold/30 px-1.5 py-0.5 text-paper/70">共签 · {d.team}</span> : null}
        {e.jiaobei.map((o, i) => (
          <span key={i} className="rounded-md border border-gold/20 px-1.5 py-0.5 text-paper/65">
            {COPY.jiaobei.name[o]}
          </span>
        ))}
      </div>
    </li>
  );
}
