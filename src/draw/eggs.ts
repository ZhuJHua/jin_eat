/** Easter eggs and the weekly report. */
import type { DrawResult, HistoryEntry } from '@/types';
import { COPY } from '@/data/copy';
import { addDays, isFriday, mondayOf } from '@/lib/date';
import { dayFinals } from '@/draw/pick';

/** Small line under the plaque: Friday swaps to milk tea. */
export function plaqueSubline(d: Date = new Date()): string {
  return isFriday(d) ? COPY.scene.plaqueSubFriday : COPY.scene.plaqueSub;
}

/**
 * Subline shown under the reveal heading, or null.
 * Priority: 请客签 → three draw-days in a row → 下下签 note.
 * `history` is expected to already contain `draw` (controller pushes it before reveal).
 */
export function revealSubline(history: HistoryEntry[], draw: DrawResult): string | null {
  if (draw.treat) return COPY.reveal.treatEgg;
  const withDraw = history.some((e) => e.draw.id === draw.id)
    ? history
    : [
        {
          draw,
          copy: { poem: ['', '', '', ''], jie: '', yi: '', ji: '', source: 'local' },
          confirmed: false,
          vetoed: false,
          jiaobei: [],
        } as HistoryEntry,
        ...history,
      ];
  const finals = dayFinals(withDraw);
  const last3 = finals.slice(0, 3);
  if (last3.length === 3 && last3.every((f) => f.restaurantId === draw.restaurantId)) return COPY.reveal.favoriteEgg;
  if (draw.level === 'xiaxia') return COPY.reveal.xiaxiaEgg;
  return null;
}

/** Mon–Fri of the current week with each day's final pick, plus the 「建议锦少约谈」 line. */
export function weeklyReport(
  history: HistoryEntry[],
  today: string,
): { days: { date: string; name: string | null }[]; line: string | null } {
  const monday = mondayOf(today);
  const dates = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  const finals = new Map(dayFinals(history).map((f) => [f.date, f.restaurantId]));
  const nameOf = new Map<string, string>();
  // Newest name wins (history may hold renamed entries).
  for (const e of history) if (!nameOf.has(e.draw.restaurantId)) nameOf.set(e.draw.restaurantId, e.draw.restaurantName);

  const days = dates.map((date) => {
    const id = finals.get(date);
    return { date, name: id ? (nameOf.get(id) ?? null) : null };
  });

  const counts = new Map<string, number>();
  for (const d of days) if (d.name) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  let line: string | null = null;
  let best = 0;
  for (const [name, n] of counts) {
    if (n >= 3 && n > best) {
      best = n;
      line = COPY.weekly.over(name, n);
    }
  }
  return { days, line };
}
