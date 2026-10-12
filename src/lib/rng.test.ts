import { describe, expect, it } from 'vitest';
import { chance, cryptoSource, fnv1a32, sfc32FromString, uniformFloat, uniformInt, uuid, weightedPick, type RandomSource } from '@/lib/rng';
import { addDays, mondayOf, toChineseNumeral, todayKey, weekdayZh } from '@/lib/date';
import { readJSON, safeStorage, writeJSON } from '@/lib/storage';

/** Chi-square statistic for observed counts against a uniform expectation. */
function chiSquare(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const e = total / counts.length;
  return counts.reduce((acc, c) => acc + ((c - e) * (c - e)) / e, 0);
}

function histogram(n: number, draws: number, src: RandomSource): number[] {
  const counts = new Array<number>(n).fill(0);
  for (let i = 0; i < draws; i++) counts[uniformInt(n, src)]!++;
  return counts;
}

describe('fnv1a32', () => {
  it('matches reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
  it('hashes the UTF-8 bytes of non-ASCII text', () => {
    // Team mode seeds from these hashes, so every device must agree byte for byte.
    expect(fnv1a32('锦少')).toBe(0x268ac85a);
    expect(fnv1a32('黄焖鸡')).toBe(0x4a29ebde);
  });
});

describe('sfc32FromString', () => {
  it('is deterministic per seed', () => {
    const a = sfc32FromString('2026-10-12|team|abcd');
    const b = sfc32FromString('2026-10-12|team|abcd');
    const sa = Array.from({ length: 32 }, () => a.nextUint32());
    const sb = Array.from({ length: 32 }, () => b.nextUint32());
    expect(sa).toEqual(sb);
    expect(sa.every((x) => Number.isInteger(x) && x >= 0 && x < 2 ** 32)).toBe(true);
  });
  it('differs between seeds', () => {
    const a = sfc32FromString('x');
    const b = sfc32FromString('y');
    expect(Array.from({ length: 8 }, () => a.nextUint32())).not.toEqual(Array.from({ length: 8 }, () => b.nextUint32()));
  });
  it('skip advances the stream by exactly that many outputs', () => {
    const base = sfc32FromString('seed');
    for (let i = 0; i < 16; i++) base.nextUint32();
    const skipped = sfc32FromString('seed', 16);
    expect(skipped.nextUint32()).toBe(base.nextUint32());
  });
});

describe('uniformInt', () => {
  it('passes chi-square uniformity (seeded, p > 0.01) over 90k draws', () => {
    const counts = histogram(9, 90_000, sfc32FromString('chi-square'));
    // 8 degrees of freedom: critical value at p = 0.01 is 20.09.
    expect(chiSquare(counts)).toBeLessThan(20.09);
  });
  it('passes chi-square uniformity with crypto (p > 0.0001) over 90k draws', () => {
    const counts = histogram(16, 90_000, cryptoSource);
    // 15 dof: critical value at p = 0.0001 is 44.26 (keeps the test effectively non-flaky).
    expect(chiSquare(counts)).toBeLessThan(44.26);
  });
  it('handles n = 1 and rejects bad n', () => {
    expect(uniformInt(1)).toBe(0);
    expect(() => uniformInt(0)).toThrow();
  });
  it('retries draws from the rejection tail instead of taking a biased modulo', () => {
    // 0xffffffff lies in the tail that would bias n = 3, so the next value must be used.
    const values = [0xffffffff, 7];
    let i = 0;
    const src: RandomSource = { nextUint32: () => values[i++]! };
    expect(uniformInt(3, src)).toBe(7 % 3);
  });
});

describe('uniformFloat / chance', () => {
  it('stays in [0, 1)', () => {
    const src = sfc32FromString('float');
    for (let i = 0; i < 10_000; i++) {
      const x = uniformFloat(src);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(uniformFloat({ nextUint32: () => 0xffffffff })).toBeLessThan(1);
  });
  it('chance matches its probability', () => {
    const src = sfc32FromString('chance');
    let hits = 0;
    for (let i = 0; i < 50_000; i++) if (chance(0.3, src)) hits++;
    expect(hits / 50_000).toBeCloseTo(0.3, 1);
  });
});

describe('weightedPick', () => {
  it('follows weights and never picks zero weight', () => {
    const src = sfc32FromString('weighted');
    const w = [1, 2, 3, 0];
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[weightedPick(w, (x) => x, src)]!++;
    expect(counts[3]).toBe(0);
    expect(counts[0]! / 60_000).toBeCloseTo(1 / 6, 1);
    expect(counts[1]! / 60_000).toBeCloseTo(2 / 6, 1);
    expect(counts[2]! / 60_000).toBeCloseTo(3 / 6, 1);
  });
  it('falls back to uniform when all weights are zero and -1 when empty', () => {
    const src = sfc32FromString('zero');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(weightedPick([0, 0, 0], () => 0, src));
    expect(seen).toEqual(new Set([0, 1, 2]));
    expect(weightedPick([], () => 1)).toBe(-1);
  });
});

describe('uuid', () => {
  it('produces v4 uuids from any source', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid(sfc32FromString('u'))).toMatch(re);
    expect(uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('date helpers', () => {
  it('formats local day keys', () => {
    expect(todayKey(new Date(2026, 9, 12, 23, 59))).toBe('2026-10-12');
    expect(addDays('2026-10-12', -12)).toBe('2026-09-30');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday → previous Monday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(weekdayZh(new Date(2026, 9, 16))).toBe('周五');
  });
  it('writes Chinese numerals 1..99', () => {
    expect(toChineseNumeral(1)).toBe('一');
    expect(toChineseNumeral(7)).toBe('七');
    expect(toChineseNumeral(10)).toBe('十');
    expect(toChineseNumeral(16)).toBe('十六');
    expect(toChineseNumeral(20)).toBe('二十');
    expect(toChineseNumeral(99)).toBe('九十九');
  });
});

describe('safeStorage', () => {
  it('falls back to memory without localStorage', () => {
    safeStorage.setItem('k', 'v');
    expect(safeStorage.getItem('k')).toBe('v');
    writeJSON('j', { a: 1 });
    expect(readJSON('j', { a: 0 })).toEqual({ a: 1 });
    safeStorage.setItem('bad', '{');
    expect(readJSON('bad', 5)).toBe(5);
    safeStorage.removeItem('k');
    expect(safeStorage.getItem('k')).toBeNull();
  });
});
