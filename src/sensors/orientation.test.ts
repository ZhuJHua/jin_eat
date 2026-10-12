import { beforeEach, describe, expect, it } from 'vitest';
import { leanToScreen } from '@/sensors/orientation';
import { resetTubeDriver, stepTubeDriver } from '@/three/TubeDriver';
import { getState, useStore } from '@/state/store';
import { rt } from '@/state/runtime';

const DEG = Math.PI / 180;

describe('leanToScreen (tilt convention)', () => {
  it('portrait: gamma up dips the right edge (x > 0), beta up tips the top back (y > 0)', () => {
    expect(leanToScreen(10, 0, 0)).toEqual([10, 0]);
    expect(leanToScreen(0, 10, 0)).toEqual([0, 10]);
  });

  it('landscape 90 (phone top to the left): the screen-right edge is the device bottom', () => {
    // Dipping the device bottom raises beta → screen-right dipped.
    const [x1, y1] = leanToScreen(0, 10, 90);
    expect(x1).toBeGreaterThan(0);
    expect(y1).toBeCloseTo(0);
    // The screen-top edge is the device right edge: raising it lowers gamma → top tipped back.
    const [x2, y2] = leanToScreen(-10, 0, 90);
    expect(x2).toBeCloseTo(0);
    expect(y2).toBeGreaterThan(0);
  });

  it('landscape 270 mirrors 90, and 180 inverts both axes', () => {
    const [x, y] = leanToScreen(0, 10, 270);
    expect(x).toBeLessThan(0);
    expect(y).toBeCloseTo(0);
    expect(leanToScreen(10, 5, 180)).toEqual([-10, -5]);
  });
});

describe('TubeDriver device tilt', () => {
  beforeEach(() => {
    useStore.setState({ phase: 'idle', drawer: null, reducedMotion: false });
    resetTubeDriver();
    rt.tube.scriptedTilt = null;
    rt.input.auto.active = false;
    rt.input.pointer.grabbing = false;
    rt.input.motion.active = true;
    rt.input.motion.lin[0] = rt.input.motion.lin[1] = rt.input.motion.lin[2] = 0;
  });

  /** Roll / pitch from the written quaternion q = Rz(roll)·Rx(pitch). */
  function settle(tx: number, ty: number): { roll: number; pitch: number } {
    rt.input.motion.tilt.x = tx;
    rt.input.motion.tilt.y = ty;
    for (let i = 0; i < 240; i++) stepTubeDriver(1 / 60, i * 16.7);
    const [qx, qy, qz, qw] = rt.tube.target.q as [number, number, number, number];
    const pitch = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
    const roll = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    return { roll, pitch };
  }

  it('right edge dipped leans the tube right (roll < 0) without pitching it', () => {
    const { roll, pitch } = settle(10 * DEG, 0);
    expect(roll).toBeLessThan(-0.01);
    expect(Math.abs(pitch)).toBeLessThan(1e-3);
  });

  it('top edge tipped toward the user tips the tube top toward the camera (pitch > 0)', () => {
    const { roll, pitch } = settle(0, 10 * DEG);
    expect(pitch).toBeGreaterThan(0.01);
    expect(Math.abs(roll)).toBeLessThan(1e-3);
    expect(getState().phase).toBe('idle');
  });
});
