/**
 * Two paper lanterns: ribbed lathe bodies glowing from inside with ink characters
 * 「开」「炫」, gold caps, red tassels and cords, each on a damped pendulum driven by device tilt,
 * pointer motion, tube motion and shake energy (not Rapier). Instanced: 2 draw calls for both.
 * Point lights: tier 2 → one in each, tier 1 → left only, tier 0 → none (glow sprites instead).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type PointLight,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityTier } from '@/types';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { isMobileDevice, tierParams } from '@/lib/quality';
import { addHeader, injectAfter } from '../shaders/noise';
import { BRUSH_FONT, fontsReady, redrawTexture } from '../text/canvasText';
import { GLOW_SLOTS, clearGlow, setGlow } from '../fx/Glows';
import { lanternFlicker } from './flicker';
import { noContact, useLayout } from './layout';

const RX = 0.16;
const RY = 0.21;
const CAP_TOP = 0.205;
const HANG_TOP = 0.25;
const CHARS = '开炫';
/** Device tilt (radians) that gives a full lantern drive: 35°. */
const TILT_FULL = (35 * Math.PI) / 180;
/** Length of the static cord above the swing pivot (m). */
const CORD_EXTENSION = 3.0;

function bodyGeometry(): BufferGeometry {
  const pts: Vector2[] = [];
  const n = 26;
  const delta = Math.asin(0.05 / RX);
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + delta + (i / n) * (Math.PI - 2 * delta);
    pts.push(new Vector2(Math.cos(a) * RX, Math.sin(a) * RY));
  }
  const g = new LatheGeometry(pts, 48, Math.PI, Math.PI * 2);
  // 12 bamboo ribs: push vertices out along the radial direction.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) continue;
    const th = Math.atan2(x, z);
    const rib = 0.006 * Math.pow(Math.abs(Math.cos(6 * th)), 8);
    const k = (r + rib) / r;
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

function tagged(g: BufferGeometry, metal: number, color: string): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  const count = ng.getAttribute('position').count;
  const m = new Float32Array(count).fill(metal);
  const c = new Color(color);
  const cols = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  ng.setAttribute('aMetal', new BufferAttribute(m, 1));
  ng.setAttribute('color', new BufferAttribute(cols, 3));
  return ng;
}

function hardwareGeometry(cord: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const GOLD = '#d9a441';
  const capTop = new CylinderGeometry(0.058, 0.07, 0.035, 24);
  capTop.translate(0, CAP_TOP, 0);
  parts.push(tagged(capTop, 1, GOLD));
  const capRim = new CylinderGeometry(0.074, 0.074, 0.008, 24);
  capRim.translate(0, CAP_TOP - 0.016, 0);
  parts.push(tagged(capRim, 1, GOLD));
  const knob = new CylinderGeometry(0.012, 0.016, 0.03, 12);
  knob.translate(0, CAP_TOP + 0.032, 0);
  parts.push(tagged(knob, 1, GOLD));
  const capBot = new CylinderGeometry(0.066, 0.054, 0.03, 24);
  capBot.translate(0, -0.2, 0);
  parts.push(tagged(capBot, 1, GOLD));
  const bead = new SphereGeometry(0.018, 12, 8);
  bead.translate(0, -0.228, 0);
  parts.push(tagged(bead, 1, GOLD));
  const head = new CylinderGeometry(0.012, 0.016, 0.035, 12);
  head.translate(0, -0.262, 0);
  parts.push(tagged(head, 0, '#e0412a'));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const len = 0.2 + 0.02 * Math.sin(i * 2.1);
    const t = new CylinderGeometry(0.003, 0.0045, len, 5);
    t.translate(Math.sin(a) * 0.009, -0.28 - len / 2, Math.cos(a) * 0.009);
    parts.push(tagged(t, 0, '#c8241c'));
  }
  const string = new CylinderGeometry(0.0028, 0.0028, cord, 5);
  string.translate(0, HANG_TOP + cord / 2, 0);
  parts.push(tagged(string, 0, '#2a1208'));
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('lantern hardware merge failed');
  return merged;
}

function inkCanvasTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const tex = new CanvasTexture(canvas);
  paintInk(tex);
  return tex;
}

function paintInk(tex: CanvasTexture): void {
  redrawTexture(tex, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(h * 0.8)}px ${BRUSH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    Array.from(CHARS).forEach((c, i) => ctx.fillText(c, w * (i * 0.5 + 0.25), h * 0.53));
  });
}

interface LanternUniforms {
  uInk: { value: CanvasTexture };
}

function makeBodyMaterial(u: LanternUniforms): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color('#a8241a'),
    roughness: 0.65,
    metalness: 0,
    emissive: new Color('#ff5a1f'),
    emissiveIntensity: 1,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, u);
    let vs = addHeader(
      shader.vertexShader,
      `attribute float aFlicker;
attribute float aChar;
varying float vLanFlick;
varying float vLanChar;
varying vec2 vLanUv;`,
    );
    vs = injectAfter(vs, '#include <begin_vertex>', 'vLanFlick = aFlicker; vLanChar = aChar; vLanUv = uv;');
    shader.vertexShader = vs;
    let fs = addHeader(
      shader.fragmentShader,
      `uniform sampler2D uInk;
varying float vLanFlick;
varying float vLanChar;
varying vec2 vLanUv;`,
    );
    fs = injectAfter(
      fs,
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        float nv = saturate(dot(normalize(normal), normalize(vViewPosition)));
        float core = 0.45 + 0.55 * pow(nv, 0.7);
        float th = vLanUv.x * 6.2831853;
        float rib = 1.0 - 0.45 * pow(abs(cos(6.0 * (th - 3.14159265))), 24.0);
        float ends = smoothstep(0.0, 0.16, vLanUv.y) * smoothstep(1.0, 0.84, vLanUv.y);
        vec2 cuv = vec2((vLanUv.x - 0.5) / 0.2 + 0.5, (vLanUv.y - 0.5) / 0.46 + 0.5);
        float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
        float ink = texture2D(uInk, vec2((clamp(cuv.x, 0.0, 1.0) + vLanChar) * 0.5, cuv.y)).r * inside;
        float glow = core * rib * mix(0.35, 1.0, ends) * (1.0 - 0.88 * ink) * vLanFlick;
        totalEmissiveRadiance *= glow;
        diffuseColor.rgb *= 1.0 - 0.8 * ink;
      }
      `,
    );
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'lantern-body';
  return m;
}

function makeHardwareMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 1 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    let vs = addHeader(shader.vertexShader, 'attribute float aMetal;\nvarying float vMetal;');
    vs = injectAfter(vs, '#include <begin_vertex>', 'vMetal = aMetal;');
    shader.vertexShader = vs;
    let fs = addHeader(shader.fragmentShader, 'varying float vMetal;');
    fs = injectAfter(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(0.75, 0.28, vMetal);');
    fs = injectAfter(fs, '#include <metalnessmap_fragment>', 'metalnessFactor = vMetal;');
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'lantern-hw';
  return m;
}

interface Swing {
  ax: number;
  az: number;
  vx: number;
  vz: number;
}

const tmpM = new Matrix4();
const tmpM2 = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpCenter = new Vector3();
const ONE = new Vector3(1, 1, 1);

export function Lanterns({ tier }: { tier: QualityTier }) {
  const layout = useLayout();
  const params = tierParams(tier, useMemo(isMobileDevice, []));
  const reduced = useStore((s) => s.reducedMotion);
  const cord = layout.lanternCord;

  const uniforms = useMemo<LanternUniforms>(() => ({ uInk: { value: inkCanvasTexture() } }), []);
  const bodyGeo = useMemo(() => {
    const g = bodyGeometry();
    g.setAttribute('aFlicker', new InstancedBufferAttribute(new Float32Array([1, 1]), 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aChar', new InstancedBufferAttribute(new Float32Array([0, 1]), 1));
    return g;
  }, []);
  const hwGeo = useMemo(() => hardwareGeometry(cord), [cord]);
  const bodyMat = useMemo(() => makeBodyMaterial(uniforms), [uniforms]);
  const hwMat = useMemo(makeHardwareMaterial, []);
  const body = useMemo(() => {
    const m = new InstancedMesh(bodyGeo, bodyMat, 2);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    noContact(m);
    return m;
  }, [bodyGeo, bodyMat]);
  const hw = useMemo(() => {
    const m = new InstancedMesh(hwGeo, hwMat, 2);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    noContact(m);
    return m;
  }, [hwGeo, hwMat]);
  // The cord above the swing pivot does not move: a static extension that rises out of frame, so
  // pulled-back portrait shots never show cords ending in mid-air.
  const cordGeo = useMemo(() => new CylinderGeometry(0.0028, 0.0028, CORD_EXTENSION, 5).translate(0, CORD_EXTENSION / 2, 0), []);
  const cordUp = useMemo(() => {
    const m = new InstancedMesh(cordGeo, hwMat, 2);
    m.frustumCulled = false;
    noContact(m);
    return m;
  }, [cordGeo, hwMat]);
  useEffect(() => {
    const L = HANG_TOP + cord;
    for (let i = 0; i < 2; i++) {
      const rest = layout.lanterns[i]!;
      tmpM.makeTranslation(rest[0], rest[1] + L, rest[2]);
      cordUp.setMatrixAt(i, tmpM);
    }
    cordUp.instanceMatrix.needsUpdate = true;
  }, [cordUp, layout, cord]);
  useEffect(() => () => cordGeo.dispose(), [cordGeo]);

  const swing = useRef<[Swing, Swing]>([
    { ax: 0.04, az: -0.02, vx: 0, vz: 0 },
    { ax: -0.03, az: 0.03, vx: 0, vz: 0 },
  ]);
  const light0 = useRef<PointLight>(null);
  const light1 = useRef<PointLight>(null);

  useEffect(() => {
    let alive = true;
    void fontsReady(CHARS).then(() => {
      if (alive) paintInk(uniforms.uInk.value);
    });
    return () => {
      alive = false;
    };
  }, [uniforms]);

  useEffect(
    () => () => {
      bodyGeo.dispose();
      bodyMat.dispose();
      hwMat.dispose();
      uniforms.uInk.value.dispose();
    },
    [bodyGeo, bodyMat, hwMat, uniforms],
  );
  useEffect(() => () => hwGeo.dispose(), [hwGeo]);
  useEffect(
    () => () => {
      clearGlow(GLOW_SLOTS.lantern0);
      clearGlow(GLOW_SLOTS.lantern1);
    },
    [],
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const t = state.clock.elapsedTime;
    const gain = reduced ? 0.3 : 1;
    const L = HANG_TOP + cord;
    const w2 = 9.81 / L;
    const tilt = rt.input.motion.tilt;
    const ptr = rt.input.pointer;
    const energy = rt.shake.energy;
    const flick = bodyGeo.getAttribute('aFlicker') as InstancedBufferAttribute;
    for (let i = 0; i < 2; i++) {
      const s = swing.current[i]!;
      const side = i === 0 ? -1 : 1;
      const gust = Math.sin(t * 0.43 + i * 2.1) * 0.06 + Math.sin(t * 1.27 + i) * 0.03;
      const shakeKick = energy * (Math.sin(t * 9.7 + i * 1.3) * 1.6 + Math.sin(t * 6.1 + i) * 0.9);
      const driveX =
        (gust + shakeKick) * 0.6 +
        ((tilt.x || 0) / TILT_FULL) * 0.9 +
        ptr.vel[0] * 0.25 +
        rt.tube.vel[0] * 1.4 * (1 - Math.abs(side * 0.3)) +
        rt.fx.lanternDrive[0];
      const driveZ =
        (gust * 0.5 + shakeKick * 0.6) * 0.5 + ((tilt.y || 0) / TILT_FULL) * 0.6 + rt.tube.vel[2] * 1.2 + rt.fx.lanternDrive[1];
      s.vx += (-w2 * s.ax - 1.2 * s.vx + driveX * gain * 2.2) * dt;
      s.vz += (-w2 * s.az - 1.2 * s.vz + driveZ * gain * 2.2) * dt;
      s.ax = Math.max(-0.5, Math.min(0.5, s.ax + s.vx * dt));
      s.az = Math.max(-0.5, Math.min(0.5, s.az + s.vz * dt));

      const rest = layout.lanterns[i]!;
      // Pivot above the lantern; swing about it.
      tmpM.makeTranslation(rest[0], rest[1] + L, rest[2]);
      tmpE.set(s.az, Math.sin(t * 0.2 + i) * 0.08 * gain, -s.ax);
      tmpQ.setFromEuler(tmpE);
      tmpM2.compose(tmpV.set(0, 0, 0), tmpQ, ONE);
      tmpM.multiply(tmpM2);
      tmpM2.makeTranslation(0, -L, 0);
      tmpM.multiply(tmpM2);
      body.setMatrixAt(i, tmpM);
      hw.setMatrixAt(i, tmpM);
      tmpCenter.setFromMatrixPosition(tmpM);

      const f = lanternFlicker(t, i);
      // Without bloom the renderer's ACES curve would bleach a hotter lantern to white.
      const base = params.composer === 'none' ? 1.45 : 2.6;
      const intensity = base * (1 + 0.1 * f + energy * 0.25);
      flick.setX(i, intensity);
      const light = i === 0 ? light0.current : light1.current;
      if (light) {
        light.position.copy(tmpCenter);
        light.intensity = 2.4 * (1 + 0.12 * f);
      }
      const slot = i === 0 ? GLOW_SLOTS.lantern0 : GLOW_SLOTS.lantern1;
      if (params.composer === 'none' || params.composer === 'lite') {
        const gi = 0.55 + 0.06 * f;
        setGlow(slot, tmpCenter.x, tmpCenter.y, tmpCenter.z, 1.0 * gi, 0.32 * gi, 0.08 * gi, params.composer === 'none' ? 1.3 : 0.95);
      } else clearGlow(slot);
    }
    flick.needsUpdate = true;
    body.instanceMatrix.needsUpdate = true;
    hw.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <primitive object={body} />
      <primitive object={hw} />
      <primitive object={cordUp} />
      {params.pointLights >= 1 && <pointLight ref={light0} color="#ff7a3a" intensity={2.4} distance={3.5} decay={2} />}
      {params.pointLights >= 2 && <pointLight ref={light1} color="#ff7a3a" intensity={2.4} distance={3.5} decay={2} />}
    </group>
  );
}
