/**
 * The two 筊杯 blocks. Poses come from `rt.jiaobei.poses`, sampled by the Director from the scripted
 * throw (the outcome is rolled first). Hidden outside the ritual; they stay on the altar while the
 * result is shown and shrink away when the reveal resets.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type Group, MeshPhysicalMaterial, Quaternion, Vector3 } from 'three';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { createJiaobeiGeometry, restLift } from './jiaobeiGeometry';

/** y of the scripted landing spot in draw/jiaobei.ts (block centre). */
const SCRIPT_REST_Y = 0.02;

const _z = new Vector3();
const _q = new Quaternion();

let lastNow = 0;
let lingerUntil = 0;

function place(g: Group | null, i: 0 | 1, presence: number): void {
  if (!g) return;
  g.visible = presence > 0;
  if (!g.visible) return;
  const pose = rt.jiaobei.poses[i];
  _q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
  // Raise the block so whichever face is down actually touches the altar (only near the ground).
  _z.set(0, 0, 1).applyQuaternion(_q);
  const lift = restLift(Math.max(0, -_z.y)) - SCRIPT_REST_Y;
  const nearGround = Math.min(1, Math.max(0, 1.6 - pose.p[1] * 8));
  g.position.set(pose.p[0], pose.p[1] + lift * nearGround, pose.p[2]);
  g.quaternion.copy(_q);
  const sc = presence < 1 ? presence * presence * (3 - 2 * presence) : 1;
  g.scale.set(sc, sc, sc);
}

/**
 * Lacquered red side (clearcoat 0.8, roughness 0.42), bare wood flat side (roughness 0.6, no coat).
 * The side is read from the vertex colour, so one draw call covers both.
 */
function makeBlockMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.1,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  float lacq = smoothstep(0.25, 0.4, vColor.r - vColor.g);\n  roughnessFactor = mix(0.6, 0.42, lacq);',
      )
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= lacq;\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'jiaobei-lacquer';
  return m;
}

export function Jiaobei(): React.JSX.Element {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const presence = useRef(0);
  const geometry = useMemo(createJiaobeiGeometry, []);
  const material = useMemo(makeBlockMaterial, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const now = performance.now();
    const dt = lastNow > 0 ? Math.min(0.05, Math.max(0, (now - lastNow) / 1000)) : 1 / 60;
    lastNow = now;
    const s = getState();
    const active = s.phase === 'jiaobei' || (s.phase === 'reveal' && s.jiaobeiResult !== null);
    // Linger briefly after the ritual ends (e.g. 阴筊 resets at once) so the result can be seen.
    if (active) lingerUntil = now + 900;
    const want = active || now < lingerUntil ? 1 : 0;
    const k = 1 - Math.exp(-dt / (want ? 0.06 : 0.09));
    presence.current += (want - presence.current) * k;
    if (presence.current < 0.01) presence.current = 0;
    const pr = presence.current;
    place(a.current, 0, pr);
    place(b.current, 1, pr);
  });

  return (
    <>
      <group ref={a} visible={false} name="jiaobei-a">
        <mesh geometry={geometry} material={material} dispose={null} />
      </group>
      <group ref={b} visible={false} name="jiaobei-b">
        <mesh geometry={geometry} material={material} dispose={null} />
      </group>
    </>
  );
}
