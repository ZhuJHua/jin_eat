/** Top-left title block (brush title, subtitle, team badge) and the bottom-left 本周战报 card on wide screens. */
import { useMemo } from 'react';
import { COPY } from '@/data/copy';
import { listSignature } from '@/data/restaurants';
import { plaqueSubline } from '@/draw/eggs';
import { isTeamActive } from '@/draw/pick';
import { useStore } from '@/state/store';
import { Q_DESKTOP, Q_WIDE, useMedia, useScrollLayout } from '@/ui/hooks';
import { WeeklyStrip } from '@/ui/WeeklyStrip';
import { setSettingsSection } from '@/ui/intent';

export function Header() {
  const settings = useStore((s) => s.settings);
  const restaurants = useStore((s) => s.restaurants);
  const openDrawer = useStore((s) => s.openDrawer);
  const dayDate = useStore((s) => s.day.date);
  const desk = useMedia(Q_DESKTOP);
  const short = useMedia('(max-height: 520px)');
  const toastOn = useStore((s) => s.toast !== null);
  const phase = useStore((s) => s.phase);
  const layout = useScrollLayout();
  const revealing = phase === 'reveal' || phase === 'jiaobei';
  // Portrait and phone-landscape reveal: the stick owns the top of the screen. On phones a toast
  // replaces the title for its few seconds instead of overprinting it.
  const tucked = (revealing && (layout === 'bottom' || short)) || (toastOn && !desk);
  const team = isTeamActive(settings);
  const sig = useMemo(() => listSignature(restaurants), [restaurants]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `dayDate` is a cache key: the subline depends on the current day
  const subline = useMemo(() => plaqueSubline(), [dayDate]);

  return (
    <header
      className={`pass absolute left-0 top-0 flex flex-col items-start gap-3 pt-[calc(var(--sat)+14px)] transition-opacity duration-500 [@media(max-height:700px)_and_(orientation:portrait)]:pt-[calc(var(--sat)+9px)] ${tucked ? 'pointer-events-none opacity-0' : ''}`}
      aria-hidden={tucked || undefined}
      style={{ paddingLeft: 'calc(var(--sal) + 18px)', paddingRight: 'calc(var(--sar) + 18px)' }}
    >
      <div className="pointer-events-none mb-2 select-none">
        <h1 className="font-brush text-[clamp(24px,6.4vw,40px)] leading-[1.1] short:text-[26px] [@media(max-height:700px)_and_(orientation:portrait)]:text-[21px] tracking-[0.04em] text-gold-soft text-glow-gold">
          {COPY.app.title}
        </h1>
        {/* Short portrait screens: the 3D plaque sits right under the title, so the subtitle steps aside.
            Narrow screens drop the brush subline (the plaque's red tablet already carries it). */}
        <p className="mt-1 flex items-center gap-2 text-[12px] tracking-[0.32em] text-paper/75 sm:text-[13px] [@media(max-height:700px)_and_(orientation:portrait)]:hidden">
          <span>{COPY.app.subtitle}</span>
          <span aria-hidden="true" className="hidden h-1 w-1 rotate-45 bg-gold/70 sm:inline-block short:hidden" />
          <span className="hidden font-brush text-[14px] tracking-[0.2em] text-gold/85 sm:inline sm:text-[15px] short:hidden">
            {subline}
          </span>
        </p>
        {team ? (
          <button
            type="button"
            className="chip lacquer-soft pointer-events-auto mt-2.5 !py-1.5 text-[12px]"
            onClick={() => {
              setSettingsSection('team');
              openDrawer('settings');
            }}
            aria-label={`${COPY.reveal.teamBadge}：${settings.teamPhrase}，${COPY.settings.teamFingerprint(sig)}`}
          >
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-gold shadow-[0_0_8px_rgb(232_182_76/0.9)]" />
            <span className="max-w-[44vw] truncate">共签 · {settings.teamPhrase}</span>
            <span className="font-mono text-[11px] text-gold/80">#{sig}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

/**
 * 本周战报 on wide screens: bottom-left, above the control bar (which docks bottom-left on desktop),
 * so it never hides the couplets or the lantern behind the title.
 */
export function WeeklyCard() {
  const wide = useMedia(Q_WIDE);
  // The 掷筊 shot looks down at the altar's front edge: step aside for the blocks.
  const away = useStore((s) => s.phase === 'jiaobei');
  if (!wide) return null;
  return (
    <div
      className={`lacquer-soft absolute rounded-2xl px-3.5 py-2.5 transition-opacity duration-500 ${away ? 'pointer-events-none opacity-0' : ''}`}
      aria-hidden={away || undefined}
      style={{ left: 'calc(var(--sal) + 22px)', bottom: 'calc(var(--sab) + 96px)' }}
    >
      <div className="mb-1.5 font-brush text-[15px] tracking-[0.2em] text-gold/90">{COPY.weekly.title}</div>
      <WeeklyStrip compact />
    </div>
  );
}
