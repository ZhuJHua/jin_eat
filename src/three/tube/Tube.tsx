/**
 * The red-lacquer 签筒. Follows `rt.tube.actual` every frame. Tier 2 uses a clear-coated
 * MeshPhysicalMaterial; tiers 0–1 use MeshStandardMaterial with the shared Fresnel "coat" patch.
 * Also owns the invisible grab volume used by pointer shaking (`tubeHit`, `hitTestTube`).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  type Camera,
  type Group,
  type Intersection,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
} from 'three';
import type { QualityTier } from '@/types';
import { rt } from '@/state/runtime';
import { patchLacquerFresnel } from '@/three/shaders/lacquer';
import { fontsReady } from '@/three/sticks/fonts';
import { createBandGeometry, createMedallionGeometry, createRimGeometry, createTubeGeometries, HIT_VOLUME } from './tubeGeometry';
import { createLacquerTextures, createMedallionTextures } from './tubeTextures';

/** Registry for pointer grabbing: the invisible hit volume and the camera that renders it. */
export const tubeHit: { mesh: Mesh | null; camera: Camera | null } = { mesh: null, camera: null };

const _ray = new Raycaster();
const _ndc = new Vector2();
const _hits: Intersection[] = [];

/** Whether the pointer at `ndc` (−1..1, y up) is over the tube or its sticks. */
export function hitTestTube(ndc: readonly [number, number]): boolean {
  const mesh = tubeHit.mesh;
  const cam = tubeHit.camera;
  if (!mesh || !cam) return false;
  _ndc.set(ndc[0], ndc[1]);
  _ray.setFromCamera(_ndc, cam);
  _hits.length = 0;
  mesh.updateWorldMatrix(true, false);
  mesh.raycast(_ray, _hits);
  const hit = _hits.length > 0;
  _hits.length = 0;
  return hit;
}

function lacquerMaterial(tier: QualityTier, map: MeshStandardMaterial['map'], orm: MeshStandardMaterial['map']): Material {
  if (tier === 2) {
    return new MeshPhysicalMaterial({
      color: '#ffffff',
      map,
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: 1,
      metalness: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.2,
      sheenColor: new Color('#ff6a4a'),
      sheenRoughness: 0.6,
      envMapIntensity: 1.1,
    });
  }
  const m = new MeshStandardMaterial({
    color: '#ffffff',
    map,
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 1,
  });
  m.onBeforeCompile = (shader) => patchLacquerFresnel(shader, 0.35);
  m.customProgramCacheKey = () => 'jin-lacquer-fresnel';
  return m;
}

export function Tube(props: { tier: QualityTier }): React.JSX.Element {
  const { tier } = props;
  const group = useRef<Group>(null);
  const hitRef = useRef<Mesh>(null);

  const geo = useMemo(() => {
    const g = createTubeGeometries();
    const hit = new CylinderGeometry(HIT_VOLUME.radiusTop, HIT_VOLUME.radiusBottom, HIT_VOLUME.height, 16, 1, false);
    hit.translate(0, HIT_VOLUME.y, 0);
    return {
      ...g,
      rim: createRimGeometry(),
      bands: createBandGeometry(),
      medallion: createMedallionGeometry(),
      hit,
    };
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(geo)) g.dispose();
    },
    [geo],
  );

  const tex = useMemo(
    () => ({
      skin: createLacquerTextures(tier === 0 ? 512 : 1024),
      medal: createMedallionTextures(tier === 0 ? 256 : 512),
    }),
    [tier],
  );
  useEffect(() => {
    let alive = true;
    void fontsReady('锦少灵签').then((ok) => {
      if (alive && ok) tex.medal.repaint();
    });
    return () => {
      alive = false;
      tex.skin.dispose();
      tex.medal.dispose();
    };
  }, [tex]);

  const mats = useMemo(() => {
    const lacquer = lacquerMaterial(tier, tex.skin.map, tex.skin.orm);
    const rim = lacquerMaterial(tier, null, null);
    if (rim instanceof MeshStandardMaterial) {
      rim.color.set('#a8101a');
      rim.roughness = 0.3;
      rim.metalness = 0;
    }
    const inner = new MeshStandardMaterial({ color: '#3a0a0c', roughness: 0.92, metalness: 0, side: BackSide });
    const floor = new MeshStandardMaterial({ color: '#210507', roughness: 0.95, metalness: 0 });
    const gold = new MeshStandardMaterial({ color: '#d9a441', roughness: 0.25, metalness: 1, envMapIntensity: 1.3 });
    const medal = new MeshStandardMaterial({
      map: tex.medal.map,
      roughnessMap: tex.medal.orm,
      metalnessMap: tex.medal.orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.25,
      side: DoubleSide,
    });
    const hit = new MeshBasicMaterial({ visible: false });
    return { lacquer, rim, inner, floor, gold, medal, hit };
  }, [tier, tex]);
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );

  useEffect(() => {
    tubeHit.mesh = hitRef.current;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the ref at cleanup time on purpose (only clears the shared handle if it is still ours)
      if (tubeHit.mesh === hitRef.current) tubeHit.mesh = null;
    };
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // The pose the physics walls really have (== target without physics), so sticks and walls agree.
    const t = rt.tube.actual;
    g.position.set(t.p[0], t.p[1], t.p[2]);
    g.quaternion.set(t.q[0], t.q[1], t.q[2], t.q[3]);
  });

  const shadows = tier === 2;
  return (
    <group ref={group} name="tube">
      <mesh geometry={geo.outer} material={mats.lacquer} castShadow={shadows} />
      <mesh geometry={geo.inner} material={mats.inner} />
      <mesh geometry={geo.floor} material={mats.floor} />
      <mesh geometry={geo.rim} material={mats.rim} castShadow={shadows} />
      <mesh geometry={geo.bands} material={mats.gold} castShadow={shadows} />
      <mesh geometry={geo.medallion} material={mats.medal} />
      <mesh ref={hitRef} geometry={geo.hit} material={mats.hit} name="tube-hit" />
    </group>
  );
}
