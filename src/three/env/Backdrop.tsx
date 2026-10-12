/**
 * Backdrop: a curved wall (cylinder segment, r 6, 120°) with the dusk moon window,
 * a dark stone floor, and on tier 2 a slow god-ray wedge spilling from the window.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Mesh,
} from 'three';
import type { QualityTier } from '@/types';
import { tierParams, isMobileDevice } from '@/lib/quality';
import { BACKDROP_FRAG, BACKDROP_VERT, FLOOR_FRAG } from '../shaders/backdrop';
import { NOISE_GLSL } from '../shaders/noise';
import { ALTAR, BACKDROP, noContact, useLayout } from './layout';
import { lanternFlicker } from './flicker';

const GODRAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GODRAY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uStrength;
${NOISE_GLSL}
void main() {
  // Perspective-interpolated varyings can overshoot [0,1] by an ulp at the wedge edges; pow() of a
  // negative base is NaN, and a single NaN pixel in the HDR target gets smeared by bloom into a
  // black hole. Clamp before any pow/smoothstep.
  float along = clamp(vUv.y, 0.0, 1.0);
  float across = clamp(vUv.x, 0.0, 1.0) - 0.5;
  float shafts = jNoise2(vec2(across * 9.0 + uTime * 0.05, along * 0.8 - uTime * 0.02));
  shafts = smoothstep(0.35, 0.9, shafts) * 0.8 + 0.2;
  float edge = 1.0 - smoothstep(0.18, 0.5, abs(across));
  float fall = pow(max(1.0 - along, 0.0), 1.6) * smoothstep(0.0, 0.08, along);
  float a = clamp(shafts * edge * fall * uStrength, 0.0, 1.0);
  vec3 col = vec3(1.0, 0.62, 0.36) * a;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Trapezoid wedge geometry: narrow at the window (v = 0), wide toward the viewer (v = 1). */
function wedgeGeometry(nearW: number, farW: number, length: number): BufferGeometry {
  const g = new BufferGeometry();
  const pos = new Float32Array([-nearW / 2, 0, 0, nearW / 2, 0, 0, -farW / 2, 0, length, farW / 2, 0, length]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

function GodRay({ x, y, r }: { x: number; y: number; r: number }) {
  const group = useRef<Mesh>(null);
  const { geo, mat } = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: GODRAY_VERT,
      fragmentShader: GODRAY_FRAG,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0.16 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      premultipliedAlpha: true,
    });
    return { geo: wedgeGeometry(r * 1.6, 3.2, 4.2), mat: m };
  }, [r]);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mat.uniforms.uTime!.value = t;
    const g = group.current;
    if (!g) return;
    // Slow ±3° sweep.
    g.rotation.set(0.42, Math.sin(t * 0.09) * 0.052, 0);
  });

  return (
    <mesh
      ref={(m) => {
        group.current = m;
        noContact(m);
      }}
      geometry={geo}
      material={mat}
      position={[x, y, BACKDROP.z + 0.05]}
      renderOrder={5}
      frustumCulled={false}
    />
  );
}

export function Backdrop({ tier }: { tier: QualityTier }) {
  const layout = useLayout();
  const params = tierParams(tier, useMemo(isMobileDevice, []));
  const wallMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uWin: { value: new Vector3() },
          uLamp0: { value: new Vector3() },
          uLamp1: { value: new Vector3() },
          uLampGlow: { value: 1 },
          uTop: { value: new Color('#1a0b14') },
          uLow: { value: new Color('#5a2416') },
          uDetail: { value: 1 },
        },
        side: DoubleSide,
      }),
    [],
  );
  const floorMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BACKDROP_VERT,
        fragmentShader: FLOOR_FRAG,
        uniforms: { uColor: { value: new Color('#2a120c') } },
      }),
    [],
  );
  const wallGeo = useMemo(() => {
    const arc = (BACKDROP.arcDeg * Math.PI) / 180;
    // Cylinder centred so the middle of the arc sits at z = BACKDROP.z.
    return new CylinderGeometry(BACKDROP.radius, BACKDROP.radius, BACKDROP.height, 64, 1, true, Math.PI - arc / 2, arc);
  }, []);
  const floorGeo = useMemo(() => new PlaneGeometry(14, 9).rotateX(-Math.PI / 2), []);

  wallMat.uniforms.uDetail!.value = tier === 0 ? 0 : 1;
  useEffect(
    () => () => {
      wallMat.dispose();
      floorMat.dispose();
      wallGeo.dispose();
      floorGeo.dispose();
    },
    [wallMat, floorMat, wallGeo, floorGeo],
  );

  useFrame((state) => {
    const u = wallMat.uniforms;
    const t = state.clock.elapsedTime;
    u.uTime!.value = t;
    (u.uWin!.value as Vector3).set(layout.window.x, layout.window.y, layout.window.r);
    const [l0, l1] = layout.lanterns;
    (u.uLamp0!.value as Vector3).set(l0[0], l0[1], l0[2]);
    (u.uLamp1!.value as Vector3).set(l1[0], l1[1], l1[2]);
    u.uLampGlow!.value = 0.8 + 0.2 * lanternFlicker(t, 0);
  });

  return (
    <group>
      <mesh
        ref={noContact}
        geometry={wallGeo}
        material={wallMat}
        position={[0, BACKDROP.bottomY + BACKDROP.height / 2, BACKDROP.z + BACKDROP.radius]}
        frustumCulled={false}
        renderOrder={-10}
      />
      <mesh ref={noContact} geometry={floorGeo} material={floorMat} position={[0, ALTAR.floorY, 0.5]} renderOrder={-9} />
      {params.godray && <GodRay x={layout.window.x} y={layout.window.y} r={layout.window.r} />}
    </group>
  );
}
