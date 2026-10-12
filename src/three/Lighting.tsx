/**
 * Warm dusk lighting: key spot, cool rim, hemisphere fill, a procedural environment
 * built only from light-former panels (no presets, no network), and frame-limited contact shadows
 * re-captured after the scene settles.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import {
  BackSide,
  BufferAttribute,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  CircleGeometry,
  Vector3,
  type DirectionalLight,
  type SpotLight,
  type WebGLRenderTarget,
} from 'three';
import type { QualityTier } from '@/types';
import { bus } from '@/lib/bus';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { tierParams, isMobileDevice } from '@/lib/quality';
import { useLayout, type SceneLayout } from './env/layout';

interface Former {
  shape: 'rect' | 'circle' | 'sphere';
  color: string;
  intensity: number;
  position: [number, number, number];
  scale: [number, number, number];
  lookAt?: [number, number, number];
}

function formers(layout: SceneLayout): Former[] {
  const [l0, l1] = layout.lanterns;
  return [
    // Warm overhead softbox, front-left (main highlight on lacquer and gold).
    { shape: 'rect', color: '#ffd7a8', intensity: 2, position: [-2, 3, 2], scale: [3, 3, 1], lookAt: [0, 0.5, 0] },
    // Two tall orange strips at the sides.
    { shape: 'rect', color: '#ff6a2a', intensity: 1.5, position: [-2.5, 1.5, 1], scale: [0.35, 3, 1], lookAt: [0, 1.2, 0] },
    { shape: 'rect', color: '#ff6a2a', intensity: 1.5, position: [2.5, 1.5, 1], scale: [0.35, 3, 1], lookAt: [0, 1.2, 0] },
    // Cool dusk strip behind (rim reflections).
    { shape: 'rect', color: '#8a7ab8', intensity: 0.35, position: [0, 2.4, -4], scale: [4, 0.6, 1], lookAt: [0, 1, 0] },
    // The moon window: a warm disc behind the altar.
    {
      shape: 'circle',
      color: '#ff9a5c',
      intensity: 1.1,
      position: [0, layout.window.y, -3.4],
      scale: [layout.window.r * 1.2, layout.window.r * 1.2, 1],
      lookAt: [0, 0.6, 0],
    },
    // Lantern hot-spots so lacquer shows two glowing dots.
    { shape: 'sphere', color: '#ff7a3a', intensity: 3, position: l0, scale: [0.17, 0.21, 0.17] },
    { shape: 'sphere', color: '#ff7a3a', intensity: 3, position: l1, scale: [0.17, 0.21, 0.17] },
    // A dim warm floor bounce.
    { shape: 'rect', color: '#5a1a0c', intensity: 0.5, position: [0, -1.2, 0], scale: [8, 8, 1], lookAt: [0, 0, 0] },
  ];
}

function buildEnvScene(layout: SceneLayout): { scene: Scene; dispose(): void } {
  const scene = new Scene();
  const disposables: { dispose(): void }[] = [];

  // Surrounding room: dark plum above, warm ember near the horizon, near-black below.
  const room = new SphereGeometry(20, 32, 16);
  const pos = room.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const top = new Color('#120914');
  const mid = new Color('#3a1510');
  const low = new Color('#070304');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20;
    if (y >= 0) c.copy(mid).lerp(top, Math.min(1, y * 1.6));
    else c.copy(mid).lerp(low, Math.min(1, -y * 2.5));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  room.setAttribute('color', new BufferAttribute(colors, 3));
  const roomMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false });
  scene.add(new Mesh(room, roomMat));
  disposables.push(room, roomMat);

  const rect = new PlaneGeometry(1, 1);
  const circle = new CircleGeometry(0.5, 32);
  const sphere = new SphereGeometry(1, 16, 12);
  disposables.push(rect, circle, sphere);
  for (const f of formers(layout)) {
    const mat = new MeshBasicMaterial({ color: new Color(f.color).multiplyScalar(f.intensity), side: DoubleSide, toneMapped: false });
    disposables.push(mat);
    const geo = f.shape === 'rect' ? rect : f.shape === 'circle' ? circle : sphere;
    const m = new Mesh(geo, mat);
    m.position.set(...f.position);
    m.scale.set(...f.scale);
    if (f.lookAt) m.lookAt(...f.lookAt);
    scene.add(m);
  }
  return {
    scene,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

const ENV_ORIGIN = new Vector3(0, 0.5, 0);

/** Bakes the light-former room into a PMREM env map once (re-baked on resize/layout or tier change). */
function ProceduralEnvironment({ resolution, layout }: { resolution: number; layout: SceneLayout }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // Quantised so a window drag-resize re-bakes a handful of times, not every frame.
  const bucket = Math.round(layout.t * 8);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    const env = buildEnvScene(layoutRef.current);
    const pmrem = new PMREMGenerator(gl);
    let target: WebGLRenderTarget | null = null;
    try {
      target = pmrem.fromScene(env.scene, 0.02, 0.1, 50, { size: resolution, position: ENV_ORIGIN });
      scene.environment = target.texture;
      scene.environmentIntensity = 0.9;
    } catch (err) {
      console.error('[lighting] environment bake failed', err);
    } finally {
      pmrem.dispose();
      env.dispose();
    }
    return () => {
      if (target && scene.environment === target.texture) scene.environment = null;
      target?.dispose();
    };
  }, [gl, scene, resolution, bucket]);
  return null;
}

/** Re-capture trigger for the contact shadow after the hero lands, a reset ends or the list changes. */
function useShadowEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = (delayMs: number): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setEpoch((e) => e + 1), delayMs);
    };
    // Late-arriving content (stick atlas, physics settling) after mount.
    const settle = setTimeout(() => setEpoch((e) => e + 1), 1800);
    const offLanded = bus.on('landed', () => bump(120));
    // The new stick bodies need a moment to drop into the tube.
    const offList = bus.on('list-changed', () => bump(900));
    let prev = useStore.getState().phase;
    const offPhase = useStore.subscribe((s) => {
      if (s.phase === prev) return;
      const was = prev;
      prev = s.phase;
      if (s.phase === 'idle' && was === 'resetting') bump(150);
      else if (s.phase === 'reveal') bump(60);
    });
    return () => {
      if (timer) clearTimeout(timer);
      clearTimeout(settle);
      offLanded();
      offList();
      offPhase();
    };
  }, []);
  return epoch;
}

export function Lighting({ tier }: { tier: QualityTier }) {
  const isMobile = useMemo(isMobileDevice, []);
  const params = tierParams(tier, isMobile);
  const layout = useLayout();
  const epoch = useShadowEpoch();
  const scene = useThree((s) => s.scene);
  const spot = useRef<SpotLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const [targets] = useState(() => {
    const tube = new Object3D();
    tube.position.set(0, 0.45, 0);
    const origin = new Object3D();
    origin.position.set(0, 0.4, 0);
    return { tube, origin };
  });

  // A thin cool rim separates the presented stick from the tube (instead of a bright halo).
  useFrame(() => {
    const r = rim.current;
    if (r) r.intensity = 0.3 + 0.3 * Math.max(0, Math.min(1, rt.fx.presentBloom));
  });

  useLayoutEffect(() => {
    scene.add(targets.tube, targets.origin);
    if (spot.current) spot.current.target = targets.tube;
    if (rim.current) rim.current.target = targets.origin;
    return () => {
      scene.remove(targets.tube, targets.origin);
    };
  }, [scene, targets]);

  return (
    <>
      <spotLight
        ref={spot}
        color="#ffd2a1"
        intensity={40}
        position={[-2.2, 3.6, 2.4]}
        angle={0.5}
        penumbra={0.6}
        decay={2}
        distance={0}
        castShadow={params.shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
        shadow-normalBias={0.015}
        shadow-camera-near={1.5}
        shadow-camera-far={9}
      />
      <directionalLight ref={rim} color="#9aa8f0" intensity={0.3} position={[0, 2.6, -3]} />
      <hemisphereLight args={['#ffb27a', '#2a0a08', 0.35]} />
      <ProceduralEnvironment resolution={params.envRes} layout={layout} />
      {/* frames={1}: drei restarts its frame count whenever the component re-renders, so bumping
          `epoch` (a prop change) re-captures without reallocating render targets. */}
      <ContactShadows
        userData={{ epoch }}
        frames={1}
        position={[0, 0.0015, 0.05]}
        resolution={tier === 0 ? 256 : 512}
        blur={2.5}
        opacity={0.55}
        scale={4}
        far={1.2}
        color="#1a0504"
      />
    </>
  );
}
