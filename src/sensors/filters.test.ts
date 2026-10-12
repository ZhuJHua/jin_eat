import { describe, expect, it } from 'vitest';
import { CFG } from '@/config';
import type { Vec3 } from '@/types';
import {
  alphaForDt,
  angleDiff,
  energyFrom,
  holdMag,
  inForwardRange,
  LowPass1,
  LowPass3,
  normalizeScreenAngle,
  PeakDetector,
  pointerMag,
  quickMag,
  remapToScreen,
  ShakeIntegrator,
  signFixFrom,
} from '@/sensors/filters';

const G = 9.81;
const close = (a: Vec3, b: Vec3, eps = 1e-9): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(eps);
};

describe('LowPass3', () => {
  it('primes on the first sample (no ramp from zero)', () => {
    const lp = new LowPass3(0.2);
    expect(lp.ready).toBe(false);
    close(lp.push([1, 2, 3]), [1, 2, 3]);
    expect(lp.ready).toBe(true);
  });

  it('moves alpha of the way toward each new sample', () => {
    const lp = new LowPass3(0.25);
    lp.push([0, 0, 0]);
    close(lp.push([4, -8, 1]), [1, -2, 0.25]);
    close(lp.push([4, -8, 1]), [1.75, -3.5, 0.4375]);
  });

  it('converges to a constant input with the gravity-filter alpha', () => {
    const g = new LowPass3(1 - CFG.sensors.gravityAlpha);
    g.push([0, 0, 0]);
    for (let i = 0; i < 200; i++) g.push([0, G, 0]);
    close(g.value, [0, G, 0], 1e-6);
  });

  it('pushDt matches push at the reference rate and is rate independent', () => {
    const a = new LowPass3(0.2);
    const b = new LowPass3(0.2);
    a.push([0, 0, 0]);
    b.push([0, 0, 0]);
    close(a.push([10, 0, 0]), b.pushDt([10, 0, 0], 1 / 60));
    // Two 120 Hz samples ≈ one 60 Hz sample.
    const c = new LowPass3(0.2);
    const d = new LowPass3(0.2);
    c.push([0, 0, 0]);
    d.push([0, 0, 0]);
    c.pushDt([10, 0, 0], 1 / 60);
    d.pushDt([10, 0, 0], 1 / 120);
    d.pushDt([10, 0, 0], 1 / 120);
    expect(Math.abs(c.value[0] - d.value[0])).toBeLessThan(1e-9);
  });

  it('gravity subtraction removes a constant tilt', () => {
    const g = new LowPass3(0.2);
    const sample: Vec3 = [1.2, 7.5, 6.1];
    for (let i = 0; i < 300; i++) g.push(sample);
    const lin = sample.map((v, i) => v - g.value[i]!);
    expect(Math.hypot(...lin)).toBeLessThan(1e-6);
  });

  it('reset clears or seeds the state', () => {
    const lp = new LowPass3(0.5);
    lp.push([5, 5, 5]);
    lp.reset();
    expect(lp.ready).toBe(false);
    close(lp.push([1, 1, 1]), [1, 1, 1]);
    lp.reset([2, 3, 4]);
    close(lp.push([2, 3, 4]), [2, 3, 4]);
  });
});

describe('LowPass1 and alphaForDt', () => {
  it('LowPass1 primes on the first sample, then smooths', () => {
    const lp = new LowPass1(0.5);
    expect(lp.push(4)).toBe(4);
    expect(lp.push(0)).toBe(2);
    lp.reset();
    expect(lp.push(10)).toBe(10);
  });

  it('alphaForDt compounds alpha over dt and falls back on invalid dt', () => {
    expect(alphaForDt(0.2, 1 / 60)).toBeCloseTo(0.2, 12);
    expect(alphaForDt(1, 0.5)).toBe(1);
    expect(alphaForDt(0.2, 0)).toBe(0.2);
    expect(alphaForDt(0.2, Number.NaN)).toBe(0.2);
    expect(alphaForDt(0.2, 10)).toBeLessThanOrEqual(1);
    expect(alphaForDt(0.2, 2 / 60)).toBeCloseTo(1 - 0.8 * 0.8, 12);
  });
});

describe('remapToScreen', () => {
  it('normalises screen angles to 0/90/180/270', () => {
    expect(normalizeScreenAngle(0)).toBe(0);
    expect(normalizeScreenAngle(90)).toBe(90);
    expect(normalizeScreenAngle(-90)).toBe(270);
    expect(normalizeScreenAngle(180)).toBe(180);
    expect(normalizeScreenAngle(-180)).toBe(180);
    expect(normalizeScreenAngle(270)).toBe(270);
    expect(normalizeScreenAngle(360)).toBe(0);
    expect(normalizeScreenAngle(Number.NaN)).toBe(0);
  });

  it('is the identity in portrait', () => {
    close(remapToScreen([1, 2, 3], 0), [1, 2, 3]);
  });

  it('landscape-primary (top of phone to the left): pushing toward the screen right is device −y', () => {
    close(remapToScreen([0, -5, 0], 90), [5, 0, 0]);
    // The device's right edge points up on screen.
    close(remapToScreen([5, 0, 0], 90), [0, 5, 0]);
  });

  it('legacy −90 equals 270 and is the mirror of 90', () => {
    close(remapToScreen([0, -5, 0], -90), [-5, 0, 0]);
    close(remapToScreen([3, 4, 1], 270), remapToScreen([3, 4, 1], -90));
  });

  it('upside down flips x and y', () => {
    close(remapToScreen([1, 2, 3], 180), [-1, -2, 3]);
  });

  it('preserves magnitude and z for every rotation', () => {
    const v: Vec3 = [1.5, -2.25, 0.75];
    for (const a of [0, 90, 180, 270, -90]) {
      const r = remapToScreen(v, a);
      expect(Math.hypot(...r)).toBeCloseTo(Math.hypot(...v), 12);
      expect(r[2]).toBe(v[2]);
    }
  });

  it('does not mutate the input', () => {
    const v: Vec3 = [1, 2, 3];
    remapToScreen(v, 90);
    expect(v).toEqual([1, 2, 3]);
  });
});

describe('signFixFrom', () => {
  const grav = (betaDeg: number, gammaDeg = 0, sign = 1): Vec3 => {
    const b = (betaDeg * Math.PI) / 180;
    const g = (gammaDeg * Math.PI) / 180;
    return [-G * Math.cos(b) * Math.sin(g) * sign, G * Math.sin(b) * sign, G * Math.cos(b) * Math.cos(g) * sign];
  };

  it('accepts readings that follow the W3C sign convention', () => {
    expect(signFixFrom(grav(60), 60)).toBe(1);
    expect(signFixFrom(grav(0), 0)).toBe(1);
    expect(signFixFrom(grav(90), 90)).toBe(1);
    expect(signFixFrom(grav(45, 20), 45, 20)).toBe(1);
  });

  it('flags inverted (legacy iOS) readings', () => {
    expect(signFixFrom(grav(60, 0, -1), 60)).toBe(-1);
    expect(signFixFrom(grav(0, 0, -1), 0)).toBe(-1);
    expect(signFixFrom(grav(30, -15, -1), 30, -15)).toBe(-1);
  });

  it('stays at 1 when the evidence is weak or invalid', () => {
    expect(signFixFrom([0, 0.5, 0.5], 60)).toBe(1); // nowhere near 1 g
    expect(signFixFrom([0, 40, 0], 60)).toBe(1); // violent motion
    expect(signFixFrom(grav(60, 0, -1), Number.NaN)).toBe(1);
    expect(signFixFrom([Number.NaN, 1, 1], 60)).toBe(1);
    // Device on its side: gravity along x tells nothing about the y/z sign.
    expect(signFixFrom([G, 0, 0], 0, 90)).toBe(1);
  });
});

describe('PeakDetector', () => {
  it('fires on the rising edge only', () => {
    const p = new PeakDetector(11, 70);
    expect(p.push(5, 0)).toBe(false);
    expect(p.push(12, 10)).toBe(true);
    expect(p.push(14, 20)).toBe(false);
    expect(p.push(13, 100)).toBe(false); // still high, not yet 4× refractory
  });

  it('respects the refractory period after re-arming', () => {
    const p = new PeakDetector(11, 70);
    expect(p.push(12, 0)).toBe(true);
    expect(p.push(2, 20)).toBe(false);
    expect(p.push(12, 40)).toBe(false); // re-armed but within 70 ms
    expect(p.push(12, 80)).toBe(true);
  });

  it('keeps ticking under sustained violent shaking', () => {
    const p = new PeakDetector(11, 70);
    let fires = 0;
    for (let t = 0; t <= 1000; t += 10) if (p.push(20, t)) fires++;
    expect(fires).toBeGreaterThanOrEqual(3);
    expect(fires).toBeLessThanOrEqual(4);
  });

  it('counts each oscillation of a 5 Hz shake once', () => {
    const p = new PeakDetector(11, 70);
    let fires = 0;
    for (let t = 0; t < 2000; t += 16) {
      const mag = 14 * Math.abs(Math.sin((2 * Math.PI * 5 * t) / 1000));
      if (p.push(mag, t)) fires++;
    }
    // |sin| at 5 Hz has 20 humps in 2 s.
    expect(fires).toBeGreaterThanOrEqual(18);
    expect(fires).toBeLessThanOrEqual(20);
  });

  it('ignores NaN and resets', () => {
    const p = new PeakDetector(11, 70);
    expect(p.push(Number.NaN, 0)).toBe(false);
    expect(p.push(12, 1)).toBe(true);
    p.reset();
    expect(p.push(12, 2)).toBe(true);
  });
});

describe('ShakeIntegrator', () => {
  const C = CFG.sensors;
  const run = (si: ShakeIntegrator, mag: number, seconds: number, boost = 1, dt = 1 / 60) => {
    let latchedAt = -1;
    let r = si.step(0, 0);
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      r = si.step(mag, dt, boost);
      if (r.justLatched) latchedAt = (i + 1) * dt;
    }
    return { r, latchedAt };
  };

  it('fills from energy above the deadzone', () => {
    const si = new ShakeIntegrator(C);
    const r = si.step(C.deadzone + 10, 0.1);
    expect(r.meter).toBeCloseTo(0.1, 12);
    expect(r.latched).toBe(false);
  });

  it('takes about 1.2 s of honest shaking at 12 m/s²', () => {
    const { latchedAt } = run(new ShakeIntegrator(C), 12, 2);
    expect(latchedAt).toBeGreaterThan(1.1);
    expect(latchedAt).toBeLessThan(1.25);
  });

  it('hold fills in 1.4 s and quick draw in 1.2 s', () => {
    const hold = run(new ShakeIntegrator(C), holdMag(C), 2);
    expect(hold.latchedAt).toBeGreaterThan(1.38);
    expect(hold.latchedAt).toBeLessThan(1.42);
    const quick = run(new ShakeIntegrator(C), quickMag(C), C.quickDrawSec);
    expect(quick.r.latched).toBe(true);
    expect(quick.latchedAt).toBeLessThanOrEqual(C.quickDrawSec + 1e-9);
    expect(holdMag(C)).toBeCloseTo(3.5 + 10 / 1.4, 9);
    expect(quickMag(C)).toBeCloseTo(3.5 + 10 / 1.2, 9);
  });

  it('applies the tilt boost', () => {
    const plain = run(new ShakeIntegrator(C), 12, 0.5).r.meter;
    const boosted = run(new ShakeIntegrator(C), 12, 0.5, C.tiltBoost).r.meter;
    expect(boosted / plain).toBeCloseTo(C.tiltBoost, 6);
  });

  it('decays below the deadzone and never goes negative', () => {
    const si = new ShakeIntegrator(C);
    si.meter = 0.5;
    const r = si.step(1, 1);
    expect(r.meter).toBeCloseTo(0.5 - C.decayPerSec, 12);
    expect(si.step(0, 10).meter).toBe(0);
  });

  it('latches once, then holds full without decay', () => {
    const si = new ShakeIntegrator(C);
    const first = si.step(C.deadzone + 100, 0.2);
    expect(first.justLatched).toBe(true);
    expect(first.meter).toBe(1);
    const later = si.step(0, 5);
    expect(later.latched).toBe(true);
    expect(later.justLatched).toBe(false);
    expect(later.meter).toBe(1);
  });

  it('syncs with externally forced state and resets', () => {
    const si = new ShakeIntegrator(C);
    si.meter = 1;
    si.latched = true;
    expect(si.step(0, 1).justLatched).toBe(false);
    si.reset();
    expect(si.meter).toBe(0);
    expect(si.latched).toBe(false);
  });

  it('is robust to bad input', () => {
    const si = new ShakeIntegrator(C);
    expect(si.step(Number.NaN, 0.1).meter).toBe(0);
    expect(si.step(20, -1).meter).toBe(0);
    expect(si.step(20, Number.POSITIVE_INFINITY).meter).toBe(0);
    expect(si.step(-50, 0.1).meter).toBe(0);
  });
});

describe('misc helpers', () => {
  it('energyFrom maps the low-passed magnitude to 0..1', () => {
    expect(energyFrom(0, 3.5)).toBe(0);
    expect(energyFrom(3.5, 3.5)).toBe(0);
    expect(energyFrom(9.5, 3.5)).toBeCloseTo(0.5, 12);
    expect(energyFrom(40, 3.5)).toBe(1);
  });

  it('pointerMag scales and clamps', () => {
    expect(pointerMag(40, 0.25)).toBe(10);
    expect(pointerMag(-40, 0.25)).toBe(10);
    expect(pointerMag(1000, 0.25)).toBe(25);
    expect(pointerMag(Number.NaN, 0.25)).toBe(0);
  });

  it('forward range is inclusive', () => {
    expect(inForwardRange(15, [15, 50])).toBe(true);
    expect(inForwardRange(50, [15, 50])).toBe(true);
    expect(inForwardRange(14.9, [15, 50])).toBe(false);
    expect(inForwardRange(-20, [15, 50])).toBe(false);
  });

  it('angleDiff wraps to the shortest signed difference', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(-170, 170)).toBe(20);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(45, 45)).toBe(0);
  });
});
