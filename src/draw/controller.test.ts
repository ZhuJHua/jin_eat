import { beforeEach, describe, expect, it } from 'vitest';
import type { DrawResult } from '@/types';
import { DEFAULT_SETTINGS, freshDay, getState, useStore } from '@/state/store';
import { resetForDraw, rt } from '@/state/runtime';
import * as C from '@/draw/controller';
import { defaultRestaurants } from '@/data/restaurants';
import { lastAnnouncement } from '@/lib/announce';
import { bus } from '@/lib/bus';

const now = (): number => performance.now();

function resetStore(patch: Partial<ReturnType<typeof getState>> = {}): void {
  useStore.setState({
    phase: 'idle',
    drawer: null,
    pending: null,
    current: null,
    copy: null,
    history: [],
    day: freshDay(),
    settings: { ...DEFAULT_SETTINGS },
    restaurants: defaultRestaurants(),
    reducedMotion: false,
    jiaobeiResult: null,
    toast: null,
    ...patch,
  });
  resetForDraw();
}

/** Run one full draw through reveal and return the pending pick and the shown draw. */
function fullDraw(): { pending: DrawResult; shown: DrawResult } {
  C.beginShake('quick');
  const pending = getState().pending!;
  C.triggerDraw();
  const shown = getState().current!;
  C.onDrawingDone();
  return { pending, shown };
}

beforeEach(() => resetStore());

describe('draw flow', () => {
  it('shows exactly the pending pick, for 500 draws (including abandoned shakes)', () => {
    for (let i = 0; i < 500; i++) {
      C.beginShake('quick');
      expect(getState().phase).toBe('armed');
      const pending = getState().pending!;
      expect(pending).toBeTruthy();
      if (i % 7 === 0) {
        // Abandon and re-shake: the pick must not re-roll.
        getState().setPhase('idle');
        C.beginShake('motion');
        expect(getState().pending!.id).toBe(pending.id);
      }
      C.triggerDraw();
      const s = getState();
      expect(s.phase).toBe('drawing');
      expect(s.current!.id).toBe(pending.id);
      expect(s.current!.restaurantId).toBe(pending.restaurantId);
      expect(s.current!.level).toBe(pending.level);
      expect(s.pending).toBeNull();
      expect(s.history[0]!.draw.id).toBe(pending.id);
      expect(rt.hero.index).toBe(pending.index);
      C.onDrawingDone();
      expect(getState().phase).toBe('reveal');
      C.reshake();
      expect(getState().phase).toBe('resetting');
      C.onResetDone();
      expect(getState().phase).toBe('idle');
    }
    expect(getState().history.length).toBe(60);
  });

  it('announces the shake start and the full fortune on reveal, and emits reveal', () => {
    let revealed: DrawResult | null = null;
    const off = bus.on('reveal', (p) => (revealed = p.draw));
    C.beginShake('key');
    expect(lastAnnouncement()?.text).toBe('求签中…');
    C.triggerDraw();
    C.onDrawingDone();
    off();
    const s = getState();
    expect(revealed).toEqual(s.current);
    expect(lastAnnouncement()?.text).toBe(C.revealAnnouncement(s.current!, s.copy!));
    expect(lastAnnouncement()?.text).toMatch(/^(锦少请客签！)?今日签文：第.+签，.+签.*，.+。锦少大师解曰：.+ 宜.+，忌.+。$/);
  });

  it('ignores input while a drawer is open or outside idle/armed', () => {
    getState().openDrawer('list');
    C.beginShake('motion');
    C.quickDraw();
    expect(getState().phase).toBe('idle');
    getState().closeDrawer();
    fullDraw();
    C.beginShake('motion');
    C.quickDraw();
    expect(getState().phase).toBe('reveal');
  });

  it('reduced motion draws immediately on one press', () => {
    resetStore({ reducedMotion: true });
    C.quickDraw();
    expect(getState().phase).toBe('drawing');
    expect(getState().current!.tease).toBe(false);
  });

  it('invalidates the pending pick when the list changes', () => {
    C.beginShake('quick');
    expect(getState().pending).not.toBeNull();
    getState().setPhase('idle');
    getState().addRestaurant('新开的店');
    expect(getState().pending).toBeNull();
    expect(rt.sticks.count).toBe(10);
  });
});

describe('tick rules', () => {
  it('draws after the meter latches and the input is still for 250 ms', () => {
    C.beginShake('motion');
    const t = now();
    rt.shake.fullLatched = true;
    rt.shake.fullSince = t;
    rt.shake.stillMs = 100;
    C.tick(1 / 60, t + 10);
    expect(getState().phase).toBe('armed');
    rt.shake.stillMs = 260;
    C.tick(1 / 60, t + 20);
    expect(getState().phase).toBe('drawing');
  });

  it('forces the draw 2.5 s after full even while still shaking', () => {
    C.startHold('key');
    const t = now();
    rt.shake.fullLatched = true;
    rt.shake.fullSince = t;
    C.tick(1 / 60, t + 1000);
    expect(getState().phase).toBe('armed');
    C.tick(1 / 60, t + 2600);
    expect(getState().phase).toBe('drawing');
  });

  it('a quick draw always ends full and then draws', () => {
    C.quickDraw();
    const t = now();
    expect(rt.input.auto.kind).toBe('quick');
    C.tick(1 / 60, t + 1300);
    expect(rt.input.auto.active).toBe(false);
    expect(rt.shake.fullLatched).toBe(true);
    rt.shake.stillMs = 300;
    C.tick(1 / 60, t + 1600);
    expect(getState().phase).toBe('drawing');
  });

  it('abandons to idle after 4 s without input, keeping the pending pick', () => {
    C.beginShake('motion');
    const pending = getState().pending!;
    const t = now();
    rt.shake.meter = 0;
    rt.shake.lastInputTs = t;
    C.tick(1 / 60, t + 3000);
    expect(getState().phase).toBe('armed');
    C.tick(1 / 60, t + 4100);
    expect(getState().phase).toBe('idle');
    expect(getState().pending!.id).toBe(pending.id);
  });

  it('watchdogs finish a stalled draw and reset', () => {
    C.beginShake('quick');
    C.triggerDraw();
    C.tick(1 / 60, now() + 20_000);
    expect(getState().phase).toBe('reveal');
    C.reshake();
    C.tick(1 / 60, now() + 20_000);
    expect(getState().phase).toBe('idle');
  });

  it('mirrors the meter to the store at ≤ 10 Hz', () => {
    rt.shake.meter = 0.5;
    const t = now() + 50_000;
    C.tick(1 / 60, t);
    expect(getState().meterMirror).toBeCloseTo(0.5);
    rt.shake.meter = 0.6;
    C.tick(1 / 60, t + 30);
    expect(getState().meterMirror).toBeCloseTo(0.5);
    C.tick(1 / 60, t + 120);
    expect(getState().meterMirror).toBeCloseTo(0.6);
  });
});

describe('reveal actions', () => {
  it('confirm (就它了) locks today and a reload goes straight to the reveal', () => {
    const { shown } = fullDraw();
    C.confirm();
    expect(getState().day.lockedDrawId).toBe(shown.id);
    expect(getState().history[0]!.confirmed).toBe(true);
    // Simulate a reload.
    useStore.setState({ phase: 'boot', current: null, copy: null });
    C.bootTo(false);
    expect(getState().phase).toBe('reveal');
    expect(getState().current!.id).toBe(shown.id);
    expect(lastAnnouncement()?.text).toContain('今日已定');
  });

  it('veto works once per day, excludes the pick and quick-draws again', () => {
    const { shown } = fullDraw();
    C.veto();
    expect(getState().phase).toBe('resetting');
    expect(getState().day.vetoUsed).toBe(true);
    expect(getState().day.excluded).toContain(shown.restaurantId);
    expect(getState().history[0]!.vetoed).toBe(true);
    expect(rt.fx.flash).toBe(1);
    C.onResetDone();
    expect(getState().phase).toBe('armed');
    expect(getState().pending!.restaurantId).not.toBe(shown.restaurantId);
    C.triggerDraw();
    C.onDrawingDone();
    C.veto();
    expect(getState().phase).toBe('reveal');
  });

  it('confirm survives the history being cleared while the scroll is open', () => {
    const { shown } = fullDraw();
    getState().clearHistory();
    C.confirm();
    expect(getState().history[0]!.draw.id).toBe(shown.id);
    expect(getState().history[0]!.confirmed).toBe(true);
    useStore.setState({ phase: 'boot', current: null, copy: null });
    C.bootTo(false);
    expect(getState().phase).toBe('reveal');
    expect(getState().current!.id).toBe(shown.id);
  });

  it('a reveal left open past midnight is not locked onto the new day', () => {
    const { shown } = fullDraw();
    const stale = { ...shown, date: '2000-01-01' };
    useStore.setState({ current: stale });
    C.confirm();
    expect(getState().day.lockedDrawId).toBeNull();
    expect(getState().phase).toBe('resetting');
  });

  it('a locked reload resolves the hero stick by id after a reorder', () => {
    const { shown } = fullDraw();
    C.confirm();
    const list = [...getState().restaurants].reverse();
    useStore.setState({ restaurants: list, phase: 'boot', current: null, copy: null });
    C.bootTo(false);
    expect(rt.hero.index).toBe(list.findIndex((r) => r.id === shown.restaurantId));
  });

  it('veto is disabled in team mode', () => {
    resetStore({ settings: { ...DEFAULT_SETTINGS, teamMode: true, teamPhrase: '三楼' } });
    fullDraw();
    C.veto();
    expect(getState().phase).toBe('reveal');
    expect(getState().day.vetoUsed).toBe(false);
  });
});

describe('jiaobei (掷筊)', () => {
  function throwAs(o: 'sheng' | 'xiao' | 'yin'): void {
    C.throwJiaobei();
    expect(getState().phase).toBe('jiaobei');
    expect(rt.jiaobei.active).toBe(true);
    rt.jiaobei.outcome = o;
    C.onJiaobeiDone();
  }

  it('a sheng (圣筊) throw confirms', () => {
    const { shown } = fullDraw();
    throwAs('sheng');
    expect(getState().phase).toBe('reveal');
    expect(getState().jiaobeiResult).toBe('sheng');
    expect(getState().day.lockedDrawId).toBe(shown.id);
    expect(getState().history[0]!.jiaobei).toEqual(['sheng']);
  });

  it('three xiao (笑筊) throws in a row force acceptance', () => {
    const { shown } = fullDraw();
    throwAs('xiao');
    expect(getState().phase).toBe('jiaobei');
    expect(getState().day.xiaoStreak).toBe(1);
    throwAs('xiao');
    expect(getState().day.xiaoStreak).toBe(2);
    throwAs('xiao');
    expect(getState().phase).toBe('reveal');
    expect(getState().day.lockedDrawId).toBe(shown.id);
    expect(getState().day.xiaoStreak).toBe(0);
  });

  it('a locked reveal cannot be thrown again', () => {
    const { shown } = fullDraw();
    C.confirm();
    C.throwJiaobei();
    expect(getState().phase).toBe('reveal');
    expect(rt.jiaobei.active).toBe(false);
    expect(getState().day.lockedDrawId).toBe(shown.id);
  });

  it('a yin (阴筊) throw never leaves a confirmed entry behind', () => {
    fullDraw();
    getState().patchHistory(getState().current!.id, { confirmed: true });
    throwAs('yin');
    expect(getState().history[0]!.confirmed).toBe(false);
    expect(getState().history[0]!.jiaobei).toEqual(['yin']);
  });

  it('a yin throw excludes the pick and resets', () => {
    const { shown } = fullDraw();
    throwAs('yin');
    expect(getState().phase).toBe('resetting');
    expect(getState().day.excluded).toContain(shown.restaurantId);
    C.onResetDone();
    expect(getState().phase).toBe('idle');
  });

  it('skip returns to the reveal; reduced motion resolves instantly', () => {
    fullDraw();
    C.throwJiaobei();
    C.skipJiaobei();
    expect(getState().phase).toBe('reveal');
    useStore.setState({ reducedMotion: true });
    C.throwJiaobei();
    expect(rt.jiaobei.active).toBe(false);
    const outcome = getState().history[0]!.jiaobei[0];
    expect(outcome).toBeDefined();
    // Yin resets immediately (result cleared); sheng/xiao keep the result for the UI.
    if (outcome === 'yin') expect(getState().phase).toBe('resetting');
    else expect(getState().jiaobeiResult).toBe(outcome);
  });
});

describe('team mode', () => {
  it('two devices with the same phrase and list get the same stick and copy', () => {
    const team = { ...DEFAULT_SETTINGS, teamMode: true, teamPhrase: '干饭小分队' };
    const runDevice = (historySeed: boolean): Array<[string, string, string]> => {
      resetStore({ settings: team });
      if (historySeed) {
        fullDraw();
        C.reshake();
        C.onResetDone();
        useStore.setState({ day: freshDay() }); // other device: different history, fresh count
      }
      const out: Array<[string, string, string]> = [];
      for (let k = 0; k < 3; k++) {
        const { shown } = fullDraw();
        out.push([shown.restaurantId, shown.level, getState().copy!.jie]);
        C.reshake();
        C.onResetDone();
      }
      return out;
    };
    expect(runDevice(false)).toEqual(runDevice(true));
  });
});
