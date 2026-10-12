/** 天机可泄露: live odds per restaurant (exactly computeWeights) plus the fixed level / 筊 odds. */
import { useMemo } from 'react';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { LEVEL_ORDER, LEVELS } from '@/data/fortunes';
import { computeWeights, isTeamActive } from '@/draw/pick';
import { todayKey } from '@/lib/date';
import { useStore } from '@/state/store';
import { Drawer } from '@/ui/Drawer';

const pctText = (p: number): string => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p > 0 ? p.toFixed(2) : '0');

export function OddsPanel() {
  const list = useStore((s) => s.restaurants);
  const history = useStore((s) => s.history);
  const settings = useStore((s) => s.settings);
  const day = useStore((s) => s.day);
  const today = todayKey();
  const rows = useMemo(() => computeWeights({ list, history, settings, day, today }), [list, history, settings, day, today]);
  const max = Math.max(1e-6, ...rows.map((r) => r.pct));
  const team = isTeamActive(settings);
  const excluded = new Set(day.date === today ? day.excluded : []);

  return (
    <Drawer id="odds" title={COPY.odds.title} subtitle={COPY.odds.subtitle}>
      {team ? <p className="mb-3 rounded-xl border border-gold/25 px-3 py-2 text-[13px] text-gold-soft">{COPY.odds.teamNote}</p> : null}
      <table className="w-full border-separate border-spacing-y-1.5 text-[14px]">
        <caption className="sr-only">{COPY.odds.subtitle}</caption>
        <thead>
          <tr className="text-left text-[12px] tracking-widest text-paper/55">
            <th scope="col" className="font-normal">
              {COPY.odds.name}
            </th>
            <th scope="col" className="w-16 text-right font-normal">
              {COPY.odds.weight}
            </th>
            <th scope="col" className="w-[44%] pl-3 font-normal">
              {COPY.odds.pct}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const src = list.find((x) => x.id === r.id);
            const note = src?.closedOn === today ? COPY.odds.closed : excluded.has(r.id) ? COPY.odds.excluded : null;
            return (
              <tr key={r.id}>
                <th scope="row" className="truncate text-left font-normal">
                  <span className="font-brush text-[18px] text-gold-soft">{r.name}</span>
                  {note && !team ? <span className="ml-1.5 text-[11px] text-[#ffb3ab]">{note}</span> : null}
                </th>
                <td className="text-right tabular-nums text-paper/70">×{r.weight.toFixed(r.weight % 1 ? 2 : 0)}</td>
                <td className="pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper/10" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#b3121b] via-[#e8b64c] to-[#fff0b8]"
                        style={{ width: `${(r.pct / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums text-paper">{pctText(r.pct)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="section-title">{COPY.odds.levels}</h3>
      <ul className="grid grid-cols-2 gap-2">
        {LEVEL_ORDER.map((l) => (
          <li key={l} className="row-card flex items-center justify-between px-3 py-2">
            <span className="level-badge !text-[14px]" data-level={l}>
              {LEVELS[l].short}
            </span>
            <span className="tabular-nums text-paper/85">{Math.round(CFG.odds.level[l] * 100)}%</span>
          </li>
        ))}
        <li className="row-card flex items-center justify-between px-3 py-2">
          <span className="text-[13px] text-gold-soft">{COPY.reveal.treatBadge}</span>
          <span className="tabular-nums text-paper/85">{Math.round(CFG.odds.treat * 100)}%</span>
        </li>
      </ul>

      <h3 className="section-title">{COPY.jiaobei.title}</h3>
      <ul className="grid grid-cols-3 gap-2 text-center">
        {(['sheng', 'xiao', 'yin'] as const).map((o) => (
          <li key={o} className="row-card px-2 py-2.5">
            <div className="font-brush text-[18px] text-gold-soft">{COPY.jiaobei.name[o]}</div>
            <div className="text-[11px] leading-snug text-paper/55">{COPY.jiaobei.explain[o]}</div>
            <div className="mt-1 tabular-nums">{Math.round(CFG.odds.jiaobei[o] * 100)}%</div>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[12px] leading-relaxed text-paper/45">
        结果在开始摇签的一瞬间就由随机数决定，签筒和物理只是演出。最近吃过的降权（昨天 ×{CFG.antiRepeat.last}，近{' '}
        {CFG.antiRepeat.recentDays} 天 ×{CFG.antiRepeat.recent}），一周没去的冷宫餐馆 ×{CFG.antiRepeat.coldBonus}。
      </p>
    </Drawer>
  );
}
