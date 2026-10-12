/**
 * Main action: click/tap = quick draw, long-press (350 ms) = auto-shake while held.
 * A gold SVG ring mirrors the shake meter; the wrapper is the accessible progressbar.
 */
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/data/copy';
import { endHold, quickDraw, startHold } from '@/draw/controller';
import { audio } from '@/audio/synth';
import { holdFullRate } from '@/engine/loop';
import { useStore } from '@/state/store';

const LONG_PRESS_MS = 350;
const R = 60;
const C = 2 * Math.PI * R;

export function ShakeButton() {
  const phase = useStore((s) => s.phase);
  const meter = useStore((s) => s.meterMirror);
  const reduced = useStore((s) => s.reducedMotion);
  const drawer = useStore((s) => s.drawer);
  const [pressed, setPressed] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const activePointer = useRef<number | null>(null);

  const armed = phase === 'armed';
  const busy = phase === 'drawing' || phase === 'resetting';
  const disabled = busy || drawer !== null || (phase !== 'idle' && phase !== 'armed');
  const full = meter >= 0.999;

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  // If the phase moves on while holding (forced draw), release the hold cleanly.
  useEffect(() => {
    if (phase !== 'armed' && phase !== 'idle') {
      held.current = false;
      activePointer.current = null;
      clearTimer();
      setPressed(false);
    }
  }, [phase]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (disabled || e.button !== 0 || activePointer.current !== null) return;
    activePointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
    audio.unlock();
    holdFullRate(600);
    setPressed(true);
    held.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      held.current = true;
      startHold('button-hold');
    }, LONG_PRESS_MS);
  };

  const finish = (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    clearTimer();
    setPressed(false);
    if (held.current) {
      held.current = false;
      endHold();
      return;
    }
    if (!cancelled) quickDraw();
  };

  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    // Pointer clicks are handled by the pointer handlers; detail === 0 means keyboard or assistive tech.
    if (e.detail !== 0) return;
    audio.unlock();
    quickDraw();
  };

  let label: string = reduced ? COPY.button.reduced : COPY.button.idle;
  let sub: string | null = reduced ? null : COPY.button.holdHint;
  if (armed) {
    label = COPY.button.armed;
    sub = full ? COPY.button.release : null;
  } else if (busy) {
    label = COPY.button.drawing;
    sub = null;
  }
  const [main, tail] = label.includes(' · ') ? label.split(' · ') : [label, null];
  const pct = Math.round(meter * 100);

  return (
    <div
      className="shake-wrap"
      role="progressbar"
      aria-label={COPY.a11y.meter}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${COPY.a11y.meter} ${pct}%`}
      data-full={full}
    >
      <svg className="shake-ring" viewBox="0 0 132 132" aria-hidden="true">
        <defs>
          <linearGradient id="ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b8" />
            <stop offset="0.5" stopColor="#f0c25c" />
            <stop offset="1" stopColor="#ff8a2a" />
          </linearGradient>
        </defs>
        <circle className="track" cx="66" cy="66" r={R} fill="none" strokeWidth="5" />
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <line
              key={i}
              className="tick"
              x1={66 + Math.cos(a) * (R - 5)}
              y1={66 + Math.sin(a) * (R - 5)}
              x2={66 + Math.cos(a) * (R + 5)}
              y2={66 + Math.sin(a) * (R + 5)}
              strokeWidth="1.5"
            />
          );
        })}
        <circle
          className="fill"
          cx="66"
          cy="66"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - meter)}
          opacity={meter > 0.002 ? 1 : 0}
        />
      </svg>
      {phase === 'idle' && !reduced && <span className="shake-halo" aria-hidden="true" />}
      <button
        id="shake-button"
        data-shake-button=""
        type="button"
        className="shake-btn"
        data-pressed={pressed}
        aria-busy={armed || busy}
        aria-keyshortcuts="Enter Space"
        aria-describedby="shake-hint"
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => {
          if (activePointer.current === e.pointerId) finish(e, true);
        }}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="flex flex-col items-center">
          <span className="label">{main}</span>
          {tail ? <span className="label !text-[17px] text-gold">{tail}</span> : null}
          {sub ? <span className="sub">{sub}</span> : null}
        </span>
      </button>
      <span id="shake-hint" className="sr-only">
        {reduced ? COPY.button.reduced : `${COPY.button.holdHint}。${COPY.hint.desktop}`}
      </span>
    </div>
  );
}
