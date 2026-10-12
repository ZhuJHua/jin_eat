import { describe, expect, it } from 'vitest';
import type { DrawResult, LevelId, Restaurant } from '@/types';
import {
  composeLocalCopy,
  GENERIC_JIE,
  GENERIC_POEM_LINES,
  JI_POOL,
  LEVEL_CLOSERS,
  LEVEL_ORDER,
  LEVELS,
  RESTAURANT_COPY,
  SHANGSHANG_PREFIX,
  TREAT_COPY,
  WEEKDAY_JIE,
  XIAXIA_JIE,
  YI_POOL,
} from '@/data/fortunes';
import { charLen, DEFAULT_RESTAURANTS, listSignature, RESTAURANT_META, taglineFor } from '@/data/restaurants';
import { addDays } from '@/lib/date';

const SEVEN_HAN = /^[一-鿿]{7}$/u;
const LONG_NAME = '八个字的超长店名呀';
const NAME8 = LONG_NAME.slice(0, 8);

const allPoemLines = (): string[] => [
  ...Object.values(RESTAURANT_COPY).flatMap((c) => c.poems.flat()),
  ...GENERIC_POEM_LINES,
  ...Object.values(LEVEL_CLOSERS).flat(),
];

function draw(r: Restaurant, level: LevelId, date = '2026-10-12', patch: Partial<DrawResult> = {}): DrawResult {
  return {
    id: 'x',
    date,
    ts: 0,
    restaurantId: r.id,
    restaurantName: r.name,
    index: 0,
    stickNo: 1,
    level,
    treat: false,
    tease: false,
    decoyIndex: null,
    team: null,
    weightsPct: {},
    ...patch,
  };
}

describe('copy bank limits', () => {
  it('every poem line is exactly 7 Han characters', () => {
    for (const line of allPoemLines()) expect(line, line).toMatch(SEVEN_HAN);
  });

  it('every restaurant poem has 4 lines and no duplicate lines within a poem', () => {
    for (const [id, c] of Object.entries(RESTAURANT_COPY)) {
      for (const poem of c.poems) {
        expect(poem, id).toHaveLength(4);
        expect(new Set(poem).size, id).toBe(4);
      }
    }
  });

  it('has copy and a tagline for every default restaurant', () => {
    expect(DEFAULT_RESTAURANTS.map((r) => r.id)).toEqual([
      'xiaogu',
      'hmj',
      'plaza',
      'datong',
      'gaima',
      'jxxc',
      'jianggu',
      'daoxiang',
      'xbf',
    ]);
    for (const r of DEFAULT_RESTAURANTS) {
      const c = RESTAURANT_COPY[r.id];
      expect(c, r.id).toBeDefined();
      expect(c!.poems.length, r.id).toBeGreaterThanOrEqual(1);
      expect(c!.jie.length, r.id).toBeGreaterThanOrEqual(3);
      expect(RESTAURANT_META[r.id]?.tagline, r.id).toBeTruthy();
    }
  });

  it('has large enough generic pools for variety', () => {
    expect(new Set(GENERIC_POEM_LINES).size).toBe(GENERIC_POEM_LINES.length);
    expect(GENERIC_POEM_LINES.length).toBeGreaterThanOrEqual(16);
    expect(GENERIC_JIE.length).toBeGreaterThanOrEqual(20);
    expect(YI_POOL.length).toBeGreaterThanOrEqual(12);
    expect(JI_POOL.length).toBeGreaterThanOrEqual(12);
    for (const l of LEVEL_ORDER) expect(LEVEL_CLOSERS[l].length).toBeGreaterThanOrEqual(3);
  });

  it('fortune explanation (解曰) templates fit 30 chars even with an 8-char name', () => {
    const templates = [
      ...GENERIC_JIE,
      ...XIAXIA_JIE,
      ...Object.values(WEEKDAY_JIE).flat(),
      ...Object.values(RESTAURANT_COPY).flatMap((c) => c.jie),
      TREAT_COPY.jie,
    ];
    for (const t of templates) {
      const filled = t!.split('{name}').join(NAME8);
      expect(charLen(filled), filled).toBeLessThanOrEqual(30);
    }
    for (const p of SHANGSHANG_PREFIX) expect(charLen(p)).toBeLessThanOrEqual(6);
  });

  it('do (宜) lines fit 8 chars and avoid (忌) lines fit 10 chars', () => {
    const yi = [...YI_POOL, ...Object.values(RESTAURANT_COPY).flatMap((c) => c.yi ?? []), TREAT_COPY.yi];
    const ji = [...JI_POOL, ...Object.values(RESTAURANT_COPY).flatMap((c) => c.ji ?? [])];
    for (const s of yi) expect(charLen(s), s).toBeLessThanOrEqual(8);
    for (const s of ji) expect(charLen(s), s).toBeLessThanOrEqual(10);
  });

  it('level labels', () => {
    expect(LEVELS.shangshang.label).toBe('上上签');
    expect(LEVELS.xiaxia.label).toBe('下下签·但依然好吃');
  });
});

describe('composeLocalCopy', () => {
  const custom: Restaurant = { id: 'r-1234abcd', name: NAME8, weight: 1, closedOn: null };
  const everyone = [...DEFAULT_RESTAURANTS, custom];

  it('respects every limit across many dates, restaurants and levels', () => {
    for (let k = 0; k < 21; k++) {
      const date = addDays('2026-10-12', k);
      for (const r of everyone) {
        for (const level of LEVEL_ORDER) {
          const c = composeLocalCopy({ draw: draw(r, level, date), restaurant: r, recentJie: [] });
          expect(c.poem).toHaveLength(4);
          for (const line of c.poem) expect(line).toMatch(SEVEN_HAN);
          expect(new Set(c.poem).size).toBe(4);
          expect(charLen(c.jie)).toBeLessThanOrEqual(30);
          expect(c.jie).not.toContain('{name}');
          expect(charLen(c.yi)).toBeLessThanOrEqual(8);
          expect(charLen(c.ji)).toBeLessThanOrEqual(10);
          expect(c.source).toBe('local');
        }
      }
    }
  });

  it('is deterministic per (date, restaurant, level)', () => {
    const r = DEFAULT_RESTAURANTS[1]!;
    const a = composeLocalCopy({ draw: draw(r, 'shang'), restaurant: r, recentJie: [] });
    const b = composeLocalCopy({ draw: { ...draw(r, 'shang'), id: 'other', ts: 999 }, restaurant: r, recentJie: [] });
    expect(a).toEqual(b);
    const days = new Set<string>();
    for (let k = 0; k < 14; k++)
      days.add(JSON.stringify(composeLocalCopy({ draw: draw(r, 'shang', addDays('2026-10-12', k)), restaurant: r, recentJie: [] })));
    expect(days.size).toBeGreaterThan(5);
  });

  it('team copy is keyed by name, not the device-local id', () => {
    for (const level of LEVEL_ORDER) {
      const a: Restaurant = { id: 'r-aaaa1111', name: '楼下麻辣烫', weight: 1, closedOn: null };
      const b: Restaurant = { id: 'r-bbbb2222', name: '楼下麻辣烫', weight: 1, closedOn: null };
      const ca = composeLocalCopy({ draw: draw(a, level, '2026-10-12', { team: '三楼' }), restaurant: a, recentJie: [] });
      const cb = composeLocalCopy({ draw: draw(b, level, '2026-10-12', { team: '三楼' }), restaurant: b, recentJie: [] });
      expect(ca).toEqual(cb);
    }
  });

  it('custom restaurants get generic lines ending with a level closer', () => {
    for (const level of LEVEL_ORDER) {
      const c = composeLocalCopy({ draw: draw(custom, level), restaurant: custom, recentJie: [] });
      expect(LEVEL_CLOSERS[level]).toContain(c.poem[3]);
      for (const l of c.poem.slice(0, 3)) expect(GENERIC_POEM_LINES).toContain(l);
    }
  });

  it('a re-added default name keeps its own copy', () => {
    const readded: Restaurant = { id: 'r-deadbeef', name: '黄焖鸡', weight: 1, closedOn: null };
    expect(taglineFor(readded)).toBe('酱汁拌饭第三碗');
    expect(taglineFor(custom)).toBe(`锦少私藏 · ${NAME8}`);
  });

  it('avoids recently shown explanations', () => {
    const r = DEFAULT_RESTAURANTS[0]!;
    for (let k = 0; k < 30; k++) {
      const d = draw(r, 'zhongji', addDays('2026-10-12', k));
      const first = composeLocalCopy({ draw: d, restaurant: r, recentJie: [] });
      const second = composeLocalCopy({ draw: d, restaurant: r, recentJie: [first.jie] });
      expect(second.jie).not.toBe(first.jie);
    }
  });

  it('uses the override copy for treat (请客签) and worst-level (下下签) draws', () => {
    const r = DEFAULT_RESTAURANTS[2]!;
    const t = composeLocalCopy({ draw: draw(r, 'shang', '2026-10-12', { treat: true }), restaurant: r, recentJie: [] });
    expect(t.jie).toBe(TREAT_COPY.jie);
    expect(t.yi).toBe(TREAT_COPY.yi);
    const filledXia = XIAXIA_JIE.map((s) => s.split('{name}').join(r.name));
    for (let k = 0; k < 10; k++) {
      const x = composeLocalCopy({ draw: draw(r, 'xiaxia', addDays('2026-10-12', k)), restaurant: r, recentJie: [] });
      expect(filledXia).toContain(x.jie);
    }
  });

  it('often prefixes the explanation for top-level (上上签) draws', () => {
    let prefixed = 0;
    for (let k = 0; k < 40; k++) {
      const r = DEFAULT_RESTAURANTS[k % 9]!;
      const c = composeLocalCopy({ draw: draw(r, 'shangshang', addDays('2026-10-12', k)), restaurant: r, recentJie: [] });
      if (SHANGSHANG_PREFIX.some((p) => c.jie.startsWith(p))) prefixed++;
    }
    expect(prefixed).toBeGreaterThan(20);
  });
});

describe('listSignature', () => {
  it('is 4 hex chars and order-sensitive', () => {
    const a = listSignature(DEFAULT_RESTAURANTS);
    expect(a).toMatch(/^[0-9a-f]{4}$/);
    expect(listSignature([...DEFAULT_RESTAURANTS].reverse())).not.toBe(a);
  });
});
