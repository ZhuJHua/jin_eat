/**
 * Bronze 香炉 with three incense sticks that are the shake meter: visible height is
 * 0.28·(1 − 0.85·meter); ember tips glow brighter with shake energy; smoke ribbons rise from the
 * embers (2 on tiers 1–2, 1 billboard on tier 0) and from the tea cup (tiers 1–2).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityTier } from '@/types';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { isMobileDevice, tierParams } from '@/lib/quality';
import { addHeader, injectAfter, NOISE_GLSL } from '../shaders/noise';
import { MAX_RIBBONS, SMOKE_FRAG, SMOKE_VERT } from '../shaders/smoke';
import { GLOW_SLOTS, clearGlow, setGlow } from '../fx/Glows';
import { emberFlicker } from './flicker';
import { noContact, useLayout } from './layout';

const BOWL_TOP = 0.16;
const ASH_Y = 0.142;
const STICK_H = 0.28;
const STEM_H = 0.065;
const STICK_R = 0.0042;
/** Stick bases in censer-local space and their lean (rad about x, z). */
const STICKS: { x: number; z: number; lx: number; lz: number }[] = [
  { x: -0.034, z: 0.004, lx: 0.02, lz: 0.07 },
  { x: 0.0, z: -0.004, lx: -0.015, lz: 0.0 },
  { x: 0.034, z: 0.003, lx: 0.025, lz: -0.065 },
];

function censerGeometry(): BufferGeometry {
  // Bowl profile (outer wall, lip, inner wall down to the ash).
  const prof: [number, number][] = [
    [0.0, 0.045],
    [0.07, 0.046],
    [0.105, 0.06],
    [0.128, 0.085],
    [0.134, 0.112],
    [0.128, 0.138],
    [0.124, 0.148],
    [0.142, 0.156],
    [0.146, BOWL_TOP],
    [0.138, BOWL_TOP + 0.004],
    [0.124, 0.152],
    [0.118, ASH_Y - 0.004],
  ];
  const bowl = new LatheGeometry(
    prof.map(([r, y]) => new Vector2(r, y)),
    40,
  );
  const parts: BufferGeometry[] = [bowl.toNonIndexed()];
  bowl.dispose();
  // Neck band.
  const band = new TorusGeometry(0.1305, 0.004, 6, 48);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0.122, 0);
  parts.push(band.toNonIndexed());
  band.dispose();
  // Three cabriole legs.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = new CylinderGeometry(0.014, 0.009, 0.055, 10);
    leg.rotateZ(0.18);
    leg.rotateY(-a);
    leg.translate(Math.cos(a) * 0.088, 0.027, Math.sin(a) * 0.088);
    parts.push(leg.toNonIndexed());
    leg.dispose();
  }
  // Two upright ears on the rim.
  for (const side of [-1, 1]) {
    const ear = new TorusGeometry(0.03, 0.006, 8, 20, Math.PI);
    ear.translate(side * 0.128, BOWL_TOP + 0.002, 0);
    parts.push(ear.toNonIndexed());
    ear.dispose();
  }
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('censer merge failed');
  merged.computeVertexNormals();
  return merged;
}

function makeBronze(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color('#a07a3c'), metalness: 0.9, roughness: 0.45 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    let vs = addHeader(shader.vertexShader, 'varying vec3 vBzPos;\nvarying vec3 vBzNrm;');
    vs = injectAfter(vs, '#include <begin_vertex>', 'vBzPos = transformed; vBzNrm = objectNormal;');
    shader.vertexShader = vs;
    let fs = addHeader(shader.fragmentShader, `varying vec3 vBzPos;\nvarying vec3 vBzNrm;\n${NOISE_GLSL}`);
    fs = injectAfter(
      fs,
      '#include <color_fragment>',
      /* glsl */ `
      float bzN = jFbm3(vBzPos * 16.0);
      float bzLow = 1.0 - smoothstep(0.03, 0.12, vBzPos.y);
      float bzUnder = smoothstep(0.2, -0.6, vBzNrm.y);
      float patina = smoothstep(0.55, 0.8, bzN + bzLow * 0.25 + bzUnder * 0.15);
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.3 * bzN), vec3(0.247, 0.42, 0.353), patina * 0.6);
      `,
    );
    fs = injectAfter(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.85, patina);');
    fs = injectAfter(fs, '#include <metalnessmap_fragment>', 'metalnessFactor = mix(metalnessFactor, 0.1, patina);');
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'bronze';
  return m;
}

function makeStickMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    let vs = addHeader(shader.vertexShader, 'varying float vStickH;\nvarying float vStickTop;');
    vs = injectAfter(
      vs,
      '#include <begin_vertex>',
      `#ifdef USE_INSTANCING
        float sy = length(instanceMatrix[1].xyz);
      #else
        float sy = 1.0;
      #endif
      vStickH = position.y * sy;
      vStickTop = sy;`,
    );
    shader.vertexShader = vs;
    let fs = addHeader(shader.fragmentShader, 'varying float vStickH;\nvarying float vStickTop;');
    fs = injectAfter(
      fs,
      '#include <color_fragment>',
      `{
        vec3 stem = vec3(0.62, 0.06, 0.05);
        vec3 paste = vec3(0.32, 0.17, 0.09);
        vec3 ash = vec3(0.42, 0.4, 0.38);
        vec3 c = mix(stem, paste, step(${STEM_H.toFixed(3)}, vStickH));
        c = mix(c, ash, smoothstep(vStickTop - 0.012, vStickTop - 0.004, vStickH));
        diffuseColor.rgb = c;
      }`,
    );
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'incense-stick';
  return m;
}

function ribbonGeometry(count: number, rows: number): BufferGeometry {
  const verts = count * (rows + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const rib = new Float32Array(verts);
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k < count; k++) {
    const base = v;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < 2; c++) {
        uv[v * 2] = c;
        uv[v * 2 + 1] = r / rows;
        rib[v] = k;
        v++;
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = base + r * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aRibbon', new BufferAttribute(rib, 1));
  g.setIndex(idx);
  return g;
}

const tmpObj = new Object3D();
const tmpMat = new Matrix4();
const tmpTip = new Vector3();
const UP = new Vector3(0, 1, 0);

export function Incense({ tier }: { tier: QualityTier }) {
  const layout = useLayout();
  const params = tierParams(tier, useMemo(isMobileDevice, []));
  const reduced = useStore((s) => s.reducedMotion);
  const [cx, cy, cz] = layout.censer;
  const cup = layout.cup;

  const censerGeo = useMemo(censerGeometry, []);
  const bronze = useMemo(makeBronze, []);
  const ashGeo = useMemo(() => new CircleGeometry(0.119, 32).rotateX(-Math.PI / 2), []);
  const ashMat = useMemo(() => new MeshStandardMaterial({ color: new Color('#7a7068'), roughness: 1, metalness: 0 }), []);
  const stickGeo = useMemo(() => new CylinderGeometry(STICK_R, STICK_R, 1, 6, 1).translate(0, 0.5, 0), []);
  const stickMat = useMemo(makeStickMaterial, []);
  const sticks = useMemo(() => {
    const m = new InstancedMesh(stickGeo, stickMat, 3);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    return m;
  }, [stickGeo, stickMat]);
  const emberGeo = useMemo(() => new SphereGeometry(STICK_R * 1.35, 8, 6), []);
  const emberMat = useMemo(() => new MeshBasicMaterial({ color: new Color('#ff6a1a') }), []);
  const embers = useMemo(() => {
    const m = new InstancedMesh(emberGeo, emberMat, 3);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    noContact(m);
    return m;
  }, [emberGeo, emberMat]);

  // Smoke: ribbons 0..1 incense, 2 tea steam.
  const ribbonCount = params.smoke === 'ribbon' ? 3 : 1;
  const smokeGeo = useMemo(() => ribbonGeometry(ribbonCount, params.smoke === 'ribbon' ? 64 : 24), [ribbonCount, params.smoke]);
  const smokeMat = useMemo(() => {
    const origins = Array.from({ length: MAX_RIBBONS }, () => new Vector3());
    const shapes = Array.from({ length: MAX_RIBBONS }, () => new Vector4());
    return new ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        uOrigin: { value: origins },
        uShape: { value: shapes },
        uTime: { value: 0 },
        uSpeed: { value: 1 },
        uBend: { value: new Vector2() },
        uColor: { value: new Color('#d9cfc6') },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      premultipliedAlpha: true,
    });
  }, []);
  const smoke = useMemo(() => {
    const m = new Mesh(smokeGeo, smokeMat);
    m.frustumCulled = false;
    m.renderOrder = 15;
    noContact(m);
    return m;
  }, [smokeGeo, smokeMat]);

  useEffect(() => () => smokeGeo.dispose(), [smokeGeo]);
  useEffect(
    () => () => {
      censerGeo.dispose();
      bronze.dispose();
      ashGeo.dispose();
      ashMat.dispose();
      stickGeo.dispose();
      stickMat.dispose();
      emberGeo.dispose();
      emberMat.dispose();
      smokeMat.dispose();
      clearGlow(GLOW_SLOTS.ember0);
      clearGlow(GLOW_SLOTS.ember1);
      clearGlow(GLOW_SLOTS.ember2);
    },
    [censerGeo, bronze, ashGeo, ashMat, stickGeo, stickMat, emberGeo, emberMat, smokeMat],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const meter = Math.max(0, Math.min(1, rt.shake.meter));
    const energy = Math.max(0, Math.min(1, rt.shake.energy));
    const origins = smokeMat.uniforms.uOrigin!.value as Vector3[];
    const shapes = smokeMat.uniforms.uShape!.value as Vector4[];

    for (let i = 0; i < 3; i++) {
      const s = STICKS[i]!;
      // Each stick burns a touch differently so they don't look cloned.
      const h = STICK_H * (1 - 0.85 * Math.min(1, meter * (1 + (i - 1) * 0.04))) * (1 - i * 0.015);
      tmpObj.position.set(cx + s.x, cy + ASH_Y - 0.01, cz + s.z);
      tmpObj.rotation.set(s.lx, 0, s.lz);
      tmpObj.scale.set(1, h, 1);
      tmpObj.updateMatrix();
      sticks.setMatrixAt(i, tmpObj.matrix);
      // Ember at the tip.
      tmpTip.copy(UP).multiplyScalar(h).applyEuler(tmpObj.rotation).add(tmpObj.position);
      const f = emberFlicker(t, i);
      const glow = 1 + 2 * energy + 0.25 * f;
      tmpMat.makeTranslation(tmpTip.x, tmpTip.y, tmpTip.z);
      embers.setMatrixAt(i, tmpMat);
      const slot = i === 0 ? GLOW_SLOTS.ember0 : i === 1 ? GLOW_SLOTS.ember1 : GLOW_SLOTS.ember2;
      setGlow(slot, tmpTip.x, tmpTip.y, tmpTip.z, 1.0 * glow * 0.55, 0.32 * glow * 0.55, 0.06 * glow * 0.55, 0.05 + energy * 0.05);
      if (i === 0 || (i === 2 && ribbonCount >= 2)) {
        const k = i === 0 ? 0 : 1;
        origins[k]!.set(tmpTip.x, tmpTip.y + 0.004, tmpTip.z);
        shapes[k]!.set(1.05, 0.2, params.smoke === 'ribbon' ? 0.42 : 0.5, k * 0.37 + 0.11);
      }
    }
    sticks.instanceMatrix.needsUpdate = true;
    embers.instanceMatrix.needsUpdate = true;
    emberMat.color.setRGB(1.0, 0.32, 0.06).multiplyScalar(2.6 + 3.5 * energy + 0.4 * emberFlicker(t, 7));

    if (ribbonCount >= 3) {
      origins[2]!.set(cup[0], cup[1] + 0.06, cup[2]);
      shapes[2]!.set(0.32, 0.1, 0.16, 0.73);
    }
    const u = smokeMat.uniforms;
    u.uTime!.value = t;
    u.uSpeed!.value = reduced ? 0.5 : 1;
    const bend = u.uBend!.value as Vector2;
    const target = rt.fx.smokeBend;
    bend.x += ((target[0] ?? 0) - bend.x) * 0.08;
    bend.y += ((target[1] ?? 0) - bend.y) * 0.08;
  });

  return (
    <group>
      <group position={[cx, cy, cz]}>
        <mesh geometry={censerGeo} material={bronze} castShadow={false} />
        <mesh ref={noContact} geometry={ashGeo} material={ashMat} position={[0, ASH_Y, 0]} />
      </group>
      <primitive object={sticks} />
      <primitive object={embers} />
      <primitive object={smoke} />
    </group>
  );
}
