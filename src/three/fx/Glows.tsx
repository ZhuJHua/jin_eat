/**
 * One draw call for every soft additive halo in the scene (lantern glows on tiers 0–1, incense
 * embers). Producers write into fixed slots each frame with `setGlow`; unused slots have size 0.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector2, type PerspectiveCamera } from 'three';
import { GLOW_FRAG, GLOW_VERT } from '../shaders/dust';
import { noContact } from '../env/layout';

export const GLOW_SLOTS = { lantern0: 0, lantern1: 1, ember0: 2, ember1: 3, ember2: 4, cup: 5 } as const;
const MAX = 8;

const pos = new Float32Array(MAX * 3);
const col = new Float32Array(MAX * 3);
const size = new Float32Array(MAX);
const tmpSize = new Vector2();

/** Write one halo (world position, linear HDR colour, world-space diameter in metres). */
export function setGlow(slot: number, x: number, y: number, z: number, r: number, g: number, b: number, diameter: number): void {
  if (slot < 0 || slot >= MAX) return;
  pos[slot * 3] = x;
  pos[slot * 3 + 1] = y;
  pos[slot * 3 + 2] = z;
  col[slot * 3] = r;
  col[slot * 3 + 1] = g;
  col[slot * 3 + 2] = b;
  size[slot] = diameter;
}

export function clearGlow(slot: number): void {
  if (slot >= 0 && slot < MAX) size[slot] = 0;
}

/** Shared helper: drawing-buffer height / (2·tan(fov/2)) for world-sized point sprites. */
export function pointScale(bufferHeight: number, camera: object): number {
  const raw = (camera as Partial<PerspectiveCamera>).fov;
  const fov = (typeof raw === 'number' && raw > 0 ? raw : 35) * (Math.PI / 180);
  return bufferHeight / (2 * Math.tan(fov / 2));
}

export function Glows() {
  const { points, geo, mat } = useMemo(() => {
    const g = new BufferGeometry();
    const pa = new BufferAttribute(pos, 3);
    const ca = new BufferAttribute(col, 3);
    const sa = new BufferAttribute(size, 1);
    g.setAttribute('position', pa);
    g.setAttribute('aColor', ca);
    g.setAttribute('aSize', sa);
    const m = new ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
    });
    const p = new Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 20;
    noContact(p);
    return { points: p, geo: g, mat: m };
  }, []);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((state) => {
    mat.uniforms.uScale!.value = pointScale(state.gl.getDrawingBufferSize(tmpSize).y, state.camera);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
  });

  return <primitive object={points} />;
}
