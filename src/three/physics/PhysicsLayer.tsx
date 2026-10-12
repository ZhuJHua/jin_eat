/**
 * Lazy physics chunk (tiers 1–2). The ONLY module tree that imports @react-three/rapier.
 *
 * `<Physics>` provides the WASM world (suspends while rapier initialises). It is permanently
 * `paused`, so its own frame stepper never runs: the Director steps the world through
 * `physicsBridge.step` at a fixed point in its pipeline, with our own clamped dt (immune to however
 * the Stage feeds timestamps into R3F's `advance`).
 */
import { Suspense, useEffect } from 'react';
import { Physics, useRapier } from '@react-three/rapier';
import { rt } from '@/state/runtime';
import { physicsBridge } from './bridge';
import { createRitualSim } from './simulation';

const GRAVITY: [number, number, number] = [0, -9.81, 0];

function RitualWorld(props: { count: number }): null {
  const { world, rapier } = useRapier();

  useEffect(() => {
    let sim: ReturnType<typeof createRitualSim>;
    try {
      sim = createRitualSim(world, rapier);
    } catch (err) {
      console.error('[physics] failed to build the world; falling back to jitter', err);
      return;
    }
    const s = sim;
    let failed = false;
    physicsBridge.step = (dt, now) => {
      if (failed) return;
      try {
        s.step(dt, now);
      } catch (err) {
        // Never take the ritual down with the simulation: hand the sticks back to the jitter.
        failed = true;
        console.error('[physics] step failed; falling back to jitter', err);
        physicsBridge.step = null;
        rt.physicsReady = false;
      }
    };
    rt.physicsReady = true;
    return () => {
      physicsBridge.step = null;
      rt.physicsReady = false;
      s.dispose();
    };
  }, [world, rapier]);

  // Body count follows rt.sticks.count inside the sim; the prop only documents the dependency.
  void props.count;
  return null;
}

export default function PhysicsLayer(props: { count: number }): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Physics paused timeStep="vary" gravity={GRAVITY} colliders={false}>
        <RitualWorld count={props.count} />
      </Physics>
    </Suspense>
  );
}
