/**
 * 2D shrine (no WebGL, or 画质「2D」): a CSS-3D lacquer tube made of 24 rotated panels with the sticks
 * inside, the plaque, couplets, lanterns, altar and burning incense. Same store, controller, audio,
 * scroll and sharing as the 3D stage. The master loop drives the stick jitter through CSS transforms;
 * the draw / return / 掷筊 choreography uses keyframes and reports back to the controller.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { plaqueSubline } from '@/draw/eggs';
import { onDrawingDone, onJiaobeiDone, onResetDone } from '@/draw/controller';
import { JIAOBEI_DURATION, JIAOBEI_TIMING, faceUp } from '@/draw/jiaobei';
import { registerRenderer } from '@/engine/loop';
import { bus, EMPTY } from '@/lib/bus';
import { toChineseNumeral } from '@/lib/date';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { attachPointerShake } from '@/sensors/pointer';
import { useScrollLayout } from '@/ui/hooks';
import { hidePoster } from '@/ui/intent';
import { JiaobeiGlyph } from '@/ui/Icons';

const PANELS = 24;
const TUBE_R = 66;
const CREEP_S = CFG.timeline.creep;
const HOLD_S = CFG.timeline.hold;
const TEASE_S = CFG.timeline.tease;
const EJECT_S = 2.55;
const RISE_PX = 100;

type HeroState = 'hidden' | 'eject' | 'eject-reduced' | 'landed' | 'return' | 'return-reduced';

interface StickSlot {
  x: number;
  z: number;
  lean: number;
  leanX: number;
  phase: number;
  freq: number;
}

function layoutSticks(n: number): StickSlot[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: StickSlot[] = [];
  for (let i = 0; i < n; i++) {
    const r = 44 * Math.sqrt((i + 0.5) / Math.max(1, n));
    const a = i * golden + 0.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    out.push({ x, z, lean: (x / 44) * 5, leanX: (-z / 44) * 4, phase: i * 1.7, freq: 31 + ((i * 7) % 11) });
  }
  return out;
}

/** Tiny deterministic PRNG for decorative dust. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function Fallback2D() {
  const phase = useStore((s) => s.phase);
  const current = useStore((s) => s.current);
  const count = useStore((s) => s.restaurants.length);
  const reduced = useStore((s) => s.reducedMotion);
  const meter = useStore((s) => s.meterMirror);
  const vetoUsed = useStore((s) => s.day.vetoUsed);
  const dayDate = useStore((s) => s.day.date);
  const jiaobeiResult = useStore((s) => s.jiaobeiResult);
  const layout = useScrollLayout();

  const tubeRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const stickRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slots = useMemo(() => layoutSticks(count), [count]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const [hero, setHero] = useState<HeroState>('hidden');
  const [glow, setGlow] = useState(0);
  const [flash, setFlash] = useState(0);
  const [blocks, setBlocks] = useState<{ key: number; faces: ['flat' | 'round', 'flat' | 'round']; animate: boolean } | null>(null);

  /** Choreography clock shared with the renderer (performance.now ms). */
  const show = useRef({ drawT0: -1, tease: false, decoy: -1, heroIndex: -1, sinkT0: -1 });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `dayDate` is a cache key: the subline depends on the current day
  const subline = useMemo(() => plaqueSubline(), [dayDate]);
  const dust = useMemo(() => {
    const rnd = lcg(20261012);
    return Array.from({ length: 18 }, () => ({
      left: `${8 + rnd() * 84}%`,
      bottom: `${10 + rnd() * 40}%`,
      dur: `${10 + rnd() * 10}s`,
      delay: `${-rnd() * 20}s`,
      dx: `${(rnd() - 0.5) * 80}px`,
    }));
  }, []);

  useEffect(() => {
    hidePoster();
  }, []);

  // ── Per-frame painter: tube wobble + stick jitter + creep/tease offsets. ──
  useEffect(() => {
    const paint = (ts: number): void => {
      const tube = tubeRef.current;
      if (!tube) return;
      const t = ts / 1000;
      const auto = rt.input.auto.active ? 0.55 : 0;
      const grab = rt.input.pointer.grabbing ? Math.min(1, rt.input.pointer.mag / 12 + 0.25) : 0;
      const e = Math.min(1, Math.max(rt.shake.energy, auto, grab));
      const sh = show.current;
      const st = useStore.getState();
      const drawing = st.phase === 'drawing';
      const rm = st.reducedMotion;
      const k = rm ? 0.3 : 1;

      let sx = Math.sin(t * 41) * e * 9 * k + Math.sin(t * 7.3) * e * 4 * k;
      const sy = -Math.abs(Math.sin(t * 23)) * e * 4 * k;
      let sr = Math.sin(t * 37 + 1) * e * 5 * k;
      if (rt.input.pointer.grabbing) {
        sx += rt.input.pointer.ndc[0] * 26;
        sr += rt.input.pointer.ndc[0] * 6;
      }
      let tilt = 0;
      const since = sh.drawT0 >= 0 ? (ts - sh.drawT0) / 1000 : -1;
      if (drawing && since >= 0) tilt = Math.min(1, since / CFG.timeline.tilt) * (rm ? 4 : 10);
      tube.style.setProperty('--sx', `${sx.toFixed(2)}px`);
      tube.style.setProperty('--sy', `${sy.toFixed(2)}px`);
      tube.style.setProperty('--sr', `${sr.toFixed(2)}deg`);
      tube.style.transform = `translate3d(var(--sx), var(--sy), 0) rotateZ(var(--sr)) rotateX(${(-14 - tilt).toFixed(2)}deg)`;

      let sink = 0;
      if (sh.sinkT0 >= 0) {
        const u = Math.min(1, (ts - sh.sinkT0) / 320);
        sink = (1 - easeInOut(u)) * RISE_PX * 0.8;
        if (u >= 1) sh.sinkT0 = -1;
      }

      const ss = slotsRef.current;
      for (let i = 0; i < ss.length; i++) {
        const el = stickRefs.current[i];
        const s = ss[i];
        if (!el || !s) continue;
        const jig = e * k;
        let lift = -Math.abs(Math.sin(t * s.freq * 0.5 + s.phase)) * jig * 16;
        const wig = Math.sin(t * s.freq * 0.37 + s.phase) * jig * 4;
        if (drawing && since >= 0 && !rm) {
          if (sh.tease && i === sh.decoy && since < TEASE_S) lift -= Math.pow(Math.sin((Math.PI * since) / TEASE_S), 1.5) * RISE_PX * 0.6;
          if (i === sh.heroIndex) {
            const tt = since - (sh.tease ? TEASE_S : 0);
            if (tt > 0) lift -= easeInOut(Math.min(1, tt / CREEP_S)) * RISE_PX + (tt < CREEP_S ? Math.sin(tt * 60) * 1.2 : 0);
          }
        }
        if (sink > 0 && i === sh.heroIndex) lift -= sink;
        el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${lift.toFixed(2)}px, ${s.z.toFixed(1)}px) rotateZ(${(s.lean + wig).toFixed(2)}deg) rotateX(${s.leanX.toFixed(2)}deg)`;
      }
    };
    registerRenderer(paint);
    return () => registerRenderer(null);
  }, []);

  // ── Pointer grab + wiggle on the tube. ──
  useEffect(() => {
    const el = hitRef.current;
    if (!el) return;
    return attachPointerShake(el, () => true);
  }, []);

  // ── Drawing choreography. ──
  useEffect(() => {
    if (phase !== 'drawing' || !current) return;
    const sh = show.current;
    sh.drawT0 = performance.now();
    sh.tease = current.tease && current.decoyIndex !== null && !reduced;
    sh.decoy = current.decoyIndex ?? -1;
    sh.heroIndex = current.index;
    sh.sinkT0 = -1;
    setHero('hidden');
    setGlow(0);
    const timers: number[] = [];
    const at = (s: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, s * 1000));
    };

    if (reduced) {
      at(CFG.timeline.reduced.tilt, () => {
        setHero('eject-reduced');
      });
      at(CFG.timeline.reduced.tilt + 0.3, () => bus.emit('bell', EMPTY));
      // Safety: finish even if animationend never fires.
      at(CFG.timeline.reduced.tilt + 1.2, () => onDrawingDone());
    } else {
      const t0 = sh.tease ? TEASE_S : 0;
      if (sh.tease) bus.emit('scrape', { durationMs: TEASE_S * 1000 * 0.6 });
      at(t0, () => bus.emit('scrape', { durationMs: CREEP_S * 1000 }));
      const pop = t0 + CREEP_S + HOLD_S;
      at(pop, () => {
        setHero('eject');
        bus.emit('pop', EMPTY);
        bus.emit('eject', EMPTY);
      });
      at(pop + EJECT_S * 0.45, () => bus.emit('thunk', { force: 0.9 }));
      at(pop + EJECT_S * 0.58, () => bus.emit('thunk', { force: 0.35 }));
      at(pop + EJECT_S * 0.62, () => bus.emit('landed', EMPTY));
      at(pop + EJECT_S * 0.74, () => {
        bus.emit('bell', EMPTY);
        setGlow((g) => g + 1);
      });
      at(pop + EJECT_S + 1.2, () => onDrawingDone());
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase, current, reduced]);

  // ── Reveal / jiaobei: the hero rests in the present pose (locked loads jump straight here). ──
  useEffect(() => {
    if ((phase === 'reveal' || phase === 'jiaobei') && current) {
      show.current.heroIndex = current.index;
      show.current.drawT0 = -1;
      setHero('landed');
    }
  }, [phase, current]);

  // ── Resetting: fly back into the tube. ──
  useEffect(() => {
    if (phase !== 'resetting') return;
    setBlocks(null);
    if (!current) {
      onResetDone();
      return;
    }
    setHero(reduced ? 'return-reduced' : 'return');
    const t = window.setTimeout(() => finishReturn(), (reduced ? 0.3 : CFG.timeline.reset) * 1000 + 400);
    return () => window.clearTimeout(t);
    // finishReturn reads the store directly, so a stale closure is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phase-driven: current/reduced are read when the phase changes, not tracked
  }, [phase]);

  const finishReturn = (): void => {
    if (useStore.getState().phase !== 'resetting') return;
    const sh = show.current;
    sh.sinkT0 = useStore.getState().reducedMotion ? -1 : performance.now();
    setHero('hidden');
    onResetDone();
  };

  // Idle: nothing is out of the tube.
  useEffect(() => {
    if (phase === 'idle' || phase === 'armed') {
      show.current.drawT0 = -1;
      if (hero !== 'hidden' && hero !== 'return' && hero !== 'return-reduced') setHero('hidden');
      setBlocks(null);
    }
  }, [phase, hero]);

  // ── 掷筊: one throw per rt.jiaobei.t0. ──
  useEffect(() => {
    if (phase !== 'jiaobei' || jiaobeiResult !== null || !rt.jiaobei.outcome) return;
    const j = rt.jiaobei;
    const f: ['flat' | 'round', 'flat' | 'round'] = [faceUp(j.targets[0]), faceUp(j.targets[1])];
    const animate = !reduced && j.active;
    setBlocks({ key: j.t0, faces: f, animate });
    if (!animate) return;
    const timers: number[] = [];
    const land = JIAOBEI_TIMING.flight;
    timers.push(window.setTimeout(() => bus.emit('jiaobei-land', { force: 0.8 }), land * 1000));
    timers.push(window.setTimeout(() => bus.emit('jiaobei-land', { force: 0.7 }), (land + JIAOBEI_TIMING.stagger) * 1000));
    timers.push(window.setTimeout(() => bus.emit('jiaobei-land', { force: 0.25 }), (land + 0.18) * 1000));
    timers.push(window.setTimeout(() => onJiaobeiDone(), JIAOBEI_DURATION * 1000 + 50));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase, jiaobeiResult, reduced]);

  // ── Veto flash. ──
  const prevVeto = useRef(vetoUsed);
  useEffect(() => {
    if (vetoUsed && !prevVeto.current) setFlash((n) => n + 1);
    prevVeto.current = vetoUsed;
  }, [vetoUsed]);

  const onHeroAnimEnd = (e: React.AnimationEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.animationName === 'f2d-eject' || e.animationName === 'f2d-appear') onDrawingDone();
    else if (e.animationName === 'f2d-return' || e.animationName === 'f2d-fade-out') finishReturn();
  };

  const showing = phase === 'reveal' || phase === 'jiaobei';
  const dock = showing ? (layout === 'bottom' ? 'bottom' : 'right') : 'none';
  const heroIdx = current?.index ?? -1;
  const hideHeroStick = heroIdx >= 0 && (hero !== 'hidden' || showing);
  const x0 = slots[heroIdx]?.x ?? 0;
  const incense = Math.max(0.12, 1 - meter * 0.88);
  const panels = useMemo(
    () =>
      Array.from({ length: PANELS }, (_, i) => {
        const a = (i / PANELS) * 360;
        const lit = 0.5 + 0.55 * Math.max(0, Math.cos(((a - 20) * Math.PI) / 180));
        return { a, lit };
      }),
    [],
  );

  return (
    <div className="f2d" data-dock={dock} aria-hidden="true">
      <div className="f2d-beams" />
      {!reduced &&
        dust.map((d, i) => (
          <span
            key={i}
            className="f2d-dust"
            style={{ left: d.left, bottom: d.bottom, '--dur': d.dur, '--delay': d.delay, '--dx': d.dx } as React.CSSProperties}
          />
        ))}
      <div className="f2d-world">
        <div className="f2d-lantern l">
          <div className="cord" />
          <div className="body" />
          <div className="tassel" />
        </div>
        <div className="f2d-lantern r">
          <div className="cord" />
          <div className="body" />
          <div className="tassel" />
        </div>
        <div className="f2d-plaque">
          <div className="t">{COPY.scene.plaque}</div>
          <div className="s">{subline}</div>
        </div>
        <div className="f2d-couplet l">{COPY.scene.coupletRight}</div>
        <div className="f2d-couplet r">{COPY.scene.coupletLeft}</div>

        <div className="f2d-altar">
          <div className="f2d-cloth">
            <span className="medal">{COPY.scene.clothMedallion}</span>
            <div className="motto">{COPY.scene.cloth}</div>
          </div>
        </div>

        <div className="f2d-censer">
          {[-16, 0, 16].map((dx, i) => (
            <div
              key={i}
              className="f2d-incense"
              style={{ left: 30 + dx, transform: `rotate(${(i - 1) * 5}deg) scaleY(${incense.toFixed(3)})` }}
            >
              {!reduced && <span className="smoke" style={{ animationDelay: `${-i * 1.2}s` }} />}
            </div>
          ))}
          <div className="bowl" />
        </div>

        <div className="f2d-tube-anchor">
          <div ref={hitRef} className="f2d-hit" />
          <div ref={tubeRef} className="f2d-tube">
            <div className="f2d-floor" />
            {slots.map((_, i) => (
              <div
                key={i}
                ref={(el) => {
                  stickRefs.current[i] = el;
                }}
                className="f2d-stick"
                data-hidden={i === heroIdx && hideHeroStick}
              />
            ))}
            {panels.map((p, i) => (
              <div
                key={i}
                className="f2d-panel"
                style={{ transform: `rotateY(${p.a}deg) translateZ(${TUBE_R}px)`, '--lit': p.lit.toFixed(3) } as React.CSSProperties}
              />
            ))}
            <div className="f2d-medal">
              {COPY.app.medallion.slice(0, 2)}
              <br />
              {COPY.app.medallion.slice(2)}
            </div>
          </div>
        </div>

        {glow > 0 && !reduced ? <div key={glow} className="f2d-glow" /> : null}

        {current ? (
          <div
            className="f2d-hero"
            data-state={hero}
            data-treat={current.treat}
            style={{ '--x0': `${x0.toFixed(1)}px` } as React.CSSProperties}
            onAnimationEnd={onHeroAnimEnd}
          >
            <span className="no">第{toChineseNumeral(current.stickNo)}签</span>
            <span className="nm">{current.restaurantName}</span>
          </div>
        ) : null}

        {blocks ? (
          <div className="f2d-jiaobei" key={blocks.key}>
            {(['l', 'r'] as const).map((side, i) => (
              <div
                key={side}
                className={`f2d-block ${side}`}
                data-anim={blocks.animate ? 'throw' : 'appear'}
                style={
                  blocks.animate
                    ? ({
                        animationName: side === 'l' ? 'f2d-throw-l' : 'f2d-throw-r',
                        animationDelay: `${i * JIAOBEI_TIMING.stagger}s`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <JiaobeiGlyph face={blocks.faces[i]!} size={60} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {flash > 0 ? <div key={flash} className="veto-flash" /> : null}
    </div>
  );
}
