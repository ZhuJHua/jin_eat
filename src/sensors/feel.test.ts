/**
 * Motion feel: the intent gate on the tube drive, the re-centring soft-deadzone tilt and the
 * sensitivity presets, exercised with deterministic synthetic hand-held traces.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CFG } from '@/config';
import type { MotionSensitivity, Vec3 } from '@/types';
import { alphaForDt, feelPreset, IntentGate, LowPass3, softDeadzone, TiltConditioner, type FeelPreset } from '@/sensors/filters';
import { resetTubeDriver, stepTubeDriver } from '@/three/TubeDriver';
import { useStore } from '@/state/store';
import { rt } from '@/state/runtime';
import { gUp, traceById, type Trace } from './__fixtures__/handheldTraces';

const F = CFG.sensors.feel;
const P = (k: MotionSensitivity): FeelPreset => feelPreset(F, k);

interface GateRun {
  t: number[];
  gain: number[];
  open: boolean[];
  lin: Vec3[];
}

/** Feed a trace's |lin| through the gate at `hz`, either from e.acceleration or the gravity high-pass. */
function runGate(tr: Trace, preset: FeelPreset, opts: { hz?: number; acc?: boolean } = {}): GateRun {
  const hz = opts.hz ?? 60;
  const acc = opts.acc ?? true;
  const g = new IntentGate(F);
  const grav = new LowPass3(1 - CFG.sensors.gravityAlpha);
  const out: GateRun = { t: [], gain: [], open: [], lin: [] };
  const n = Math.round(tr.dur * hz);
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    const s = tr.sample(t);
    let lin: Vec3 = [s.lin[0], s.lin[1], s.lin[2]];
    if (!acc) {
      const u = gUp(s.beta, s.gamma);
      const aig: Vec3 = [lin[0] + u[0], lin[1] + u[1], lin[2] + u[2]];
      const gv = grav.pushDt(aig, 1 / hz);
      lin = [aig[0] - gv[0], aig[1] - gv[1], aig[2] - gv[2]];
    }
    out.t.push(t);
    out.gain.push(g.push(Math.hypot(lin[0], lin[1], lin[2]), 1 / hz, preset));
    out.open.push(g.open);
    out.lin.push(lin);
  }
  return out;
}

const firstOpen = (r: GateRun, from: number): number | null => {
  const i = r.t.findIndex((t, k) => t >= from && r.open[k]);
  return i < 0 ? null : r.t[i]! - from;
};
const maxGain = (r: GateRun, t0: number, t1 = Infinity): number =>
  r.gain.reduce((m, g, k) => (r.t[k]! >= t0 && r.t[k]! <= t1 ? Math.max(m, g) : m), 0);
const minGain = (r: GateRun, t0: number, t1: number): number =>
  r.gain.reduce((m, g, k) => (r.t[k]! >= t0 && r.t[k]! <= t1 ? Math.min(m, g) : m), 1);

/** Screen-frame lean (deg) → orientation.ts's α-0.15 low-pass → TiltConditioner; returns output in deg. */
function runTilt(tr: Trace, preset: FeelPreset, hz = 60): { t: number[]; x: number[]; y: number[] } {
  const c = new TiltConditioner();
  let sx = 0;
  let sy = 0;
  const b0 = tr.sample(0);
  const out = { t: [] as number[], x: [] as number[], y: [] as number[] };
  for (let i = 0; i < tr.dur * hz; i++) {
    const t = i / hz;
    const s = tr.sample(t);
    const a = alphaForDt(CFG.sensors.tiltAlpha, 1 / hz);
    sx += a * (s.gamma - b0.gamma - sx);
    sy += a * (s.beta - b0.beta - sy);
    c.push(sx, sy, i === 0 ? 0 : 1 / hz, preset);
    out.t.push(t);
    out.x.push(c.x);
    out.y.push(c.y);
  }
  return out;
}

describe('feelPreset', () => {
  it('maps low/mid/high and falls back to mid for anything else', () => {
    expect(feelPreset(F, 'low')).toBe(F.presets.low);
    expect(feelPreset(F, 'high')).toBe(F.presets.high);
    expect(feelPreset(F, 'mid')).toBe(F.presets.mid);
    expect(feelPreset(F, undefined)).toBe(F.presets.mid);
    expect(feelPreset(F, 'turbo')).toBe(F.presets.mid);
  });

  it('presets are ordered: low is the calmest, high the most responsive', () => {
    const { low, mid, high } = F.presets;
    expect(low.onMin).toBeGreaterThan(mid.onMin);
    expect(mid.onMin).toBeGreaterThan(high.onMin);
    expect(low.tiltDeadzoneDeg).toBeGreaterThan(mid.tiltDeadzoneDeg);
    expect(mid.tiltDeadzoneDeg).toBeGreaterThan(high.tiltDeadzoneDeg);
    expect(low.driveGain).toBeLessThan(high.driveGain);
  });
});

describe('softDeadzone', () => {
  it('is odd, cubic below D and slope-1 (shifted by D) far above it', () => {
    const D = 3.5;
    expect(softDeadzone(0, D)).toBe(0);
    expect(softDeadzone(-2, D)).toBeCloseTo(-softDeadzone(2, D), 12);
    expect(softDeadzone(0.5, D)).toBeCloseTo(0.5 ** 3 / (3 * D * D), 3);
    expect(softDeadzone(30, D)).toBeCloseTo(30 - D, 6);
    for (let x = 0; x < 20; x += 0.25) expect(softDeadzone(x + 0.25, D)).toBeGreaterThan(softDeadzone(x, D));
    expect(softDeadzone(5, 0)).toBe(5);
  });
});

describe('IntentGate (mid)', () => {
  for (const acc of [true, false]) {
    const tag = acc ? 'e.acceleration' : 'gravity high-pass';
    it(`keeps tremor, walking and a noisy still hand fully closed (${tag})`, () => {
      for (const id of ['A_lo', 'A_mid', 'A_hi', 'C']) {
        expect(maxGain(runGate(traceById(id), P('mid'), { acc }), 0.5), id).toBe(0);
      }
    });

    it(`opens for a light shake within 0.35 s and stays ≥ 0.9 through it (${tag})`, () => {
      const tr = traceById('D');
      const r = runGate(tr, P('mid'), { acc });
      const at = firstOpen(r, tr.shakeStart!);
      expect(at).not.toBeNull();
      expect(at!).toBeLessThan(0.35);
      expect(minGain(r, tr.shakeStart! + 0.5, 7.7)).toBeGreaterThan(0.9);
    });

    it(`opens for a vigorous shake within 0.15 s and closes within 1 s after it ends (${tag})`, () => {
      const tr = traceById('E');
      const r = runGate(tr, P('mid'), { acc });
      expect(firstOpen(r, tr.shakeStart!)!).toBeLessThan(0.15);
      expect(maxGain(r, 9.0)).toBeLessThan(0.05);
    });
  }

  it('vehicle vibration through the gravity high-pass stays closed', () => {
    expect(maxGain(runGate(traceById('H'), P('mid'), { acc: false }), 0.5)).toBe(0);
  });

  it('gives the same verdicts at 30 Hz and 100 Hz sensor rates', () => {
    for (const hz of [30, 100]) {
      expect(maxGain(runGate(traceById('A_hi'), P('mid'), { hz }), 0.5)).toBe(0);
      expect(maxGain(runGate(traceById('C'), P('mid'), { hz }), 0.5)).toBe(0);
      const D = traceById('D');
      expect(firstOpen(runGate(D, P('mid'), { hz }), D.shakeStart!)!).toBeLessThan(0.4);
    }
  });

  it('applies a preset change on the next sample (thresholds are not latched)', () => {
    const g = new IntentGate(F);
    for (let i = 0; i < 30; i++) g.push(4.5, 1 / 60, P('low'));
    expect(g.open).toBe(false);
    g.push(4.5, 1 / 60, P('mid'));
    expect(g.open).toBe(true);
  });

  it('reset() closes the gate and restores the initial noise floor', () => {
    const g = new IntentGate(F);
    for (let i = 0; i < 60; i++) g.push(12, 1 / 60, P('mid'));
    expect(g.gain).toBeGreaterThan(0.9);
    g.reset();
    expect(g.open).toBe(false);
    expect(g.gain).toBe(0);
    expect(g.floor).toBe(F.floorInit);
  });
});

describe('IntentGate presets', () => {
  it('low and high also keep tremor and walking closed', () => {
    for (const k of ['low', 'high'] as const) {
      for (const id of ['A_hi', 'C']) expect(maxGain(runGate(traceById(id), P(k)), 0.5), `${k}/${id}`).toBe(0);
    }
  });

  it('a light shake opens high no later than mid, and mid no later than low', () => {
    const D = traceById('D');
    const at = (k: MotionSensitivity) => firstOpen(runGate(D, P(k)), D.shakeStart!)!;
    expect(at('high')).toBeLessThanOrEqual(at('mid'));
    expect(at('mid')).toBeLessThanOrEqual(at('low'));
    expect(at('low')).toBeLessThan(0.45);
  });
});

describe('TiltConditioner', () => {
  it('a held 15° posture change gives a brief lean that returns monotonically (mid)', () => {
    const r = runTilt(traceById('step_hold'), P('mid'));
    // β step: ramp 1 → 2 s; inspect until the γ step starts at 5.5 s.
    const ys = r.y.filter((_, k) => r.t[k]! > 1 && r.t[k]! < 5.5);
    const peak = Math.max(...ys);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThan(8);
    expect(Math.min(...ys)).toBeGreaterThan(-0.05); // no overshoot to the other side
    const settled = r.t.findIndex((t, k) => t > 2 && Math.abs(r.y[k]!) < 1);
    expect(r.t[settled]! - 2).toBeLessThan(1.0);
    const at4 = r.y[r.t.findIndex((t) => t >= 4)]!;
    expect(Math.abs(at4)).toBeLessThan(0.1);
  });

  it('slow drift and micro-adjusts of a still hand stay small (A_hi, mid)', () => {
    const r = runTilt(traceById('A_hi'), P('mid'));
    const all = r.x.map((x, k) => Math.hypot(x, r.y[k]!));
    expect(Math.max(...all)).toBeLessThan(2);
    expect(Math.sqrt(all.reduce((s, v) => s + v * v, 0) / all.length)).toBeLessThan(0.5);
  });

  it('the deadzone is radial: a diagonal lean gets the same magnitude as an axis lean', () => {
    const a = new TiltConditioner();
    const b = new TiltConditioner();
    a.push(8, 0, 0.01, P('mid'));
    b.push(8 / Math.SQRT2, 8 / Math.SQRT2, 0.01, P('mid'));
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(Math.hypot(a.x, a.y), 9);
  });

  it('presets order the step-and-hold peak: low < mid < high', () => {
    const peak = (k: MotionSensitivity) => Math.max(...runTilt(traceById('step_hold'), P(k)).y);
    expect(peak('low')).toBeLessThan(peak('mid'));
    expect(peak('mid')).toBeLessThan(peak('high'));
  });

  it('reset(lean) makes the current pose neutral', () => {
    const c = new TiltConditioner();
    c.reset(12, -7);
    c.push(12, -7, 1 / 60, P('high'));
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });
});

describe('TubeDriver fed by the conditioned signals', () => {
  beforeEach(() => {
    useStore.setState({ phase: 'idle', drawer: null, reducedMotion: false });
    resetTubeDriver();
    rt.input.mode = 'motion';
    rt.tube.scriptedTilt = null;
    rt.input.auto.active = false;
    rt.input.pointer.grabbing = false;
    rt.input.motion.active = true;
  });

  /** 60 Hz: gate the trace's lin and condition its tilt, step the driver; returns offset (mm) and tilt (deg) series. */
  function drive(tr: Trace): { off: number[]; ang: number[] } {
    const g = runGate(tr, P('mid'));
    const tl = runTilt(tr, P('mid'));
    const m = rt.input.motion;
    const DEG = Math.PI / 180;
    const off: number[] = [];
    const ang: number[] = [];
    for (let i = 0; i < g.t.length; i++) {
      // Device frame ≈ screen frame in portrait (angle 0).
      const k = g.gain[i]! * P('mid').driveGain;
      m.lin[0] = g.lin[i]![0] * k;
      m.lin[1] = g.lin[i]![1] * k;
      m.lin[2] = g.lin[i]![2] * k;
      m.tilt.x = tl.x[i]! * DEG;
      m.tilt.y = tl.y[i]! * DEG;
      m.lastTs = g.t[i]! * 1000;
      stepTubeDriver(1 / 60, g.t[i]! * 1000);
      // Displacement of the hand-hold point (the lean pivot), not of the base: under phone input
      // the tube leans about a raised pivot, so the base sweeps even when the hand is still.
      const { p, q } = rt.tube.target;
      const [qx, qy, qz, qw] = q;
      const h = CFG.tube.leanPivotY;
      const px = p[0] + h * 2 * (qx * qy - qw * qz);
      const py = p[1] + h * (1 - 2 * (qx * qx + qz * qz)) - h;
      const pz = p[2] + h * 2 * (qy * qz + qw * qx);
      off.push(Math.hypot(px, py, pz) * 1000);
      ang.push((2 * Math.acos(Math.min(1, Math.abs(rt.tube.target.q[3])))) / DEG);
    }
    return { off, ang };
  }

  it('holding the phone still: no offset, tilt rms under 0.5° (peak under 2°)', () => {
    const { off, ang } = drive(traceById('A_hi'));
    const a = ang.slice(30);
    expect(Math.max(...off)).toBeLessThan(0.5);
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)).toBeLessThan(0.5);
    expect(Math.max(...a)).toBeLessThan(2);
  });

  it('walking: the tube does not move', () => {
    const { off } = drive(traceById('C'));
    expect(Math.max(...off)).toBeLessThan(0.5);
  });

  it('a light shake still swings the tube visibly', () => {
    const { off } = drive(traceById('D'));
    const during = off.slice(90, 460);
    expect(Math.sqrt(during.reduce((s, v) => s + v * v, 0) / during.length)).toBeGreaterThan(8);
  });
});
