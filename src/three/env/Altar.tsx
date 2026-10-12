/**
 * Altar: lacquered dark wood table top (rounded, with a gilded front inlay) over a
 * recessed cabinet and plinth — one merged mesh — plus the red altar cloth draped over the front
 * edge with an embroidered 锦 medallion, 「有求必应 · 不吃白不吃」 and a gold fringe that sways.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { QualityTier } from '@/types';
import { COPY } from '@/data/copy';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { patchWood } from '../shaders/wood';
import { patchLacquerFresnel } from '../shaders/lacquer';
import { addHeader, injectAfter } from '../shaders/noise';
import { BRUSH_FONT, goldGradient } from '../text/canvasText';
import { usePaintedTextures, type PaintMode } from '../text/useTextTextures';
import { ALTAR, noContact } from './layout';
import { mergeAll } from './geometry';

function altarGeometry(): BufferGeometry {
  const slab = new RoundedBoxGeometry(ALTAR.width, ALTAR.height, ALTAR.depth, 4, 0.03);
  slab.translate(0, -ALTAR.height / 2, 0);
  const apron = new BoxGeometry(ALTAR.width - 0.1, 0.06, ALTAR.depth - 0.1);
  apron.translate(0, -ALTAR.height - 0.03, 0);
  const cabH = -ALTAR.floorY - ALTAR.height - 0.16;
  const cabinet = new BoxGeometry(ALTAR.width - 2 * ALTAR.cabinetInset, cabH, ALTAR.depth - 2 * ALTAR.cabinetInset);
  cabinet.translate(0, -ALTAR.height - 0.06 - cabH / 2, 0);
  const plinth = new BoxGeometry(ALTAR.width - 0.04, 0.1, ALTAR.depth - 0.04);
  plinth.translate(0, ALTAR.floorY + 0.05, 0);
  return mergeAll([slab, apron, cabinet, plinth], ['position', 'normal', 'uv']);
}

/** Shared lacquered-wood material factory (also used by the plaque board). */
export function makeWoodMaterial(tier: QualityTier, wood: Parameters<typeof patchWood>[1] = {}, cacheKey = 'wood'): MeshStandardMaterial {
  const common = { color: new Color('#ffffff'), roughness: 0.55, metalness: 0 };
  const mat: MeshStandardMaterial =
    tier === 2 ? new MeshPhysicalMaterial({ ...common, clearcoat: 0.22, clearcoatRoughness: 0.32 }) : new MeshStandardMaterial(common);
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    patchWood(shader, { roughness: 0.55, ...wood });
    if (tier !== 2) patchLacquerFresnel(shader, 0.14);
  };
  mat.customProgramCacheKey = () => `${cacheKey}-${tier}`;
  return mat;
}

const CLOTH_W = 1.6;
const CLOTH_TOP = 0.2;
const CLOTH_HANG = 0.6;
const CLOTH_Y = 0.004;
const BEND_R = 0.034;

interface ClothGeo {
  geo: BufferGeometry;
  length: number;
  /** Texture-space v where the hanging part starts (0 = back edge on the table). */
  hangV: number;
}

function clothGeometry(): ClothGeo {
  const cols = 17;
  const zFront = ALTAR.front + 0.004;
  const zBack = zFront - CLOTH_TOP;
  const cz = zFront - BEND_R;
  const cy = CLOTH_Y - BEND_R;
  const arcLen = (Math.PI / 2) * BEND_R;
  const topLen = cz - zBack;
  const length = topLen + arcLen + CLOTH_HANG;
  const rows: { y: number; z: number; hang: number; s: number }[] = [];
  const nTop = 4;
  const nArc = 5;
  const nHang = 22;
  for (let i = 0; i <= nTop; i++) {
    const s = (i / nTop) * topLen;
    rows.push({ y: CLOTH_Y, z: zBack + s, hang: 0, s });
  }
  for (let i = 1; i <= nArc; i++) {
    const a = (i / nArc) * (Math.PI / 2);
    rows.push({ y: cy + Math.cos(a) * BEND_R, z: cz + Math.sin(a) * BEND_R, hang: 0, s: topLen + (i / nArc) * arcLen });
  }
  for (let i = 1; i <= nHang; i++) {
    const d = (i / nHang) * CLOTH_HANG;
    rows.push({ y: cy - d, z: zFront, hang: d, s: topLen + arcLen + d });
  }
  const nRows = rows.length;
  const pos = new Float32Array(nRows * cols * 3);
  const uv = new Float32Array(nRows * cols * 2);
  const hang = new Float32Array(nRows * cols);
  rows.forEach((r, ri) => {
    for (let c = 0; c < cols; c++) {
      const k = ri * cols + c;
      const u = c / (cols - 1);
      pos[k * 3] = (u - 0.5) * CLOTH_W;
      pos[k * 3 + 1] = r.y;
      pos[k * 3 + 2] = r.z;
      uv[k * 2] = u;
      uv[k * 2 + 1] = 1 - r.s / length;
      hang[k] = r.hang;
    }
  });
  const idx: number[] = [];
  for (let r = 0; r < nRows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = (r + 1) * cols + c;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('aHang', new BufferAttribute(hang, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, length, hangV: (topLen + arcLen) / length };
}

function cloudScroll(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // Stylised 祥云: three tangent curls.
  ctx.beginPath();
  ctx.arc(x, y, s, Math.PI * 0.1, Math.PI * 1.6);
  ctx.arc(x + s * 1.35, y - s * 0.35, s * 0.8, Math.PI * 0.9, Math.PI * 2.2);
  ctx.arc(x + s * 2.5, y + s * 0.1, s * 0.6, Math.PI * 1.1, Math.PI * 2.6);
  ctx.stroke();
}

function paintCloth(hangV: number) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, mode: PaintMode): void => {
    const mask = mode === 'mask';
    const RED = mask ? 'rgb(0, 205, 0)' : '#9e1018';
    const GOLD = (y0: number, y1: number): string | CanvasGradient => (mask ? 'rgb(0, 90, 255)' : goldGradient(ctx, y0, y1));
    const fringeH = Math.round(h * 0.075);
    const hangY = hangV * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, w, h - fringeH);

    if (!mask) {
      // Woven sheen: slight vertical variation and a damask of cloud scrolls.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.5, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h - fringeH);
      ctx.strokeStyle = 'rgba(255, 120, 90, 0.10)';
      ctx.lineWidth = 3;
      for (let yy = hangY + 40; yy < h - fringeH - 30; yy += 74) {
        for (let xx = ((yy / 74) % 2) * 60 + 20; xx < w; xx += 120) cloudScroll(ctx, xx, yy, 11);
      }
    }

    // Gold borders: side bands and the hem above the fringe, plus a band at the fold.
    ctx.fillStyle = GOLD(0, h);
    const band = 14;
    ctx.fillRect(22, 0, band, h - fringeH);
    ctx.fillRect(w - 22 - band, 0, band, h - fringeH);
    ctx.fillRect(0, h - fringeH - 26, w, band);
    ctx.fillRect(0, hangY - 6, w, 6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = mask ? 'rgb(0, 90, 255)' : '#e8b64c';
    ctx.strokeRect(46, hangY + 14, w - 92, h - fringeH - hangY - 52);

    // 回纹 key-fret along the table-top part.
    ctx.lineWidth = 4;
    const fy = hangY * 0.5;
    ctx.beginPath();
    for (let x = 60; x < w - 60; x += 36) {
      ctx.moveTo(x, fy + 10);
      ctx.lineTo(x, fy - 10);
      ctx.lineTo(x + 24, fy - 10);
      ctx.lineTo(x + 24, fy + 4);
      ctx.lineTo(x + 10, fy + 4);
    }
    ctx.stroke();

    // Medallion.
    const mx = w / 2;
    const my = hangY + (h - fringeH - hangY) * 0.4;
    const mr = (h - fringeH - hangY) * 0.29;
    ctx.fillStyle = GOLD(my - mr, my + mr);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mask ? 'rgb(0, 205, 0)' : '#8a0c14';
    ctx.beginPath();
    ctx.arc(mx, my, mr * 0.84, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mask ? 'rgb(0, 90, 255)' : '#f2c14e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 0.76, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `${Math.round(mr * 1.15)}px ${BRUSH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!mask) {
      ctx.fillStyle = 'rgba(40, 0, 0, 0.6)';
      ctx.fillText(COPY.scene.clothMedallion, mx + 3, my + 5);
    }
    ctx.fillStyle = GOLD(my - mr, my + mr);
    ctx.fillText(COPY.scene.clothMedallion, mx, my + 2);

    // Motto.
    const ty = my + mr + (h - fringeH - 26 - (my + mr)) * 0.5;
    ctx.font = `${Math.round(h * 0.07)}px ${BRUSH_FONT}`;
    if (!mask) {
      ctx.fillStyle = 'rgba(40, 0, 0, 0.55)';
      ctx.fillText(COPY.scene.cloth, mx + 2, ty + 3);
    }
    ctx.fillStyle = GOLD(ty - 20, ty + 20);
    ctx.fillText(COPY.scene.cloth, mx, ty);

    // Fringe: gold strands with gaps (alpha-tested).
    ctx.fillStyle = GOLD(h - fringeH, h);
    for (let x = 4; x < w; x += 7) {
      const len = fringeH * (0.82 + 0.18 * Math.sin(x * 0.37));
      ctx.fillRect(x, h - fringeH - 1, 3.2, len);
    }
  };
}

const CLOTH_VERT_HEAD = /* glsl */ `
attribute float aHang;
uniform float uTime;
uniform vec3 uDrive;
`;

function makeClothMaterial(
  tier: QualityTier,
  map: Texture,
  mask: Texture,
  uniforms: { uTime: { value: number }; uDrive: { value: [number, number, number] } },
): MeshStandardMaterial {
  const common = {
    map,
    roughnessMap: mask,
    metalnessMap: mask,
    roughness: 1,
    metalness: 1,
    alphaTest: 0.5,
    envMapIntensity: 1.1,
  };
  const mat: MeshStandardMaterial =
    tier === 2
      ? new MeshPhysicalMaterial({ ...common, sheen: 0.7, sheenColor: new Color('#ff6a52'), sheenRoughness: 0.45 })
      : new MeshStandardMaterial(common);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = addHeader(shader.vertexShader, CLOTH_VERT_HEAD);
    vs = injectAfter(
      vs,
      '#include <begin_vertex>',
      /* glsl */ `
      {
        float k = clamp(aHang / ${CLOTH_HANG.toFixed(3)}, 0.0, 1.0);
        float k15 = k * sqrt(k);
        float sw = sin(uTime * 1.05 + position.x * 1.9) * 0.7 + sin(uTime * 2.3 + position.x * 4.3) * 0.3;
        transformed.z += k15 * (0.01 * sw + uDrive.y * 0.035) + k * k * uDrive.z * 0.02 * sin(uTime * 13.0 + position.x * 6.0);
        transformed.z = max(transformed.z, ${(ALTAR.front - ALTAR.cabinetInset + 0.01).toFixed(3)});
        transformed.x += k * k * uDrive.x * 0.03;
      }
      `,
    );
    shader.vertexShader = vs;
  };
  mat.customProgramCacheKey = () => `cloth-${tier}`;
  return mat;
}

export function Altar({ tier }: { tier: QualityTier }) {
  const geo = useMemo(altarGeometry, []);
  const woodMat = useMemo(
    () => makeWoodMaterial(tier, { inlay: { y0: -0.058, y1: -0.042, intensity: 0.6 }, shadeBelow: -0.3 }, 'altar'),
    [tier],
  );
  const cloth = useMemo(clothGeometry, []);
  const textures = usePaintedTextures(
    paintCloth(cloth.hangV),
    1024,
    Math.round((1024 * cloth.length) / CLOTH_W),
    COPY.scene.cloth + COPY.scene.clothMedallion,
    [cloth.hangV],
  );
  const clothUniforms = useMemo(() => ({ uTime: { value: 0 }, uDrive: { value: [0, 0, 0] as [number, number, number] } }), []);
  const clothMat = useMemo(() => makeClothMaterial(tier, textures.map, textures.mask, clothUniforms), [tier, textures, clothUniforms]);
  const reduced = useStore((s) => s.reducedMotion);

  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => cloth.geo.dispose(), [cloth]);
  useEffect(() => () => woodMat.dispose(), [woodMat]);
  useEffect(() => () => clothMat.dispose(), [clothMat]);

  useFrame((state, delta) => {
    clothUniforms.uTime.value = state.clock.elapsedTime * (reduced ? 0.3 : 1);
    const d = clothUniforms.uDrive.value;
    const k = Math.min(1, delta * 4);
    const gain = reduced ? 0.3 : 1;
    // Table vibration from the tube, plus lantern wind.
    const tx = (rt.tube.vel[0] * 0.6 + rt.fx.lanternDrive[0] * 0.5) * gain;
    const tz = (rt.tube.vel[2] * 0.6 + rt.fx.lanternDrive[1] * 0.5 - Math.abs(rt.tube.vel[0]) * 0.2) * gain;
    d[0] += (Math.max(-1, Math.min(1, tx)) - d[0]) * k;
    d[1] += (Math.max(-1, Math.min(1, tz)) - d[1]) * k;
    d[2] += (rt.shake.energy * gain - d[2]) * k;
  });

  return (
    <group>
      <mesh ref={noContact} geometry={geo} material={woodMat} receiveShadow />
      <mesh ref={noContact} geometry={cloth.geo} material={clothMat} receiveShadow />
    </group>
  );
}
