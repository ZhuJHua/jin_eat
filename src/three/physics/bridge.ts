/**
 * Rapier-free handle between the lazily loaded physics chunk and the Director.
 *
 * The physics layer registers `step` once its world and bodies exist; the Director calls it once per
 * rendered frame at the right point of its pipeline (after the tube target and every scripted pose
 * have been written, before visuals read `rt.sticks.poses`). While `step` is null the Director runs
 * the tier-0 procedural jitter instead, so the sticks are never frozen while the chunk loads.
 *
 * Ownership protocol (shared with SticksJitter): stick i is owned by the Director while
 * `rt.sticks.hidden[i] === 1` or it is the active decoy. Owned sticks follow `rt.sticks.poses[i]`
 * (kinematically inside the tube, disabled outside it); when ownership ends the body resumes as a
 * dynamic body at that pose with zero velocity.
 */
export interface PhysicsBridge {
  /** Advance the simulation by `dt` seconds; `now` is performance.now() ms. */
  step: ((dt: number, now: number) => void) | null;
  /** performance.now() of the last successful step (−Infinity before the first). */
  lastStepAt: number;
}

export const physicsBridge: PhysicsBridge = { step: null, lastStepAt: -Infinity };

/**
 * Cheap counters, only read by the ?debug=1 HUD and its `window.__jin` probe: the kinematic tube pose
 * the walls had after the last step (it may trail `rt.tube.target` under the velocity clamps), how
 * many escaped sticks were re-dropped, and how many were geometrically pushed back inside the wall.
 */
export const physicsStats: {
  kinP: [number, number, number];
  kinQ: [number, number, number, number];
  teleports: number;
  projections: number;
} = {
  kinP: [0, 0, 0],
  kinQ: [0, 0, 0, 1],
  teleports: 0,
  projections: 0,
};

/** True when stick `i` is currently driven by the Director instead of the simulation. */
export function isOwnedStick(i: number, hidden: Uint8Array, decoyActive: boolean, decoyIndex: number): boolean {
  return hidden[i] === 1 || (decoyActive && decoyIndex === i);
}
