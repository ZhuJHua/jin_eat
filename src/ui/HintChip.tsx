/**
 * Contextual hint above the thumb zone: fallback hint (sensors unavailable), first-visit onboarding,
 * the forward-tilt chip while shaking, and 「停一停」 once the meter latches. Reads `rt` at 6 Hz.
 */
import { useEffect, useState } from 'react';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { Q_FINE, useMedia, useRtPoll } from '@/ui/hooks';

type Tone = 'info' | 'good';

interface ArmedView {
  full: boolean;
  motion: boolean;
  forwardOk: boolean;
  slow: boolean;
}

const readArmed = (): ArmedView => {
  const [lo, hi] = CFG.sensors.forwardRange;
  const f = rt.input.motion.forward;
  const sinceInput = performance.now() - useStore.getState().phaseSince;
  return {
    full: rt.shake.fullLatched,
    motion: rt.input.mode === 'motion',
    forwardOk: f >= lo && f <= hi,
    slow: sinceInput > 2600 && rt.shake.meter < 0.3 && !rt.input.auto.active,
  };
};

const sameArmed = (a: ArmedView, b: ArmedView): boolean =>
  a.full === b.full && a.motion === b.motion && a.forwardOk === b.forwardOk && a.slow === b.slow;

export function HintChip() {
  const phase = useStore((s) => s.phase);
  const gateHint = useStore((s) => s.gate.hint);
  const drawer = useStore((s) => s.drawer);
  const firstVisit = useStore((s) => s.history.length === 0);
  const reduced = useStore((s) => s.reducedMotion);
  const fine = useMedia(Q_FINE);
  const armed = phase === 'armed';
  const view = useRtPoll(readArmed, 6, armed, sameArmed);

  // The fallback hint shows for a while after it appears (and again on the next idle).
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (!gateHint || phase !== 'idle') return;
    setHintVisible(true);
    const t = window.setTimeout(() => setHintVisible(false), 7000);
    return () => window.clearTimeout(t);
  }, [gateHint, phase]);

  let text: string | null = null;
  let tone: Tone = 'info';
  if (drawer === null) {
    if (armed) {
      if (view.full) {
        text = COPY.hint.stillToDraw;
        tone = 'good';
      } else if (view.motion) {
        text = COPY.hint.tilt;
        tone = view.forwardOk ? 'good' : 'info';
      } else if (view.slow) {
        text = COPY.hint.shakeMore;
      }
    } else if (phase === 'idle') {
      if (gateHint && hintVisible) text = gateHint;
      else if (firstVisit && !reduced) text = fine ? COPY.hint.desktop : COPY.hint.mobile;
    }
  }

  if (!text) return null;
  return (
    <div className="pointer-events-none flex justify-center" aria-hidden="true">
      <div key={text} className="hint-chip chip lacquer-soft" data-tone={tone}>
        <span className="dot" />
        <span>{text}</span>
      </div>
    </div>
  );
}
