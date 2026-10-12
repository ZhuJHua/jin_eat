import { describe, expect, it } from 'vitest';
import { createPerfGovernor, initialDprFor, maxDprFor, scoreTier, tierForPref, tierParams } from '@/lib/quality';
import type { QualityTier } from '@/types';

function feedFps(gov: ReturnType<typeof createPerfGovernor>, fps: number, seconds: number, fullRate = true): void {
  const dt = 1000 / fps;
  const n = Math.round((seconds * 1000) / dt);
  for (let i = 0; i < n; i++) gov.feed(dt, fullRate);
}

describe('scoreTier', () => {
  it('rates strong desktops and phones as tier 2', () => {
    const sig = { cores: 10, memory: 8, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', coarse: false };
    expect(scoreTier(sig)).toBe(2);
    expect(scoreTier({ ...sig, coarse: true })).toBe(2);
    expect(scoreTier({ cores: 8, memory: 8, renderer: 'Adreno (TM) 750', coarse: true })).toBe(2);
    expect(scoreTier({ cores: 6, renderer: 'Apple GPU', coarse: true })).toBe(2);
  });
  it('drops weak GPUs and save-data to tier 0', () => {
    expect(scoreTier({ cores: 4, memory: 2, renderer: 'Mali-G52 MC2', coarse: true })).toBe(0);
    expect(scoreTier({ cores: 8, renderer: 'Google SwiftShader', coarse: false })).toBe(0);
    expect(scoreTier({ cores: 4, memory: undefined, renderer: '', saveData: true, coarse: true })).toBe(0);
  });
  it('gives unknown memory half a point', () => {
    expect(scoreTier({ cores: 4, memory: undefined, renderer: '', coarse: true })).toBe(1);
  });
});

describe('tier parameters, preferences and DPR caps', () => {
  it('tier parameters match the documented table', () => {
    expect(tierParams(0, true)).toMatchObject({
      physics: false,
      composer: 'none',
      dust: 80,
      confetti: 60,
      pointLights: 0,
      smoke: 'billboard',
    });
    expect(tierParams(1, true)).toMatchObject({ physics: true, composer: 'lite', dust: 160, confetti: 120, pointLights: 1, dpr: [1, 1.5] });
    expect(tierParams(2, false)).toMatchObject({ composer: 'full', shadows: true, godray: true, dust: 300, confetti: 300, dpr: [1, 2] });
    expect(tierParams(2, true).dpr).toEqual([1, 1.75]);
  });
  it('maps the quality preference to a forced tier (or none for auto/flat)', () => {
    expect(tierForPref('low')).toBe(0);
    expect(tierForPref('mid')).toBe(1);
    expect(tierForPref('high')).toBe(2);
    expect(tierForPref('auto')).toBeNull();
    expect(tierForPref('flat')).toBeNull();
  });
  it('caps DPR by tier and platform and never exceeds the device DPR', () => {
    expect(maxDprFor(2, false, 1)).toBe(1);
    expect(maxDprFor(2, false, 3)).toBe(2);
    expect(maxDprFor(1, true, 3)).toBe(1.5);
    expect(maxDprFor(2, true, 2.625)).toBe(1.75);
    expect(initialDprFor(0, true, 3)).toBe(1);
  });
});

describe('perf governor', () => {
  it('ignores idle-throttled (untrusted) frames', () => {
    const changes: [QualityTier, number][] = [];
    const gov = createPerfGovernor({ isMobile: true, tier: 1, dpr: 1.5, device: 3, onChange: (t, d) => changes.push([t, d]) });
    feedFps(gov, 30, 20, false);
    expect(changes).toEqual([]);
  });

  it('steps DPR down before the tier', () => {
    const changes: [QualityTier, number][] = [];
    const gov = createPerfGovernor({ isMobile: true, tier: 1, dpr: 1.5, device: 3, onChange: (t, d) => changes.push([t, d]) });
    feedFps(gov, 40, 2.1);
    feedFps(gov, 40, 2.1);
    feedFps(gov, 40, 2.1);
    expect(changes).toEqual([
      [1, 1.25],
      [1, 1],
      [0, 1],
    ]);
  });

  it('drops a whole tier at once when far below budget', () => {
    const changes: [QualityTier, number][] = [];
    const gov = createPerfGovernor({ isMobile: true, tier: 2, dpr: 1.75, device: 3, onChange: (t, d) => changes.push([t, d]) });
    feedFps(gov, 25, 2.1);
    expect(changes).toEqual([[1, 1.5]]);
  });

  it('steps up only after sustained headroom and locks after flip-flops', () => {
    const changes: [QualityTier, number][] = [];
    const gov = createPerfGovernor({ isMobile: false, tier: 1, dpr: 1, device: 2, onChange: (t, d) => changes.push([t, d]) });
    feedFps(gov, 60, 2.1);
    expect(changes).toEqual([]);
    feedFps(gov, 60, 2.1);
    expect(changes).toEqual([[1, 1.25]]);
    // down, up, down → three reversals → locked
    feedFps(gov, 40, 2.5);
    feedFps(gov, 60, 9);
    feedFps(gov, 40, 2.5);
    expect(gov.state.locked).toBe(true);
    const n = changes.length;
    feedFps(gov, 20, 10);
    expect(changes.length).toBe(n);
  });

  it('scales thresholds for high-refresh displays', () => {
    const changes: [QualityTier, number][] = [];
    const gov = createPerfGovernor({ isMobile: false, tier: 2, dpr: 1, device: 1, onChange: (t, d) => changes.push([t, d]) });
    // Steady 120 Hz establishes the display rate…
    feedFps(gov, 120, 2.1);
    expect(gov.state.hz).toBe(120);
    // …so 70 fps on it is too slow (52 × 2 = 104 lower bound).
    feedFps(gov, 70, 2.1);
    expect(changes).toEqual([[1, 1]]);
  });
});
