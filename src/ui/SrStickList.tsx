/** Screen-reader-only list of the sticks in the tube (the canvas itself is aria-hidden). */
import { COPY } from '@/data/copy';
import { taglineFor } from '@/data/restaurants';
import { toChineseNumeral, todayKey } from '@/lib/date';
import { useStore } from '@/state/store';

export function SrStickList() {
  const restaurants = useStore((s) => s.restaurants);
  const today = todayKey();
  return (
    <section className="sr-only" aria-label={COPY.a11y.stickList}>
      <h2>{COPY.a11y.stickList}</h2>
      <ol>
        {restaurants.map((r, i) => (
          <li key={r.id}>
            第{toChineseNumeral(i + 1)}签：{r.name}，{taglineFor(r)}
            {r.closedOn === today ? `（${COPY.list.closedToday}）` : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}
