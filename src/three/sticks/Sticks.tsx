/**
 * The bundle of 签 in the tube: one InstancedMesh (≤ 16 instances) whose matrices are composed every
 * frame from `rt.sticks.poses` (hidden → scale 0). Each instance samples its own atlas column via the
 * `aCol` attribute. Desktop hover over a stick reports its restaurant to the store for the tooltip.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Sphere,
  Vector3,
} from 'three';
import type { QualityTier } from '@/types';
import { CFG } from '@/config';
import { getState, useStore } from '@/state/store';
import { rt } from '@/state/runtime';
import { ATLAS_COLUMNS, createStickAtlas } from './stickAtlas';
import { createStickGeometry } from './stickGeometry';
import { fontsReady } from './fonts';
import { STRIDE } from './poseBuffer';

const MAX = CFG.limits.maxRestaurants;

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _zero = new Vector3(0, 0, 0);

function canHover(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

function patchAtlasMaterial(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCol;').replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vec2((uv.x + aCol) / ${ATLAS_COLUMNS.toFixed(1)}, uv.y);
#endif
#ifdef USE_BUMPMAP
  vBumpMapUv = vec2((uv.x + aCol) / ${ATLAS_COLUMNS.toFixed(1)}, uv.y);
#endif`,
    );
  };
  m.customProgramCacheKey = () => 'jin-stick-atlas';
}

export function Sticks(props: { tier: QualityTier }): React.JSX.Element {
  const { tier } = props;
  const meshRef = useRef<InstancedMesh>(null);
  const restaurants = useStore((s) => s.restaurants);
  const names = useMemo(() => restaurants.map((r) => r.name), [restaurants]);
  const namesKey = names.join('\u0001');
  const size: 1024 | 2048 = tier === 0 ? 1024 : 2048;

  const geometry = useMemo(() => {
    const g = createStickGeometry();
    const cols = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) cols[i] = i;
    g.setAttribute('aCol', new InstancedBufferAttribute(cols, 1));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The atlas is painted synchronously (fallback font) and repainted when the brush font arrives.
  const atlas = useMemo(
    () =>
      createStickAtlas(
        getState().restaurants.map((r) => r.name),
        size,
      ),
    [size],
  );
  useEffect(() => () => atlas.dispose(), [atlas]);
  useEffect(() => {
    const list = namesKey.split('\u0001');
    atlas.repaint(list);
    let alive = true;
    void fontsReady(list.join('') + '第签一二三四五六七八九十').then((ok) => {
      if (alive && ok) atlas.repaint(list);
    });
    return () => {
      alive = false;
    };
  }, [atlas, namesKey]);

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      map: atlas.texture,
      bumpMap: tier >= 1 ? atlas.texture : null,
      bumpScale: tier >= 1 ? 0.9 : 0,
      roughness: 0.58,
      metalness: 0,
      envMapIntensity: 0.8,
    });
    patchAtlasMaterial(m);
    return m;
  }, [atlas, tier]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Fixed bounds: instances move every frame, so never let three cache a stale sphere for raycasts.
    mesh.boundingSphere = new Sphere(new Vector3(0, 0.8, 0), 2.5);
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const s = rt.sticks;
    const n = Math.min(s.count, MAX);
    const buf = s.poses;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      if (s.hidden[i] === 1) {
        _m.compose(_zero, _q.identity(), _zero);
      } else {
        _p.set(buf[o]!, buf[o + 1]!, buf[o + 2]!);
        _q.set(buf[o + 3]!, buf[o + 4]!, buf[o + 5]!, buf[o + 6]!);
        _m.compose(_p, _q, _one);
      }
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  const hoverable = useMemo(canHover, []);
  const lastHover = useRef<string | null>(null);
  const setHover = (id: string | null): void => {
    if (lastHover.current === id) return;
    lastHover.current = id;
    getState().setHoverStick(id);
  };
  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    const st = getState();
    const allowed = (st.phase === 'idle' || st.phase === 'armed') && st.drawer === null && !rt.input.pointer.grabbing;
    const idx = e.instanceId;
    if (!allowed || idx === undefined || rt.sticks.hidden[idx] === 1) {
      setHover(null);
      return;
    }
    // Only the exposed upper part of the stick (above the rim) counts as "the tip".
    if (e.point.y < CFG.tube.rimY + rt.tube.actual.p[1] + 0.02) {
      setHover(null);
      return;
    }
    e.stopPropagation();
    setHover(st.restaurants[idx]?.id ?? null);
  };
  const onOut = (): void => setHover(null);
  useEffect(() => () => setHover(null), []);

  const shadows = tier === 2;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX]}
      geometry={geometry}
      material={material}
      castShadow={shadows}
      dispose={null}
      name="sticks"
      onPointerMove={hoverable ? onMove : undefined}
      onPointerOut={hoverable ? onOut : undefined}
    />
  );
}
