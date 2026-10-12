import { describe, expect, it } from 'vitest';
import type { JiaobeiOutcome } from '@/types';
import { faceUp, JIAOBEI_DURATION, jiaobeiTargets, outcomeOf, rollJiaobei, sampleJiaobei } from '@/draw/jiaobei';
import { qAngle, qRotate } from '@/draw/math';
import { sfc32FromString } from '@/lib/rng';

describe('jiaobeiTargets', () => {
  it('lands the faces that match the outcome', () => {
    const outcomes: JiaobeiOutcome[] = ['sheng', 'xiao', 'yin'];
    for (const o of outcomes) {
      const firstFaces = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const t = jiaobeiTargets(o);
        expect(outcomeOf(t)).toBe(o);
        for (const q of t) {
          // Resting flat: the extrusion axis is vertical.
          expect(Math.abs(qRotate(q, [0, 0, 1])[1])).toBeCloseTo(1, 6);
        }
        firstFaces.add(faceUp(t[0]));
      }
      if (o === 'xiao') expect([...firstFaces]).toEqual(['flat']);
      if (o === 'yin') expect([...firstFaces]).toEqual(['round']);
      if (o === 'sheng') expect(firstFaces.size).toBe(2); // either block can be the flat one
    }
  });
});

describe('rollJiaobei', () => {
  it('rolls sheng/xiao/yin at 50/25/25', () => {
    const src = sfc32FromString('jiaobei-odds');
    const counts: Record<JiaobeiOutcome, number> = { sheng: 0, xiao: 0, yin: 0 };
    const N = 40_000;
    for (let i = 0; i < N; i++) counts[rollJiaobei(src)]++;
    expect(counts.sheng / N).toBeCloseTo(0.5, 1);
    expect(counts.xiao / N).toBeCloseTo(0.25, 1);
    expect(counts.yin / N).toBeCloseTo(0.25, 1);
  });
});

describe('sampleJiaobei', () => {
  const targets = jiaobeiTargets('sheng', sfc32FromString('t'));

  it('ends exactly on the targets and reports landings', () => {
    const start = sampleJiaobei(targets, 42, 0);
    expect(start.landedCount).toBe(0);
    expect(start.impacts).toBe(0);
    expect(start.done).toBe(false);
    const end = sampleJiaobei(targets, 42, JIAOBEI_DURATION);
    expect(end.done).toBe(true);
    expect(end.landedCount).toBe(2);
    expect(qAngle(end.poses[0].q, targets[0])).toBeLessThan(1e-6);
    expect(qAngle(end.poses[1].q, targets[1])).toBeLessThan(1e-6);
    expect(end.poses[0].p[0]).toBeCloseTo(-0.22);
    expect(end.poses[1].p[0]).toBeCloseTo(0.22);
    expect(end.poses[0].p[2]).toBeCloseTo(0.72);
  });

  it('is deterministic per seed, continuous, and counts impacts monotonically', () => {
    let prevImpacts = 0;
    let prev = sampleJiaobei(targets, 7, 0);
    for (let t = 1 / 120; t <= JIAOBEI_DURATION + 0.05; t += 1 / 120) {
      const s = sampleJiaobei(targets, 7, t);
      expect(s).toEqual(sampleJiaobei(targets, 7, t));
      expect(s.impacts).toBeGreaterThanOrEqual(prevImpacts);
      prevImpacts = s.impacts;
      for (const k of [0, 1] as const) {
        const d = Math.hypot(...s.poses[k].p.map((v, i) => v - prev.poses[k].p[i]!));
        expect(d).toBeLessThan(0.05);
        expect(s.poses[k].p[1]).toBeGreaterThanOrEqual(0.02 - 1e-9);
      }
      prev = s;
    }
    expect(prevImpacts).toBe(6); // 2 blocks × (first contact + 2 bounces)
  });
});
