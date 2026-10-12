/** ?debug=1 readout: FPS, tier, DPR, phase, meter/energy and renderer stats (when the stage reports them). */
import { useEffect, useState } from 'react';
import { COPY } from '@/data/copy';
import { onFrameTime } from '@/engine/loop';
import { rt } from '@/state/runtime';
import { getState, useStore } from '@/state/store';
import { physicsStats } from '@/three/physics/bridge';
import { useScrollLayout } from '@/ui/hooks';
import { debugStats } from '@/ui/intent';

interface Snapshot {
  fps: number;
  worstMs: number;
  meter: number;
  energy: number;
  calls: number;
  tris: number;
  physics: boolean;
  mode: string;
}

export function DebugHud() {
  const tier = useStore((s) => s.tier);
  const dpr = useStore((s) => s.dpr);
  const phase = useStore((s) => s.phase);
  const webgl = useStore((s) => s.webgl);
  const quality = useStore((s) => s.settings.quality);
  const layout = useScrollLayout();
  // A right-docked scroll covers the top-right corner: move the readout to the left while it shows.
  const leftSide = layout !== 'bottom' && (phase === 'reveal' || phase === 'jiaobei');
  const [snap, setSnap] = useState<Snapshot>({
    fps: 0,
    worstMs: 0,
    meter: 0,
    energy: 0,
    calls: -1,
    tris: -1,
    physics: false,
    mode: 'pointer',
  });

  // window.__jin: live runtime for console / automation inspection (?debug=1 only; App gates DebugHud).
  useEffect(() => {
    const w = window as unknown as { __jin?: unknown };
    w.__jin = { rt, getState, physicsStats };
    return () => {
      delete w.__jin;
    };
  }, []);

  useEffect(() => {
    let frames = 0;
    let sum = 0;
    let worst = 0;
    const off = onFrameTime((dt) => {
      frames++;
      sum += dt;
      if (dt > worst) worst = dt;
    });
    const id = window.setInterval(() => {
      setSnap({
        fps: sum > 0 ? Math.round((frames * 1000) / sum) : 0,
        worstMs: Math.round(worst * 10) / 10,
        meter: rt.shake.meter,
        energy: rt.shake.energy,
        calls: debugStats.calls,
        tris: debugStats.triangles,
        physics: rt.physicsReady,
        mode: rt.input.mode,
      });
      frames = 0;
      sum = 0;
      worst = 0;
    }, 500);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, []);

  const row = (k: string, v: string | number) => (
    <div className="flex justify-between gap-4">
      <span className="text-paper/55">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 min-w-[168px] rounded-xl bg-black/70 px-3 py-2 font-mono text-[11px] leading-[1.55] text-[#9df7b5]"
      style={
        leftSide
          ? { top: 'calc(var(--sat) + 220px)', left: 'calc(var(--sal) + 8px)' }
          : { top: 'calc(var(--sat) + 8px)', right: 'calc(var(--sar) + 8px)' }
      }
    >
      {row(COPY.debug.fps, `${snap.fps} (${snap.worstMs}ms)`)}
      {row(COPY.debug.tier, `${tier} · ${quality} · dpr ${dpr.toFixed(2)}`)}
      {row(COPY.debug.calls, snap.calls >= 0 ? snap.calls : '—')}
      {row(COPY.debug.tris, snap.tris >= 0 ? snap.tris.toLocaleString() : '—')}
      {row('phase', phase)}
      {row('webgl', webgl)}
      {row('input', snap.mode)}
      {row('meter', snap.meter.toFixed(2))}
      {row('energy', snap.energy.toFixed(2))}
      {row('physics', snap.physics ? 'on' : 'off')}
      {row('build', __BUILD_ID__)}
    </div>
  );
}
