/** Desktop hover tooltip over a stick tip: number, name and tagline. Follows the cursor. */
import { useEffect, useState } from 'react';
import { taglineFor } from '@/data/restaurants';
import { toChineseNumeral } from '@/lib/date';
import { useStore } from '@/state/store';
import { Q_FINE, useMedia } from '@/ui/hooks';

export function StickTooltip() {
  const hoverId = useStore((s) => s.hoverStickId);
  const restaurants = useStore((s) => s.restaurants);
  const phase = useStore((s) => s.phase);
  const drawer = useStore((s) => s.drawer);
  const fine = useMedia(Q_FINE);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!fine) return;
    let raf = 0;
    let last: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setPos(last);
        });
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [fine]);

  if (!fine || !hoverId || !pos || drawer !== null || (phase !== 'idle' && phase !== 'armed')) return null;
  const index = restaurants.findIndex((r) => r.id === hoverId);
  const r = restaurants[index];
  if (!r) return null;
  const flip = pos.x > window.innerWidth - 260;

  return (
    <div
      className="stick-tip lacquer rounded-2xl px-4 py-2.5"
      style={{ left: pos.x, top: pos.y, transform: flip ? 'translate(calc(-100% - 16px), -50%)' : undefined }}
      aria-hidden="true"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] tracking-widest text-gold/80">第{toChineseNumeral(index + 1)}签</span>
        <span className="font-brush text-[22px] leading-none text-gold-soft">{r.name}</span>
      </div>
      <div className="mt-1 text-[12px] tracking-wider text-paper/75">{taglineFor(r)}</div>
    </div>
  );
}
