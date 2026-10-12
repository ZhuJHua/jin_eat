/**
 * Gold dust motes. All drift is analytic in the vertex shader; the CPU only updates a handful of
 * uniforms per frame. `rt.fx.dustBurst` (1 → 0, decayed by the Director) drives the present-beat
 * burst: nearby motes are pushed out and flare, and burst-only sparks fly from `rt.fx.burstOrigin`.
 * Reduced motion slows the drift and disables the burst.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector2, Vector3 } from 'three';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { DUST_FRAG, DUST_VERT } from '../shaders/dust';
import { noContact } from '../env/layout';
import { pointScale } from './Glows';

const SPARKS = 48;
const tmpSize = new Vector2();

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function Dust({ count }: { count: number }) {
  const reduced = useStore((s) => s.reducedMotion);
  const { points, geo, mat } = useMemo(() => {
    const n = Math.max(0, Math.floor(count)) + SPARKS;
    const seeds = new Float32Array(n * 4);
    const rnd = seededRandom(0x9e3779b9);
    for (let i = 0; i < n; i++) {
      const spark = i >= n - SPARKS;
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      // Bias motes toward the centre so the tube area sparkles most.
      if (!spark) seeds[i * 4] = 0.5 + (seeds[i * 4]! - 0.5) * (0.55 + 0.45 * rnd());
      seeds[i * 4 + 3] = spark ? -(0.001 + rnd() * 0.999) : rnd();
    }
    const g = new BufferGeometry();
    // Positions are computed in the shader; three still needs a position attribute for draw count.
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    const m = new ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 500 },
        uSize: { value: 0.016 },
        uBurst: { value: 0 },
        uGlow: { value: 0 },
        uPhase: { value: 0 },
        uBurstOrigin: { value: new Vector3(0, 0.8, 0.6) },
        uBoxMin: { value: new Vector3(-2.2, -0.1, -1.4) },
        uBoxSize: { value: new Vector3(4.4, 2.6, 3.2) },
        uMotion: { value: 1 },
        uColor: { value: new Color('#ffc65e') },
        uHotColor: { value: new Color('#ffd98a') },
        uIntensity: { value: 1.6 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
    });
    const p = new Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 18;
    noContact(p);
    return { points: p, geo: g, mat: m };
  }, [count]);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((state) => {
    const u = mat.uniforms;
    u.uTime!.value = state.clock.elapsedTime;
    u.uScale!.value = pointScale(state.gl.getDrawingBufferSize(tmpSize).y, state.camera);
    u.uMotion!.value = reduced ? 0.3 : 1;
    const b = reduced ? 0 : Math.max(0, Math.min(1, rt.fx.dustBurst));
    u.uGlow!.value = b;
    u.uPhase!.value = 1 - b;
    // Out-and-back displacement envelope peaking mid-burst.
    u.uBurst!.value = 4 * b * (1 - b);
    const o = rt.fx.burstOrigin;
    (u.uBurstOrigin!.value as Vector3).set(o[0], o[1], o[2]);
  });

  return <primitive object={points} />;
}
