import { describe, expect, it } from 'vitest';
import type { DayState, DrawResult, HistoryEntry, Restaurant, Settings } from '@/types';
import { computeWeights, dayFinals, pickDraw, TEAM_STREAM_STRIDE } from '@/draw/pick';
import { defaultRestaurants, listSignature } from '@/data/restaurants';
import { addDays } from '@/lib/date';

const TODAY = '2026-10-12';

const settings = (patch: Partial<Settings> = {}): Settings => ({
  sound: true,
  haptics: true,
  antiRepeat: true,
  ritualJiaobei: true,
  lowMotion: 'system',
  motionSensitivity: 'mid',
  quality: 'auto',
  teamMode: false,
  teamPhrase: '',
  motionStatus: 'unknown',
  ...patch,
});

const day = (patch: Partial<DayState> = {}): DayState => ({
  date: TODAY,
  lockedDrawId: null,
  vetoUsed: false,
  teamDrawCount: 0,
  excluded: [],
  xiaoStreak: 0,
  ...patch,
});

let seq = 0;
function entry(date: string, r: Restaurant, patch: Partial<HistoryEntry> = {}, ts?: number): HistoryEntry {
  seq++;
  const draw: DrawResult = {
    id: `d${seq}`,
    date,
    ts: ts ?? Date.parse(date + 'T12:00:00') + seq,
    restaurantId: r.id,
    restaurantName: r.name,
    index: 0,
    stickNo: 1,
    level: 'shang',
    treat: false,
    tease: false,
    decoyIndex: null,
    team: null,
    weightsPct: {},
  };
  return {
    draw,
    copy: { poem: ['', '', '', ''], jie: '', yi: '', ji: '', source: 'local' },
    confirmed: false,
    vetoed: false,
    jiaobei: [],
    ...patch,
  };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('computeWeights', () => {
  it('uses base weights and sums to 100%', () => {
    const list = defaultRestaurants();
    list[1]!.weight = 3;
    list[2]!.weight = 0;
    const rows = computeWeights({ list, history: [], settings: settings({ antiRepeat: false }), day: day(), today: TODAY });
    expect(rows.map((r) => r.weight)).toEqual([1, 3, 0, 1, 1, 1, 1, 1, 1]);
    expect(sum(rows.map((r) => r.pct))).toBeCloseTo(100, 6);
  });

  it('zeroes closed-today and excluded entries only', () => {
    const list = defaultRestaurants();
    list[0]!.closedOn = TODAY;
    list[1]!.closedOn = addDays(TODAY, -1); // closed yesterday: open today
    const rows = computeWeights({
      list,
      history: [],
      settings: settings({ antiRepeat: false }),
      day: day({ excluded: [list[2]!.id] }),
      today: TODAY,
    });
    expect(rows[0]!.weight).toBe(0);
    expect(rows[1]!.weight).toBe(1);
    expect(rows[2]!.weight).toBe(0);
  });

  it('ignores a stale day state', () => {
    const list = defaultRestaurants();
    const rows = computeWeights({
      list,
      history: [],
      settings: settings({ antiRepeat: false }),
      day: day({ date: addDays(TODAY, -1), excluded: [list[0]!.id] }),
      today: TODAY,
    });
    expect(rows[0]!.weight).toBe(1);
  });

  it('applies anti-repeat multipliers by draw-day', () => {
    const list = defaultRestaurants();
    const [a, b, c, d] = list as [Restaurant, Restaurant, Restaurant, Restaurant];
    const history = [
      entry(addDays(TODAY, -1), a),
      entry(addDays(TODAY, -2), b),
      entry(addDays(TODAY, -2), c, {}, Date.parse(addDays(TODAY, -2) + 'T09:00:00')), // earlier same day: not final
      entry(addDays(TODAY, -3), c),
      entry(addDays(TODAY, -5), d),
    ];
    const rows = computeWeights({ list, history, settings: settings(), day: day(), today: TODAY });
    const w = Object.fromEntries(rows.map((r) => [r.id, r.weight]));
    expect(w[a.id]).toBeCloseTo(0.3);
    expect(w[b.id]).toBeCloseTo(0.6);
    expect(w[c.id]).toBeCloseTo(0.6);
    expect(w[d.id]).toBeCloseTo(1); // rank 3: neither recent nor cold
    expect(w[list[4]!.id]).toBeCloseTo(1.4); // never picked: cold bonus
    expect(sum(rows.map((r) => r.pct))).toBeCloseTo(100, 6);
  });

  it("today's unconfirmed draws do not shift yesterday's anti-repeat rank", () => {
    const list = defaultRestaurants();
    const [a, b] = list as [Restaurant, Restaurant];
    const past = [entry(addDays(TODAY, -1), a, { confirmed: true })];
    const before = computeWeights({ list, history: past, settings: settings(), day: day(), today: TODAY });
    const after = computeWeights({ list, history: [entry(TODAY, b), ...past], settings: settings(), day: day(), today: TODAY });
    expect(after.find((r) => r.id === a.id)!.weight).toBeCloseTo(0.3);
    expect(after.map((r) => r.weight)).toEqual(before.map((r) => r.weight));
  });

  it('anti-repeat off leaves weights untouched', () => {
    const list = defaultRestaurants();
    const rows = computeWeights({
      list,
      history: [entry(addDays(TODAY, -1), list[0]!)],
      settings: settings({ antiRepeat: false }),
      day: day(),
      today: TODAY,
    });
    expect(rows.every((r) => r.weight === 1)).toBe(true);
  });

  it('falls back to uniform over open entries, then everything', () => {
    const list = defaultRestaurants().map((r) => ({ ...r, weight: 0 }));
    list[0]!.closedOn = TODAY;
    let rows = computeWeights({ list, history: [], settings: settings(), day: day(), today: TODAY });
    expect(rows[0]!.pct).toBe(0);
    expect(rows[1]!.pct).toBeCloseTo(100 / 8);
    const closed = defaultRestaurants().map((r) => ({ ...r, closedOn: TODAY }));
    rows = computeWeights({ list: closed, history: [], settings: settings(), day: day(), today: TODAY });
    expect(rows.every((r) => Math.abs(r.pct - 100 / 9) < 1e-9)).toBe(true);
  });

  it('team mode is uniform over the whole list regardless of history/closed', () => {
    const list = defaultRestaurants();
    list[0]!.closedOn = TODAY;
    const rows = computeWeights({
      list,
      history: [entry(addDays(TODAY, -1), list[1]!)],
      settings: settings({ teamMode: true, teamPhrase: '三楼' }),
      day: day({ excluded: [list[2]!.id] }),
      today: TODAY,
    });
    expect(rows.every((r) => r.weight === 1)).toBe(true);
  });
});

describe('dayFinals', () => {
  it('prefers the confirmed entry and skips vetoed or jiaobei-rejected ones', () => {
    const list = defaultRestaurants();
    const d1 = addDays(TODAY, -1);
    const history = [
      entry(d1, list[0]!, { vetoed: true }, Date.parse(d1 + 'T13:00:00')),
      entry(d1, list[1]!, { jiaobei: ['yin'] }, Date.parse(d1 + 'T12:30:00')),
      entry(d1, list[2]!, {}, Date.parse(d1 + 'T12:20:00')),
      entry(d1, list[3]!, { confirmed: true }, Date.parse(d1 + 'T12:00:00')),
      entry(addDays(TODAY, -2), list[4]!),
    ];
    expect(dayFinals(history)).toEqual([
      { date: d1, restaurantId: list[3]!.id },
      { date: addDays(TODAY, -2), restaurantId: list[4]!.id },
    ]);
  });
});

describe('pickDraw', () => {
  const base = {
    list: defaultRestaurants(),
    history: [] as HistoryEntry[],
    settings: settings(),
    day: day(),
    today: TODAY,
    reducedMotion: false,
  };

  it('returns a consistent draw', () => {
    for (let i = 0; i < 300; i++) {
      const d = pickDraw(base);
      expect(d.restaurantId).toBe(base.list[d.index]!.id);
      expect(d.stickNo).toBe(d.index + 1);
      expect(d.date).toBe(TODAY);
      if (d.tease) {
        expect(d.decoyIndex).not.toBeNull();
        expect(d.decoyIndex).not.toBe(d.index);
        expect(d.decoyIndex!).toBeGreaterThanOrEqual(0);
        expect(d.decoyIndex!).toBeLessThan(base.list.length);
      } else expect(d.decoyIndex).toBeNull();
      expect(sum(Object.values(d.weightsPct))).toBeCloseTo(100, 1);
    }
  });

  it('never teases under reduced motion', () => {
    for (let i = 0; i < 200; i++) expect(pickDraw({ ...base, reducedMotion: true }).tease).toBe(false);
  });

  it('never picks closed or excluded entries', () => {
    const list = defaultRestaurants();
    list[0]!.closedOn = TODAY;
    for (let i = 0; i < 300; i++) {
      const d = pickDraw({ ...base, list, day: day({ excluded: [list[1]!.id] }) });
      expect(d.index).toBeGreaterThan(1);
    }
  });

  it('matches computeWeights statistically', () => {
    const list = defaultRestaurants();
    list[0]!.weight = 3;
    const args = { ...base, list, settings: settings({ antiRepeat: false }) };
    const rows = computeWeights(args);
    const counts = new Array<number>(list.length).fill(0);
    const N = 20_000;
    for (let i = 0; i < N; i++) counts[pickDraw(args).index]!++;
    rows.forEach((r, i) => expect(counts[i]! / N).toBeCloseTo(r.pct / 100, 1));
  });

  it('team mode is deterministic across devices and histories', () => {
    const team = settings({ teamMode: true, teamPhrase: '  三楼干饭队 ' });
    const a = pickDraw({ ...base, settings: team });
    const b = pickDraw({
      ...base,
      settings: settings({ teamMode: true, teamPhrase: '三楼干饭队', antiRepeat: false }),
      history: [entry(addDays(TODAY, -1), base.list[0]!)],
      reducedMotion: true,
    });
    const strip = (d: DrawResult) => ({ index: d.index, level: d.level, treat: d.treat, decoy: d.decoyIndex, team: d.team });
    expect(strip(a).index).toBe(strip(b).index);
    expect(a.level).toBe(b.level);
    expect(a.treat).toBe(b.treat);
    expect(a.team).toBe('三楼干饭队');
    // b ran with reduced motion: tease is forced off but the stream stays aligned.
    expect(b.tease).toBe(false);
  });

  it('team stream offsets give a different (but reproducible) 2nd draw', () => {
    const team = settings({ teamMode: true, teamPhrase: 'abc' });
    const seqFor = (count: number) =>
      Array.from({ length: 1 }, () => pickDraw({ ...base, settings: team, day: day({ teamDrawCount: count }) })).map((d) => [
        d.index,
        d.level,
        d.treat,
        d.tease,
        d.decoyIndex,
      ]);
    expect(seqFor(1)).toEqual(seqFor(1));
    const firsts = new Set<string>();
    for (let k = 0; k < 12; k++) firsts.add(JSON.stringify(seqFor(k)));
    expect(firsts.size).toBeGreaterThan(3);
    expect(TEAM_STREAM_STRIDE).toBeGreaterThanOrEqual(9);
  });

  it('team mode varies with the date, and renaming a restaurant changes the list signature', () => {
    const team = settings({ teamMode: true, teamPhrase: 'abc' });
    const renamed = defaultRestaurants();
    renamed[0]!.name = '新店';
    expect(listSignature(renamed)).not.toBe(listSignature(base.list));
    const results = new Set<string>();
    for (let k = 0; k < 10; k++) {
      const date = addDays(TODAY, k);
      const d = pickDraw({ ...base, settings: team, today: date, day: day({ date }) });
      results.add(`${d.index}|${d.level}`);
    }
    expect(results.size).toBeGreaterThan(2);
  });
});
