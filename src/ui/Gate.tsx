/**
 * Mobile entry card. 「进殿上香」 must call controller.passGate() synchronously inside the click
 * handler (iOS motion permission + audio unlock need the user gesture).
 */
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/data/copy';
import { passGate, skipGate } from '@/draw/controller';
import { hidePoster } from '@/ui/intent';
import { useStore } from '@/state/store';

export function Gate(props: { leaving?: boolean }) {
  const enterRef = useRef<HTMLButtonElement>(null);
  const [clicked, setClicked] = useState(false);
  const leaving = clicked || !!props.leaving;
  const reduced = useStore((s) => s.reducedMotion);

  useEffect(() => {
    hidePoster();
    enterRef.current?.focus({ preventScroll: true });
  }, []);

  const leave = (fn: () => void): void => {
    if (leaving) return;
    fn(); // synchronous: permission prompt + audio unlock happen in this gesture
    setClicked(true);
  };

  return (
    <div className="gate" data-leaving={leaving} role="dialog" aria-modal="true" aria-labelledby="gate-title" aria-describedby="gate-body">
      <div className="gate-door" aria-hidden="true" />
      <div className="gate-card relative flex w-full max-w-[420px] flex-col items-center text-center">
        <div className="relative mb-7 short:hidden" aria-hidden="true">
          {!reduced && (
            <>
              <span className="incense-wisp" style={{ bottom: '100%', marginLeft: -10 }} />
              <span className="incense-wisp" style={{ bottom: '100%', marginLeft: 0, animationDelay: '-1.6s' }} />
              <span className="incense-wisp" style={{ bottom: '100%', marginLeft: 10, animationDelay: '-3.1s' }} />
            </>
          )}
          <div className="gate-seal">签</div>
        </div>
        <p className="font-brush text-[20px] tracking-[0.5em] text-gold/80 short:text-[16px]">{COPY.app.temple}</p>
        <h1
          id="gate-title"
          className="mt-3 font-brush text-[clamp(28px,8vw,44px)] leading-[1.25] tracking-[0.06em] text-gold-soft text-glow-gold short:mt-1 short:text-[clamp(22px,7vh,30px)]"
        >
          {COPY.gate.title.split('，').map((part, i, all) => (
            <span key={i} className="block short:inline">
              {part}
              {i < all.length - 1 ? '，' : ''}
            </span>
          ))}
        </h1>
        <p id="gate-body" className="mt-3 text-[15px] tracking-[0.3em] text-paper/80 short:mt-1 short:text-[14px]">
          {COPY.gate.body}
        </p>
        <div className="rule-gold my-8 w-48 short:my-3" aria-hidden="true" />
        <button
          ref={enterRef}
          type="button"
          className="btn btn-gold h-14 w-full max-w-[300px] text-[19px] tracking-[0.4em] short:h-12"
          onClick={() => leave(passGate)}
        >
          <span className="font-brush text-[24px] font-normal">{COPY.gate.enter}</span>
        </button>
        <button
          type="button"
          className="mt-4 min-h-11 px-4 text-[14px] short:mt-1 tracking-[0.15em] text-paper/70 underline decoration-gold/40 underline-offset-[6px] transition-colors hover:text-paper"
          onClick={() => leave(skipGate)}
        >
          {COPY.gate.skip}
        </button>
        <p className="mt-8 text-[12px] tracking-wider text-paper/45 short:mt-1">{COPY.gate.privacy}</p>
      </div>
    </div>
  );
}
