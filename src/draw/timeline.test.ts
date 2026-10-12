import { describe, expect, it } from 'vitest';
import type { Pose } from '@/types';
import { CFG } from '@/config';
import {
  buildDrawTimeline,
  buildPresent,
  buildReturn,
  eventsBetween,
  heroHandoff,
  landingPose,
  presentPose,
  samplePresent,
  sampleDraw,
  springSettle,
  TUBE_REST,
  type DrawStep,
  type DrawTimeline,
  type DrawTimelineInput,
} from '@/draw/timeline';
import { qAngle, qAxisAngle, qRotate, vLen, vSub } from '@/draw/math';

const heroLocal: Pose = { p: [0.06, CFG.tube.floorY + 0.525 + 0.01, -0.04], q: qAxisAngle([1, 0, 1], 0.05) };
const decoyLocal: Pose = { p: [-0.08, CFG.tube.floorY + 0.525 + 0.01, 0.05], q: qAxisAngle([0, 0, 1], -0.04) };

function input(patch: Partial<DrawTimelineInput> = {}): DrawTimelineInput {
  return {
    reducedMotion: false,
    tease: true,
    physicsLanding: false,
    tubeRest: TUBE_REST,
    heroStartLocal: heroLocal,
    decoyStartLocal: decoyLocal,
    landing: landingPose(),
    ...patch,
  };
}

const ORDER: DrawStep[] = ['tilt', 'tease', 'creep', 'hold', 'pop', 'arc', 'land', 'present', 'done'];

function checkMarks(tl: DrawTimeline): void {
  let prevEnd = 0;
  for (const s of ORDER) {
    const m = tl.marks[s];
    if (!m) continue;
    expect(m[0], s).toBeCloseTo(prevEnd, 9);
    expect(m[1], s).toBeGreaterThan(m[0]);
    prevEnd = m[1];
  }
}

function maxJump(tl: DrawTimeline, end: number, dt = 1 / 240): { dp: number; dq: number } {
  let prev = sampleDraw(tl, 0).hero!;
  let dp = 0;
  let dq = 0;
  for (let t = dt; t <= end; t += dt) {
    const s = sampleDraw(tl, t);
    if (!s.hero) break;
    const n = Math.hypot(...s.hero.q);
    expect(n).toBeCloseTo(1, 5);
    dp = Math.max(dp, vLen(vSub(s.hero.p, prev.p)));
    dq = Math.max(dq, qAngle(s.hero.q, prev.q));
    prev = s.hero;
  }
  return { dp, dq };
}

describe('canonical poses', () => {
  it('landing lies flat with the text face up', () => {
    const l = landingPose();
    expect(qRotate(l.q, [0, 0, 1])[1]).toBeCloseTo(1, 6); // text (+Z) up
    expect(Math.abs(qRotate(l.q, [0, 1, 0])[1])).toBeLessThan(1e-6); // long axis horizontal
    expect(qRotate(l.q, [0, 1, 0])[0]).toBeLessThan(-0.9); // top points left
  });
  it('present is upright, facing the camera, pitched back', () => {
    const p = presentPose();
    const up = qRotate(p.q, [0, 1, 0]);
    const face = qRotate(p.q, [0, 0, 1]);
    expect(up[1]).toBeGreaterThan(0.98);
    expect(up[2]).toBeLessThan(0); // top tilted away from the camera
    expect(face[2]).toBeGreaterThan(0.98);
  });
});

describe('buildDrawTimeline (scripted landing)', () => {
  const tl = buildDrawTimeline(input());

  it('has monotonic, contiguous marks with configured durations', () => {
    checkMarks(tl);
    expect(tl.marks.tilt).toEqual([0, CFG.timeline.tilt]);
    expect(tl.marks.tease![1] - tl.marks.tease![0]).toBeCloseTo(CFG.timeline.tease);
    expect(tl.marks.creep![1] - tl.marks.creep![0]).toBeCloseTo(CFG.timeline.creep);
    expect(tl.marks.hold![1] - tl.marks.hold![0]).toBeCloseTo(CFG.timeline.hold);
    expect(tl.marks.pop![1] - tl.marks.pop![0]).toBeCloseTo(CFG.timeline.pop);
    expect(tl.marks.arc![1] - tl.marks.arc![0]).toBeCloseTo(CFG.timeline.arc);
    expect(tl.marks.present![1] - tl.marks.present![0]).toBeCloseTo(CFG.timeline.present);
    expect(tl.marks.land![1] - tl.marks.land![0]).toBeLessThanOrEqual(CFG.timeline.landMax);
    expect(tl.handoffT).toBe(Infinity);
    expect(tl.duration).toBeCloseTo(tl.marks.done![0]);
  });

  it('samples the right step at each time', () => {
    for (const s of ORDER) {
      const m = tl.marks[s];
      if (!m || s === 'done') continue;
      expect(sampleDraw(tl, (m[0] + m[1]) / 2).step).toBe(s);
    }
    expect(sampleDraw(tl, tl.duration + 1).step).toBe('done');
  });

  it('is continuous (no teleports) from trigger to done', () => {
    const { dp, dq } = maxJump(tl, tl.duration + 0.1);
    expect(dp).toBeLessThan(0.06); // < 14 m/s at 240 Hz
    expect(dq).toBeLessThan(0.2);
  });

  it('pops the stick fully clear of the rim before the arc', () => {
    const popEnd = tl.marks.pop![1];
    const s = sampleDraw(tl, popEnd - 1e-6);
    const tilt = (CFG.timeline.tiltDeg * Math.PI) / 180;
    // Hero center in tube-local space: undo the tilt about X.
    const local = qRotate(qAxisAngle([1, 0, 0], -tilt), s.hero!.p);
    expect(local[1] - 0.525).toBeGreaterThanOrEqual(CFG.tube.rimY);
  });

  it('arc ends just above the landing pose in the landing orientation', () => {
    const s = sampleDraw(tl, tl.marks.arc![1] - 1e-6);
    const l = landingPose();
    expect(s.hero!.p[1]).toBeCloseTo(l.p[1] + CFG.timeline.handoffHeight, 2);
    expect(qAngle(s.hero!.q, l.q)).toBeLessThan(0.05);
  });

  it('arc apex runs in slow motion', () => {
    const [a0, a1] = tl.marks.arc!;
    const speedAt = (f: number): number => {
      const t = a0 + (a1 - a0) * f;
      return vLen(sampleDraw(tl, t).heroVel);
    };
    expect(speedAt(0.5)).toBeLessThan(speedAt(0.1) * 0.6);
  });

  it('settles onto the landing pose and presents upright', () => {
    const landEnd = tl.marks.land![1];
    const l = sampleDraw(tl, landEnd - 1e-6).hero!;
    expect(vLen(vSub(l.p, landingPose().p))).toBeLessThan(0.01);
    const done = sampleDraw(tl, tl.duration + 0.5);
    expect(done.step).toBe('done');
    expect(vLen(vSub(done.hero!.p, presentPose().p))).toBeLessThan(1e-6);
    expect(done.shot).toBe('present');
    expect(done.fovScale).toBeCloseTo(CFG.camera.fovDesktop[1] / CFG.camera.fovDesktop[0]);
  });

  it('tilts the tube 30° and returns it upright', () => {
    expect(sampleDraw(tl, 0).tubeTilt).toBeCloseTo(0);
    expect(sampleDraw(tl, tl.marks.creep![0] + 0.1).tubeTilt).toBeCloseTo((30 * Math.PI) / 180);
    expect(sampleDraw(tl, tl.marks.land![0] + 0.01).tubeTilt).toBe(0);
  });

  it('the decoy rises during the tease and returns to its slot', () => {
    const [t0, t1] = tl.marks.tease!;
    expect(sampleDraw(tl, t0 - 0.01).decoy).toBeNull();
    const mid = sampleDraw(tl, t0 + (t1 - t0) * 0.5).decoy!;
    const start = sampleDraw(tl, t0 + 1e-4).decoy!;
    expect(vLen(vSub(mid.p, start.p))).toBeGreaterThan(0.1);
    const end = sampleDraw(tl, t1 - 1e-4).decoy!;
    expect(vLen(vSub(end.p, start.p))).toBeLessThan(0.005);
    expect(sampleDraw(tl, t1 + 0.01).decoy).toBeNull();
  });

  it('events fire once each when stepping frame by frame', () => {
    const seen: string[] = [];
    let prev = -1;
    for (let t = 0; t <= tl.duration + 0.1; t += 1 / 60) {
      for (const e of eventsBetween(tl, prev, t)) seen.push(`${e.type}@${e.t.toFixed(4)}`);
      prev = t;
    }
    expect(seen).toHaveLength(tl.events.length);
    expect(new Set(seen).size).toBe(seen.length);
    const types = tl.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['scrape', 'pop', 'eject', 'thunk', 'bell', 'burst']));
    expect(types).not.toContain('handoff');
    for (let k = 1; k < tl.events.length; k++) expect(tl.events[k]!.t).toBeGreaterThanOrEqual(tl.events[k - 1]!.t);
  });

  it('pulses chromatic aberration at the pop and flashes at present', () => {
    expect(sampleDraw(tl, tl.marks.pop![0] + 0.01).ca).toBeGreaterThan(0.9);
    expect(sampleDraw(tl, tl.marks.pop![0] + CFG.timeline.caPulse + 0.01).ca).toBe(0);
    expect(sampleDraw(tl, tl.marks.present![0] + 0.01).flash).toBeGreaterThan(0.3);
  });
});

describe('buildDrawTimeline (physics landing)', () => {
  const tl = buildDrawTimeline(input({ physicsLanding: true, tease: false, decoyStartLocal: null }));

  it('hands off at the end of the arc', () => {
    checkMarks(tl);
    expect(tl.marks.tease).toBeUndefined();
    expect(tl.handoffT).toBeCloseTo(tl.marks.arc![1]);
    expect(tl.events.filter((e) => e.type === 'handoff')).toEqual([{ t: tl.handoffT, type: 'handoff' }]);
    expect(tl.events.some((e) => e.type === 'bell')).toBe(false);
    expect(tl.duration).toBe(Infinity);
  });

  it('releases the hero to physics with matched velocity', () => {
    const before = sampleDraw(tl, tl.handoffT - 1e-4);
    expect(before.hero).not.toBeNull();
    const after = sampleDraw(tl, tl.handoffT + 0.01);
    expect(after.step).toBe('land');
    expect(after.hero).toBeNull();
    const h = heroHandoff(tl)!;
    expect(vLen(vSub(h.pose.p, before.hero!.p))).toBeLessThan(0.01);
    expect(vLen(vSub(h.vel, before.heroVel))).toBeLessThan(0.3);
    expect(vLen(h.vel)).toBeGreaterThan(0.1);
    expect(h.vel[1]).toBeLessThan(0); // falling onto the altar
    // A little residual tumble for a natural clatter, but not enough to fling it off the altar.
    expect(vLen(h.angVel)).toBeGreaterThan(0.3);
    expect(vLen(h.angVel)).toBeLessThan(6);
    expect(sampleDraw(tl, tl.handoffT + 10).step).toBe('land');
  });
});

describe('reduced motion', () => {
  const tl = buildDrawTimeline(input({ reducedMotion: true, physicsLanding: true }));
  it('is a short fade/slide with no tease, CA, flash or dolly', () => {
    checkMarks(tl);
    expect(tl.marks.tease).toBeUndefined();
    expect(tl.marks.tilt).toEqual([0, CFG.timeline.reduced.tilt]);
    expect(tl.handoffT).toBe(Infinity);
    expect(tl.events.some((e) => e.type === 'burst')).toBe(false);
    for (let t = 0; t < tl.duration + 0.2; t += 0.02) {
      const s = sampleDraw(tl, t);
      expect(s.ca).toBe(0);
      expect(s.flash).toBe(0);
      expect(s.fovScale).toBe(1);
      expect(s.hero).not.toBeNull();
    }
    const mid = sampleDraw(tl, (tl.marks.arc![0] + tl.marks.arc![1]) / 2);
    expect(mid.heroScale).toBeLessThan(1);
    expect(mid.heroOpacity).toBeGreaterThan(0);
    const end = sampleDraw(tl, tl.duration + 0.1);
    expect(end.step).toBe('done');
    expect(vLen(vSub(end.hero!.p, presentPose().p))).toBeLessThan(1e-6);
  });
});

describe('springSettle', () => {
  const to = landingPose();
  const from: Pose = { p: [to.p[0] + 0.05, to.p[1] + 0.15, to.p[2] - 0.04], q: qAxisAngle([0, 1, 0], 0.6) };
  const vel: [number, number, number] = [0.4, -1.5, 0.3];
  it('never sinks below the target, bounces, and ends exactly on target', () => {
    let bounced = false;
    let t = 0;
    for (; t < 3; t += 1 / 120) {
      const s = springSettle(from, vel, to, t);
      expect(s.pose.p[1]).toBeGreaterThanOrEqual(to.p[1] - 1e-9);
      bounced ||= s.bounced;
      if (s.done) break;
    }
    expect(bounced).toBe(true);
    expect(t).toBeLessThan(1.2);
    const end = springSettle(from, vel, to, 5);
    expect(end.done).toBe(true);
    expect(end.pose).toEqual(to);
  });
});

describe('present / return', () => {
  it('present goes from the landed pose to the present pose', () => {
    const p = buildPresent(landingPose(), false);
    expect(vLen(vSub(samplePresent(p, 0).pose.p, landingPose().p))).toBeLessThan(1e-9);
    const end = samplePresent(p, p.duration);
    expect(end.done).toBe(true);
    expect(end.pose).toEqual(presentPose());
    expect(samplePresent(buildPresent(landingPose(), true), 0.2).fovScale).toBe(1);
  });

  it('return arcs over the rim without clipping the tube wall', () => {
    const slot: Pose = { p: [0.02, 0.9, -0.03], q: [0, 0, 0, 1] };
    const r = buildReturn(presentPose(), TUBE_REST, slot);
    expect(r.duration).toBeCloseTo(CFG.timeline.reset);
    for (let t = 0; t <= r.duration; t += r.duration / 200) {
      const { pose } = samplePresent(r, t);
      const radial = Math.hypot(pose.p[0], pose.p[2]);
      if (radial > 0.24 && radial < 0.36) expect(pose.p[1] - 0.525, `t=${t}`).toBeGreaterThanOrEqual(CFG.tube.rimY);
    }
    const end = samplePresent(r, r.duration + 0.01);
    expect(end.done).toBe(true);
    expect(end.pose.p).toEqual(slot.p);
  });
});
