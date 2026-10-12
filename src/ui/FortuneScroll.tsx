/**
 * 签文 scroll shown on reveal (and during 掷筊). Desktop / landscape: docked right with an unrolling
 * paper between two rollers. Portrait: a bottom sheet (max 62dvh) with a drag handle that collapses
 * to a peek so the stick stays visible. The heading receives focus on reveal.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DrawResult, FortuneCopy, JiaobeiOutcome, Restaurant } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { LEVELS } from '@/data/fortunes';
import { taglineFor } from '@/data/restaurants';
import { confirm, reshake, skipJiaobei, throwJiaobei, veto } from '@/draw/controller';
import { revealSubline } from '@/draw/eggs';
import { isTeamActive } from '@/draw/pick';
import { bus } from '@/lib/bus';
import { parseDayKey, shortDateZh, toChineseNumeral, weekdayZh } from '@/lib/date';
import { holdFullRate } from '@/engine/loop';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { useScrollLayout, usePrevious } from '@/ui/hooks';
import { IconRefresh, IconShare, JiaobeiGlyph } from '@/ui/Icons';
import { SealStamp } from '@/ui/SealStamp';

const SLAM_DELAY = 1.45;

function faces(o: JiaobeiOutcome): ['flat' | 'round', 'flat' | 'round'] {
  if (o === 'xiao') return ['flat', 'flat'];
  if (o === 'yin') return ['round', 'round'];
  return ['flat', 'round'];
}

function restaurantFor(list: Restaurant[], d: DrawResult): Restaurant {
  return list.find((r) => r.id === d.restaurantId) ?? { id: d.restaurantId, name: d.restaurantName, weight: 1, closedOn: null };
}

export function FortuneScroll() {
  const phase = useStore((s) => s.phase);
  const current = useStore((s) => s.current);
  const copy = useStore((s) => s.copy);
  if (!current || !copy || (phase !== 'reveal' && phase !== 'jiaobei')) return null;
  return <ScrollCard key={current.id} draw={current} copy={copy} />;
}

function ScrollCard({ draw, copy }: { draw: DrawResult; copy: FortuneCopy }) {
  const phase = useStore((s) => s.phase);
  const history = useStore((s) => s.history);
  const restaurants = useStore((s) => s.restaurants);
  const day = useStore((s) => s.day);
  const settings = useStore((s) => s.settings);
  const jiaobeiResult = useStore((s) => s.jiaobeiResult);
  const reduced = useStore((s) => s.reducedMotion);
  const drawer = useStore((s) => s.drawer);
  const openDrawer = useStore((s) => s.openDrawer);
  const layout = useScrollLayout();
  const prevPhase = usePrevious(phase);

  const dockRef = useRef<HTMLElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const jiaobeiRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const [collapsed, setCollapsed] = useState(false);
  // The entrance animation plays once per draw (the component is keyed by draw id).
  const [anim] = useState<string>(() => (reduced ? 'fade' : layout === 'bottom' ? 'unroll-up' : 'unroll'));

  const locked = day.lockedDrawId === draw.id;
  const team = !!draw.team || isTeamActive(settings);
  const restaurant = restaurantFor(restaurants, draw);
  const level = LEVELS[draw.level];
  const no = toChineseNumeral(draw.stickNo);
  const subline = useMemo(() => revealSubline(history, draw), [history, draw]);
  const entry = history.find((e) => e.draw.id === draw.id);
  const throwing = phase === 'jiaobei' && jiaobeiResult === null;
  const dateObj = parseDayKey(draw.date);

  // Measure for the unroll keyframes (before paint) and the peek height.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const paper = paperRef.current;
    const head = headRef.current;
    if (!dock || !paper) return;
    dock.style.setProperty('--unroll-h', `${Math.round(paper.getBoundingClientRect().height)}px`);
    if (head) {
      const top = dock.getBoundingClientRect().top;
      const peek = Math.round(head.getBoundingClientRect().bottom - top + 14);
      dock.style.setProperty('--peek', `${Math.max(120, peek)}px`);
    }
  }, [layout]);

  // Collapse the bottom sheet while the 筊 are in the air so the throw is visible.
  useEffect(() => {
    if (layout !== 'bottom') return;
    if (throwing) {
      setCollapsed(true);
      paperRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    } else if (phase === 'jiaobei' || prevPhase === 'jiaobei') setCollapsed(false);
  }, [throwing, phase, prevPhase, layout, reduced]);

  // Keep the 掷筊 panel (result line, 再掷 / 跳过) in view inside the paper: once when it opens (after the
  // poem folds away) and again when the result lands.
  useEffect(() => {
    if (phase !== 'jiaobei') return;
    const reveal = (): void => {
      const paper = paperRef.current;
      const el = panelRef.current;
      if (!paper || !el) return;
      const pr = paper.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const below = er.bottom - pr.bottom + 18;
      const above = er.top - pr.top - 12;
      const dy = below > 0 ? Math.min(below, above) : 0;
      if (dy > 1) paper.scrollBy({ top: dy, behavior: reduced ? 'auto' : 'smooth' });
    };
    const t1 = window.setTimeout(reveal, 80);
    const t2 = window.setTimeout(reveal, 480);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [phase, jiaobeiResult, collapsed, reduced]);

  // Camera dock (read by the 3D CameraRig) follows the scroll layout.
  useEffect(() => {
    rt.camera.dock = layout === 'bottom' ? (collapsed ? 'none' : 'bottom') : 'right';
    holdFullRate(900);
  }, [layout, collapsed]);
  useEffect(
    () => () => {
      rt.camera.dock = 'none';
    },
    [],
  );

  // Back from 掷筊 (圣筊 locks it, or 跳过): roll the paper back up to the heading and its 今日已定 seal.
  useEffect(() => {
    if (phase === 'reveal' && prevPhase === 'jiaobei') paperRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [phase, prevPhase, reduced]);

  // Focus: heading on reveal, the 掷筊 panel title while throwing.
  useEffect(() => {
    if (drawer !== null) return;
    if (phase === 'reveal' && prevPhase !== 'reveal') headingRef.current?.focus({ preventScroll: true });
    if (phase === 'jiaobei' && prevPhase !== 'jiaobei') jiaobeiRef.current?.focus({ preventScroll: true });
  }, [phase, prevPhase, drawer]);

  // The seal lands with a soft thunk.
  useEffect(() => {
    if (reduced) return;
    const t = window.setTimeout(() => bus.emit('thunk', { force: 0.45 }), (SLAM_DELAY + 0.18) * 1000);
    return () => window.clearTimeout(t);
  }, [reduced]);

  // Drag handle (bottom sheet).
  const drag = useRef<{ id: number; y0: number; dy: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dy = e.clientY - d.y0;
  };
  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.dy > 50 || (Math.abs(d.dy) <= 30 && !collapsed)) paperRef.current?.scrollTo({ top: 0 });
    if (d.dy > 50) setCollapsed(true);
    else if (d.dy < -30) setCollapsed(false);
    else setCollapsed((c) => !c);
  };

  const shareOpen = (): void => openDrawer('share');

  return (
    <section
      ref={dockRef}
      className="scroll-dock"
      data-layout={layout}
      data-anim={anim}
      data-collapsed={layout === 'bottom' && collapsed}
      aria-labelledby={headingId}
    >
      <div className="scroll-body">
        <div className={`scroll-roller is-top ${layout === 'bottom' ? 'mx-1' : ''}`} aria-hidden="true" />
        <div ref={paperRef} className="scroll-paper" onScroll={() => holdFullRate(200)}>
          {layout === 'bottom' ? (
            <button
              type="button"
              className="sheet-handle"
              aria-expanded={!collapsed}
              aria-label={collapsed ? '展开签文' : '收起签文'}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onClick={(e) => {
                if (e.detail === 0) setCollapsed((c) => !c);
              }}
            />
          ) : null}

          <div className="scroll-inner" data-compact={phase === 'jiaobei'}>
            <div ref={headRef} className={`relative px-7 text-center ${layout === 'bottom' ? 'pt-1' : 'pt-7'}`}>
              <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex flex-col items-center gap-1.5 outline-none">
                <span className="flex items-center gap-2.5">
                  <span className="font-brush text-[22px] tracking-[0.18em] text-[#5a2416]">{COPY.reveal.stickNo(no)}</span>
                  <span className="level-badge" data-level={draw.level}>
                    {level.label}
                  </span>
                </span>
                <span className={`fortune-name ${Array.from(draw.restaurantName).length > 5 ? 'text-[44px]' : 'text-[60px]'}`}>
                  {draw.restaurantName}
                </span>
              </h2>
              <svg className="brush-underline mx-auto w-[220px]" viewBox="0 0 220 14" aria-hidden="true" preserveAspectRatio="none">
                <path d="M6 9 C 50 3, 120 12, 214 5" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              </svg>
              <p className="reveal-rise mt-1 text-[13px] tracking-[0.2em] text-[#6b3a22]" style={{ '--i': 0 } as React.CSSProperties}>
                {taglineFor(restaurant)}
              </p>
              {locked ? (
                <div className="pointer-events-none absolute right-5 top-4" aria-hidden="true">
                  <SealStamp text="今日已定" size={58} slam={!reduced} delay={0} />
                </div>
              ) : null}
            </div>

            <div className="relative px-6 pb-6 pt-3">
              {/* Badges & eggs */}
              <div className="flex flex-col items-center gap-2">
                {locked ? (
                  <p
                    className="locked-banner reveal-rise w-full py-1.5 text-center font-brush text-[20px] tracking-[0.12em]"
                    style={{ '--i': 1 } as React.CSSProperties}
                  >
                    {COPY.reveal.lockedBanner(draw.restaurantName)}
                  </p>
                ) : null}
                {draw.treat ? (
                  <p className="level-badge reveal-rise" data-level="shangshang" style={{ '--i': 1 } as React.CSSProperties}>
                    {COPY.reveal.treatBadge}
                  </p>
                ) : null}
                {draw.team ? (
                  <p
                    className="reveal-rise rounded-full border border-[#8f0d14]/30 px-3 py-0.5 text-[12px] tracking-[0.18em] text-[#8f0d14]"
                    style={{ '--i': 1 } as React.CSSProperties}
                  >
                    {COPY.reveal.teamBadge} · {draw.team}
                  </p>
                ) : null}
                {subline ? (
                  <p
                    className="egg-line reveal-rise w-full py-1 text-center font-brush text-[17px] tracking-[0.06em]"
                    style={{ '--i': 2 } as React.CSSProperties}
                  >
                    {subline}
                  </p>
                ) : null}
              </div>

              {/* Poem (folds away during 掷筊 so the ritual panel fits without scrolling) */}
              <div className="poem-fold">
                <div className="min-h-0 overflow-hidden">
                  <div className="relative mt-4 flex justify-center">
                    <div className="poem" role="group" aria-label="签诗">
                      {copy.poem.map((line, i) => (
                        <p key={i} style={{ '--i': i } as React.CSSProperties}>
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rule-ink my-4" aria-hidden="true" />
                </div>
              </div>

              {/* 解曰 / 宜 / 忌 */}
              <div className="reveal-rise" style={{ '--i': 3 } as React.CSSProperties}>
                <p className="text-[15px] leading-relaxed text-paper-ink">
                  <span className="mr-2 font-brush text-[20px] text-[#8f0d14]">{COPY.reveal.jieLabel}</span>
                  {copy.jie}
                </p>
                <div className="relative">
                  <div className="pointer-events-none absolute -top-2 right-1">
                    <SealStamp size={58} slam={!reduced} delay={SLAM_DELAY} />
                  </div>
                  <div className="yi-ji mt-3 pr-16 text-paper-ink">
                    <span className="mark yi" aria-hidden="true">
                      {COPY.reveal.yiLabel}
                    </span>
                    <span>
                      <span className="sr-only">{COPY.reveal.yiLabel}：</span>
                      {copy.yi}
                    </span>
                    <span className="mark ji" aria-hidden="true">
                      {COPY.reveal.jiLabel}
                    </span>
                    <span>
                      <span className="sr-only">{COPY.reveal.jiLabel}：</span>
                      {copy.ji}
                    </span>
                  </div>
                </div>
              </div>

              {phase === 'jiaobei' ? (
                <JiaobeiPanel
                  panelRef={panelRef}
                  headingRef={jiaobeiRef}
                  result={jiaobeiResult}
                  streak={day.xiaoStreak}
                  reduced={reduced}
                  history={entry?.jiaobei ?? []}
                />
              ) : null}

              <footer className="mt-5 flex items-center justify-between text-[12px] tracking-wider text-[#6b3a22]/85">
                <span>
                  {shortDateZh(draw.date)} {Number.isNaN(dateObj.getTime()) ? '' : weekdayZh(dateObj)}
                </span>
                <span className="font-brush text-[15px]">{COPY.app.credit}</span>
              </footer>
            </div>

            {/* Actions: pinned to the bottom of the paper so the next step is always on screen. */}
            {phase !== 'jiaobei' ? (
              <div className="scroll-actions reveal-rise" data-layout={layout} style={{ '--i': 4 } as React.CSSProperties}>
                <div className="flex gap-2.5">
                  {!locked ? (
                    <button type="button" className="btn scroll-action-primary h-12 flex-[1.4] tracking-[0.3em]" onClick={confirm}>
                      <span className="font-brush text-[22px] font-normal">{COPY.actions.confirm}</span>
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ink h-12 flex-1" onClick={reshake} aria-keyshortcuts="R">
                    <IconRefresh size={18} />
                    {COPY.actions.reshake}
                  </button>
                  {locked ? (
                    <button
                      type="button"
                      className="btn btn-ink h-12 flex-1"
                      onClick={shareOpen}
                      aria-keyshortcuts="S"
                      aria-haspopup="dialog"
                    >
                      <IconShare size={18} />
                      {COPY.actions.share}
                    </button>
                  ) : null}
                </div>
                {!locked ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ink btn-sm flex-none"
                      onClick={shareOpen}
                      aria-keyshortcuts="S"
                      aria-haspopup="dialog"
                      aria-label={COPY.actions.share}
                    >
                      <IconShare size={16} />
                      {COPY.actions.shareShort}
                    </button>
                    {settings.ritualJiaobei ? (
                      <button
                        type="button"
                        className="btn btn-ink btn-sm min-w-0 flex-1"
                        onClick={throwJiaobei}
                        aria-keyshortcuts="J"
                        aria-label={COPY.actions.jiaobei}
                      >
                        <JiaobeiGlyph face="round" size={20} />
                        <span className="truncate">{COPY.actions.jiaobeiShort}</span>
                      </button>
                    ) : null}
                    {!team ? (
                      <button
                        type="button"
                        className={`btn btn-ink btn-sm !border-[#8f0d14]/40 !text-[#8f0d14] ${settings.ritualJiaobei ? 'flex-none' : 'flex-1'}`}
                        onClick={veto}
                        disabled={day.vetoUsed}
                        aria-label={day.vetoUsed ? COPY.actions.vetoUsed : COPY.actions.veto}
                      >
                        {day.vetoUsed ? COPY.actions.vetoUsedShort : COPY.actions.vetoShort}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {layout !== 'bottom' ? <div className="scroll-roller is-bottom" aria-hidden="true" /> : null}
      </div>
    </section>
  );
}

function JiaobeiPanel(props: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  result: JiaobeiOutcome | null;
  streak: number;
  reduced: boolean;
  history: JiaobeiOutcome[];
}) {
  const { panelRef, headingRef, result, streak, reduced, history } = props;
  const [a, b] = result ? faces(result) : (['flat', 'round'] as const);
  return (
    <div ref={panelRef} className="mt-5 rounded-2xl border border-[#8f0d14]/25 bg-[#8f0d14]/[0.05] p-4 text-center" aria-live="off">
      <h3 ref={headingRef} tabIndex={-1} className="font-brush text-[22px] tracking-[0.2em] text-[#8f0d14] outline-none">
        {COPY.jiaobei.title}
      </h3>
      <div className="mt-3 flex items-center justify-center gap-5" aria-hidden="true">
        <span className={result || reduced ? '' : 'inline-block animate-bounce'}>
          <JiaobeiGlyph face={a} size={58} />
        </span>
        <span className={result || reduced ? '' : 'inline-block animate-bounce [animation-delay:120ms]'}>
          <JiaobeiGlyph face={b} size={58} />
        </span>
      </div>
      {result ? (
        <div className="mt-2">
          <p className="font-brush text-[24px] text-[#8f0d14]">{COPY.jiaobei.name[result]}</p>
          <p className="text-[13px] tracking-wider text-[#6b3a22]">{COPY.jiaobei.explain[result]}</p>
          <p className="mt-1 font-brush text-[18px] text-paper-ink">{COPY.jiaobei.result[result]}</p>
        </div>
      ) : (
        <p className="mt-2 text-[14px] tracking-wider text-[#6b3a22]">{COPY.jiaobei.throwing}</p>
      )}
      {history.length > 0 ? (
        <p className="mt-2 text-[12px] tracking-wider text-[#6b3a22]/80">
          已掷：{history.map((o) => COPY.jiaobei.name[o]).join(' · ')}
          {streak > 0 ? `（笑筊 ${streak}/${CFG.limits.xiaoForceAccept}）` : ''}
        </p>
      ) : null}
      <div className="mt-3 flex justify-center gap-2.5">
        {result === 'xiao' ? (
          <button type="button" className="btn scroll-action-primary btn-sm px-6" onClick={throwJiaobei} aria-keyshortcuts="J">
            {COPY.jiaobei.again}
          </button>
        ) : null}
        <button type="button" className="btn btn-ink btn-sm px-6" onClick={skipJiaobei}>
          {COPY.jiaobei.skip}
        </button>
      </div>
    </div>
  );
}
