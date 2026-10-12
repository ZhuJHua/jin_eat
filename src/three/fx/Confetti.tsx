/**
 * Celebration confetti: rice grains, chili flakes and little red envelopes thrown
 * from `rt.fx.burstOrigin` when the Director sets `rt.fx.confettiT0` (performance.now() ms; < 0 =
 * idle). Ballistics run in the vertex shader; the mesh is hidden whenever no burst is in flight.
 * The 锦少请客签 variant throws twice the envelopes for 2.5 s. Disabled under reduced motion.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  BoxGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { createConfettiUniforms, patchConfetti } from '../shaders/confetti';
import { noContact } from '../env/layout';

const SHAPE_RICE = 0;
const SHAPE_CHILI = 1;
const SHAPE_ENVELOPE = 2;
const MAX_DELAY = 0.15;

function shapeGeometry(): BufferGeometry {
  const tag = (g: BufferGeometry, id: number, color: string): BufferGeometry => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    ng.deleteAttribute('uv');
    const n = ng.getAttribute('position').count;
    const ids = new Float32Array(n).fill(id);
    const c = new Color(color);
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    ng.setAttribute('aShapeId', new BufferAttribute(ids, 1));
    ng.setAttribute('color', new BufferAttribute(cols, 3));
    return ng;
  };
  const rice = new IcosahedronGeometry(1, 0).scale(0.009, 0.0045, 0.0045);
  const chili = new ConeGeometry(0.009, 0.022, 5, 1).scale(1, 1, 0.35);
  const env = new BoxGeometry(0.026, 0.038, 0.003);
  const merged = mergeGeometries(
    [tag(rice, SHAPE_RICE, '#fbf6ea'), tag(chili, SHAPE_CHILI, '#d42a14'), tag(env, SHAPE_ENVELOPE, '#c8101c')],
    false,
  );
  if (!merged) throw new Error('confetti merge failed');
  merged.computeVertexNormals();
  return merged;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fill per-instance attributes. `envelopeShare` ∈ [0,1]. */
function fillInstances(geo: BufferGeometry, n: number, envelopeShare: number): void {
  const rnd = seeded(20251012);
  const shape = new Float32Array(n);
  const vel = new Float32Array(n * 3);
  const axis = new Float32Array(n * 3);
  const spinDelay = new Float32Array(n * 2);
  const riceShare = (1 - envelopeShare) * 0.6;
  for (let i = 0; i < n; i++) {
    const r = rnd();
    shape[i] = r < envelopeShare ? SHAPE_ENVELOPE : r < envelopeShare + riceShare ? SHAPE_RICE : SHAPE_CHILI;
    const a = rnd() * Math.PI * 2;
    const spread = 0.35 + rnd() * 1.25;
    const up = 1.5 + rnd() * 1.9;
    vel[i * 3] = Math.cos(a) * spread;
    vel[i * 3 + 1] = up;
    vel[i * 3 + 2] = Math.sin(a) * spread * 0.8 + 0.35;
    const ax = rnd() * 2 - 1;
    const ay = rnd() * 2 - 1;
    const az = rnd() * 2 - 1;
    const l = Math.hypot(ax, ay, az) || 1;
    axis[i * 3] = ax / l;
    axis[i * 3 + 1] = ay / l;
    axis[i * 3 + 2] = az / l;
    spinDelay[i * 2] = (shape[i] === SHAPE_ENVELOPE ? 6 : 14) + rnd() * 10;
    spinDelay[i * 2 + 1] = rnd() * MAX_DELAY;
  }
  geo.setAttribute('aShape', new InstancedBufferAttribute(shape, 1));
  geo.setAttribute('aVel', new InstancedBufferAttribute(vel, 3));
  geo.setAttribute('aAxis', new InstancedBufferAttribute(axis, 3));
  geo.setAttribute('aSpinDelay', new InstancedBufferAttribute(spinDelay, 2));
}

export function Confetti({ count }: { count: number }) {
  const reduced = useStore((s) => s.reducedMotion);
  const treat = useStore((s) => s.current?.treat === true);
  const uniforms = useMemo(createConfettiUniforms, []);
  const n = Math.max(1, Math.floor(count));
  const geo = useMemo(() => {
    const g = shapeGeometry();
    fillInstances(g, n, treat ? 0.5 : 0.25);
    return g;
  }, [n, treat]);
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.05,
      emissive: new Color('#3a0a04'),
      emissiveIntensity: 0.6,
    });
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => patchConfetti(shader, uniforms);
    m.customProgramCacheKey = () => 'confetti';
    return m;
  }, [uniforms]);
  const mesh = useMemo(() => {
    const m = new InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 12;
    noContact(m);
    return m;
  }, [geo, mat, n]);
  const lastT0 = useRef(-1);

  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const t0 = rt.fx.confettiT0;
    const life = treat ? 2.5 : 2.2;
    if (reduced || !(t0 >= 0)) {
      mesh.visible = false;
      return;
    }
    const t = (performance.now() - t0) / 1000;
    if (t0 !== lastT0.current) {
      lastT0.current = t0;
      uniforms.uYaw.value = Math.random() * Math.PI * 2;
    }
    const active = t >= 0 && t <= life + MAX_DELAY;
    mesh.visible = active;
    if (!active) return;
    uniforms.uTime.value = t;
    uniforms.uLife.value = life;
    const o = rt.fx.burstOrigin;
    uniforms.uOrigin.value[0] = o[0];
    uniforms.uOrigin.value[1] = o[1];
    uniforms.uOrigin.value[2] = o[2];
  });

  return <primitive object={mesh} />;
}
