/**
 * Deterministic synthetic phone traces for the motion-feel tests. Generated on the fly (no recorded
 * data): device-frame linear acceleration (m/s²) plus beta/gamma (deg) at time t.
 */
export type V3 = [number, number, number];

export interface TraceSample {
  lin: V3;
  beta: number;
  gamma: number;
}

export interface Trace {
  id: string;
  desc: string;
  dur: number;
  /** When the deliberate shake starts (for time-to-fill), if any. */
  shakeStart?: number;
  sample(t: number): TraceSample;
}

const G = 9.80665;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Band-limited noise: N sines with random freqs in [f0, f1] and phases, scaled to `rms`. */
function bandNoise(rand: () => number, f0: number, f1: number, rms: number, n = 14): (t: number) => number {
  const fs: number[] = [];
  const ph: number[] = [];
  for (let i = 0; i < n; i++) {
    fs.push(f0 + (f1 - f0) * rand());
    ph.push(TAU * rand());
  }
  const a = rms / Math.sqrt(n / 2);
  return (t) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.sin(TAU * fs[i]! * t + ph[i]!);
    return s * a;
  };
}

/** Slow posture drift whose angular SPEED has the given RMS (deg/s); returns degrees. */
function drift(rand: () => number, speedRms: number): (t: number) => number {
  const fs = [0.06 + 0.03 * rand(), 0.13 + 0.04 * rand(), 0.24 + 0.06 * rand()];
  const ph = fs.map(() => TAU * rand());
  // Equal speed share per component: (2π f A)²/2 = speedRms²/3.
  const amps = fs.map((f) => (speedRms * Math.sqrt(2 / 3)) / (TAU * f));
  return (t) => {
    let s = 0;
    for (let i = 0; i < fs.length; i++) s += amps[i]! * (Math.sin(TAU * fs[i]! * t + ph[i]!) - Math.sin(ph[i]!));
    return s;
  };
}

/** Smoothstep ramp of `delta` degrees starting at t0 lasting `dur` seconds. */
function ramp(t: number, t0: number, dur: number, delta: number): number {
  if (t <= t0) return 0;
  if (t >= t0 + dur) return delta;
  const u = (t - t0) / dur;
  return delta * u * u * (3 - 2 * u);
}

/** Envelope 0→1→0 with linear fades. */
function envelope(t: number, t0: number, t1: number, fade = 0.3): number {
  if (t <= t0 || t >= t1) return 0;
  return Math.min(1, (t - t0) / fade, (t1 - t) / fade);
}

/** Gravity reaction ("up") in device coordinates for beta/gamma in degrees (W3C convention). */
export function gUp(betaDeg: number, gammaDeg: number): V3 {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return [-G * Math.cos(b) * Math.sin(g), G * Math.sin(b), G * Math.cos(b) * Math.cos(g)];
}

const BETA0 = 55; // typical hand-held reading posture
const GAMMA0 = 0;
/** Wrist pivot radius for beta rotations (phone centre ~12 cm from the wrist), gamma ~3 cm. */
const R_BETA = 0.12;
const R_GAMMA = 0.03;

/** Adds the tangential acceleration from pivoting (numerical 2nd derivative of the angles). */
function withPivot(base: (t: number) => { lin: V3; beta: number; gamma: number; jb?: number; jg?: number }): (t: number) => TraceSample {
  const h = 1 / 240;
  return (t) => {
    const s0 = base(t);
    const sm = base(t - h);
    const sp = base(t + h);
    const bdd = ((sp.beta - 2 * s0.beta + sm.beta) / (h * h)) * DEG;
    const gdd = ((sp.gamma - 2 * s0.gamma + sm.gamma) / (h * h)) * DEG;
    return {
      lin: [s0.lin[0] + R_GAMMA * gdd, s0.lin[1], s0.lin[2] + R_BETA * bdd],
      // Angular tremor (jb/jg) is reported but not differentiated: its tangential accel is the
      // linear tremor term already.
      beta: s0.beta + (s0.jb ?? 0),
      gamma: s0.gamma + (s0.jg ?? 0),
    };
  };
}

interface HandParams {
  tremorRms: number;
  driftSpeed: number;
  angTremorDeg: number;
}

function handHeld(seed: number, p: HandParams) {
  const r = mulberry32(seed);
  const tx = bandNoise(r, 8, 12, p.tremorRms);
  const ty = bandNoise(r, 8, 12, p.tremorRms);
  const tz = bandNoise(r, 8, 12, p.tremorRms);
  // Slow body sway (0.3–1.5 Hz), small.
  const sx = bandNoise(r, 0.3, 1.5, 0.04, 6);
  const sy = bandNoise(r, 0.3, 1.5, 0.04, 6);
  const sz = bandNoise(r, 0.3, 1.5, 0.05, 6);
  const db = drift(r, p.driftSpeed);
  const dg = drift(r, p.driftSpeed);
  const ab = bandNoise(r, 8, 12, p.angTremorDeg, 8);
  const ag = bandNoise(r, 8, 12, p.angTremorDeg, 8);
  return {
    lin: (t: number): V3 => [tx(t) + sx(t), ty(t) + sy(t), tz(t) + sz(t)],
    dBeta: (t: number) => db(t),
    dGamma: (t: number) => dg(t),
    jb: ab,
    jg: ag,
  };
}

function traceA(id: string, desc: string, seed: number, p: HandParams): Trace {
  const hand = handHeld(seed, p);
  const sample = withPivot((t) => ({
    lin: hand.lin(t),
    jb: hand.jb(t),
    jg: hand.jg(t),
    beta: BETA0 + hand.dBeta(t) + ramp(t, 3.1, 0.4, 5),
    gamma: GAMMA0 + hand.dGamma(t) + ramp(t, 6.7, 0.4, -5),
  }));
  return { id, desc, dur: 10, sample };
}

export function buildTraces(): Trace[] {
  const traces: Trace[] = [];

  // A) still hand-held: three intensities.
  traces.push(
    traceA('A_lo', 'still hand-held: tremor 0.15 m/s² rms, drift 0.5°/s, 2 micro-adjusts 5°/0.4s', 11, {
      tremorRms: 0.15,
      driftSpeed: 0.5,
      angTremorDeg: 0.05,
    }),
    traceA('A_mid', 'still hand-held: tremor 0.30 m/s² rms, drift 1.2°/s, 2 micro-adjusts', 12, {
      tremorRms: 0.3,
      driftSpeed: 1.2,
      angTremorDeg: 0.1,
    }),
    traceA('A_hi', 'still hand-held: tremor 0.50 m/s² rms, drift 2.5°/s, 2 micro-adjusts', 13, {
      tremorRms: 0.5,
      driftSpeed: 2.5,
      angTremorDeg: 0.2,
    }),
  );

  // C) walking with the phone: 2 Hz vertical bounce 2.8 m/s² (+2nd harmonic), 1 m/s² lateral sway.
  {
    const hand = handHeld(31, { tremorRms: 0.15, driftSpeed: 0.6, angTremorDeg: 0.08 });
    const r = mulberry32(32);
    const fStep = 1.8 + 0.4 * r();
    const ph = TAU * r();
    const sample = withPivot((t) => {
      const beta = BETA0 + hand.dBeta(t) + 1.5 * Math.sin(TAU * fStep * t + ph + 0.8);
      const gamma = GAMMA0 + hand.dGamma(t) + 1.0 * Math.sin(Math.PI * fStep * t + ph);
      const up = gUp(beta, gamma).map((v) => v / G) as V3;
      // lateral ≈ device x orthogonalised against up; forward = up × lateral.
      const d = up[0];
      let L: V3 = [1 - d * up[0], -d * up[1], -d * up[2]];
      const ln = Math.hypot(L[0], L[1], L[2]);
      L = [L[0] / ln, L[1] / ln, L[2] / ln];
      const F: V3 = [up[1] * L[2] - up[2] * L[1], up[2] * L[0] - up[0] * L[2], up[0] * L[1] - up[1] * L[0]];
      const av = 2.8 * Math.sin(TAU * fStep * t + ph) + 0.7 * Math.sin(TAU * 2 * fStep * t + ph * 1.3);
      const al = 1.0 * Math.sin(Math.PI * fStep * t + ph);
      const af = 0.6 * Math.sin(TAU * fStep * t + ph + 1.1);
      const h = hand.lin(t);
      return {
        lin: [
          h[0] + av * up[0] + al * L[0] + af * F[0],
          h[1] + av * up[1] + al * L[1] + af * F[1],
          h[2] + av * up[2] + al * L[2] + af * F[2],
        ],
        beta,
        gamma,
        jb: hand.jb(t),
        jg: hand.jg(t),
      };
    });
    traces.push({ id: 'C', desc: `walking: ${fStep.toFixed(2)} Hz, vertical 2.8 m/s² (+0.7 2nd harm), lateral 1 m/s²`, dur: 10, sample });
  }

  // D/E) deliberate shakes, side-to-side (device x) with some y, plus rotational wobble.
  const shake = (id: string, desc: string, seed: number, fc: number, fd: number, amp: number, wobbleDeg: number): Trace => {
    const hand = handHeld(seed, { tremorRms: 0.2, driftSpeed: 0.5, angTremorDeg: 0.1 });
    const r = mulberry32(seed + 1);
    const ph = TAU * r();
    const fm = 0.35;
    const t0 = 1.0;
    const t1 = 8.0;
    const phase = (t: number) => TAU * (fc * t - (fd / (TAU * fm)) * Math.cos(TAU * fm * t)) + ph;
    const ampAt = (t: number) => amp * (0.85 + 0.15 * Math.sin(TAU * 0.6 * t + 1.7));
    const sample = withPivot((t) => {
      const e = envelope(t, t0, t1);
      const p = phase(t);
      const a = ampAt(t) * e;
      const h = hand.lin(t);
      return {
        lin: [h[0] + a * Math.sin(p), h[1] + 0.35 * a * Math.sin(p + 0.6), h[2] + 0.2 * a * Math.sin(2 * p + 0.3)],
        beta: BETA0 + hand.dBeta(t) + e * wobbleDeg * 0.5 * Math.sin(p + 1.2),
        gamma: GAMMA0 + hand.dGamma(t) + e * wobbleDeg * Math.sin(p + 0.4),
        jb: hand.jb(t),
        jg: hand.jg(t),
      };
    });
    return { id, desc, dur: 10, shakeStart: t0, sample };
  };
  traces.push(shake('D', 'light shake 1–8 s: 4–6 Hz, 8.5–11.5 m/s² peak, ±6° wobble', 41, 5, 1, 10, 6));
  traces.push(shake('E', 'vigorous shake 1–8 s: 5–8 Hz, 17–23 m/s² peak, ±12° wobble', 51, 6.5, 1.5, 20, 12));

  return traces;
}

/** Extra scenarios: step_hold clean step-and-hold posture change, H vehicle vibration. */
export function extraTraces(): Trace[] {
  const tremor = (seed: number, rms: number) => {
    const r = mulberry32(seed);
    const a = [bandNoise(r, 8, 12, rms), bandNoise(r, 8, 12, rms), bandNoise(r, 8, 12, rms)];
    return (t: number): V3 => [a[0]!(t), a[1]!(t), a[2]!(t)];
  };
  const tr = tremor(71, 0.3);
  const b2: Trace = {
    id: 'step_hold',
    desc: 'step & hold: β+15° over 1 s at t=1, γ−12° over 0.8 s at t=5.5',
    dur: 10,
    sample: (t) => ({ lin: tr(t), beta: BETA0 + ramp(t, 1, 1, 15), gamma: ramp(t, 5.5, 0.8, -12) }),
  };
  const r = mulberry32(101);
  const v = [bandNoise(r, 1, 15, 1.0, 24), bandNoise(r, 1, 15, 1.0, 24), bandNoise(r, 1, 15, 2.1, 24)];
  const h: Trace = {
    id: 'H',
    desc: 'vehicle vibration, broadband 1–15 Hz, |lin| ≈ 2.5 m/s² rms',
    dur: 10,
    sample: (t) => ({ lin: [v[0]!(t), v[1]!(t), v[2]!(t)], beta: BETA0, gamma: 0 }),
  };
  return [b2, h];
}

export function traceById(id: string): Trace {
  const t = [...buildTraces(), ...extraTraces()].find((x) => x.id === id);
  if (!t) throw new Error(`no trace ${id}`);
  return t;
}
