/**
 * Plaque and couplets: a dark lacquered board with gilded 「锦少午餐观」 and a small
 * hanging 横批 (「开炫大吉」, Friday 「周五特供 · 允许奶茶」); red 洒金 couplets with gold brush text on
 * two red lacquer pillars (wide screens only). Text textures repaint once the brush font is loaded.
 */
import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { QualityTier } from '@/types';
import { COPY } from '@/data/copy';
import { plaqueSubline } from '@/draw/eggs';
import { useStore } from '@/state/store';
import { patchLacquerFresnel } from '../shaders/lacquer';
import { addHeader, injectAfter } from '../shaders/noise';
import { BRUSH_FONT, goldGradient } from '../text/canvasText';
import { usePaintedTextures, type PaintMode } from '../text/useTextTextures';
import { makeWoodMaterial } from './Altar';
import { noContact, useLayout } from './layout';
import { mergeAll } from './geometry';

const PW = 1.6;
const PH = 0.5;
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * PH) / PW); // 320
/** Where the title row ends and the sub-line cartouche begins (fraction of the face height). */
const TITLE_FRAC = 0.66;

function mergeOrThrow(geos: BufferGeometry[]): BufferGeometry {
  return mergeAll(geos, ['position', 'normal', 'uv']);
}

/** Remap a plane's UVs into the [u0,u1]×[v0,v1] window of the shared canvas. */
function remapUv(g: BufferGeometry, u0: number, u1: number, v0: number, v1: number): BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

function cornerCloud(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + sy * s * 2.2);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * s * 2.2, y);
  ctx.moveTo(x + sx * s * 0.6, y + sy * s * 1.4);
  ctx.arc(x + sx * s * 0.9, y + sy * s * 0.9, s * 0.45, 0, Math.PI * 1.5);
  ctx.stroke();
}

function paintPlaque(sub: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, mode: PaintMode): void => {
    const mask = mode === 'mask';
    const gold = (y0: number, y1: number): string | CanvasGradient => (mask ? 'rgb(0, 80, 255)' : goldGradient(ctx, y0, y1));
    ctx.clearRect(0, 0, w, h);

    // Lacquered ground with a soft warm centre.
    ctx.fillStyle = mask ? 'rgb(0, 70, 0)' : '#1d0907';
    ctx.fillRect(0, 0, w, h);
    if (!mask) {
      const g = ctx.createRadialGradient(w / 2, h * 0.4, 20, w / 2, h * 0.5, w * 0.6);
      g.addColorStop(0, 'rgba(90, 20, 10, 0.55)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = gold(0, h);
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, w - 60, h - 60);
    ctx.lineWidth = 4;
    cornerCloud(ctx, 42, 42, 1, 1, 14);
    cornerCloud(ctx, w - 42, 42, -1, 1, 14);
    cornerCloud(ctx, 42, h - 42, 1, -1, 14);
    cornerCloud(ctx, w - 42, h - 42, -1, -1, 14);

    // Title row.
    const titleH = h * TITLE_FRAC;
    const title = COPY.scene.plaque;
    const size = Math.round(titleH * 0.66);
    ctx.font = `${size}px ${BRUSH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyphs = Array.from(title);
    const span = w - 220;
    const ty = titleH * 0.6;
    glyphs.forEach((gch, i) => {
      const x = 110 + span * ((i + 0.5) / glyphs.length);
      if (!mask) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillText(gch, x + 4, ty + 5);
        ctx.fillStyle = 'rgba(255, 236, 190, 0.35)';
        ctx.fillText(gch, x - 2, ty - 2);
      }
      ctx.fillStyle = gold(ty - size / 2, ty + size / 2);
      ctx.fillText(gch, x, ty);
    });

    // Sub-line in a cinnabar cartouche (「开炫大吉」, Friday 「周五特供 · 允许奶茶」).
    const subGlyphs = Array.from(sub).length;
    const ch = (h - titleH) * 0.62;
    const subSize = Math.round(ch * 0.68);
    const cw = Math.min(w - 160, subGlyphs * subSize * 1.02 + 70);
    const cx = (w - cw) / 2;
    const cy = titleH + (h - titleH - ch) * 0.32;
    ctx.fillStyle = mask ? 'rgb(0, 180, 0)' : '#a3121a';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = gold(cy, cy + ch);
    ctx.lineWidth = 4;
    ctx.strokeRect(cx + 6, cy + 6, cw - 12, ch - 12);
    ctx.font = `${subSize}px ${BRUSH_FONT}`;
    if (!mask) {
      ctx.fillStyle = 'rgba(40, 0, 0, 0.6)';
      ctx.fillText(sub, w / 2 + 2, cy + ch / 2 + 3);
    }
    ctx.fillStyle = gold(cy, cy + ch);
    ctx.fillText(sub, w / 2, cy + ch / 2 + 1);
  };
}

const CPL_W = 0.32;
const CPL_H = 1.6;

function paintCouplets(ctx: CanvasRenderingContext2D, w: number, h: number, mode: PaintMode): void {
  const mask = mode === 'mask';
  const half = w / 2;
  const lines = [COPY.scene.coupletLeft, COPY.scene.coupletRight];
  ctx.clearRect(0, 0, w, h);
  for (let s = 0; s < 2; s++) {
    const x0 = s * half;
    ctx.fillStyle = mask ? 'rgb(0, 200, 0)' : '#a8101a';
    ctx.fillRect(x0, 0, half, h);
    // 洒金: scattered gold leaf flecks (deterministic).
    let seed = 1234 + s * 777;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.fillStyle = mask ? 'rgb(0, 80, 255)' : 'rgba(240, 196, 92, 0.75)';
    for (let i = 0; i < 260; i++) {
      const fx = x0 + rnd() * half;
      const fy = rnd() * h;
      const fs = 1 + rnd() * 3.5;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillRect(-fs, -fs * 0.6, fs * 2, fs * 1.2);
      ctx.restore();
    }
    if (!mask) {
      const g = ctx.createLinearGradient(x0, 0, x0 + half, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, half, h);
    }
    const text = Array.from(lines[s] ?? '');
    const step = (h - 120) / text.length;
    const size = Math.min(half * 0.78, step * 0.92);
    ctx.font = `${Math.round(size)}px ${BRUSH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    text.forEach((gch, i) => {
      const x = x0 + half / 2;
      const y = 60 + step * (i + 0.5);
      if (!mask) {
        ctx.fillStyle = 'rgba(30, 0, 0, 0.55)';
        ctx.fillText(gch, x + 3, y + 4);
      }
      ctx.fillStyle = mask ? 'rgb(0, 80, 255)' : goldGradient(ctx, y - size / 2, y + size / 2);
      ctx.fillText(gch, x, y);
    });
  }
}

function useSubline(): string {
  const [sub, setSub] = useState(() => plaqueSubline());
  useEffect(() => {
    const id = setInterval(() => setSub(plaqueSubline()), 60_000);
    return () => clearInterval(id);
  }, []);
  return sub;
}

export function Plaque({ tier }: { tier: QualityTier }) {
  const layout = useLayout();
  const sub = useSubline();
  const reduced = useStore((s) => s.reducedMotion);

  const boardGeo = useMemo(() => {
    const board = new BoxGeometry(PW + 0.1, PH + 0.08, 0.06);
    // Two hangers rising well out of frame (portrait framing pulls back and would expose short ones).
    const hookL = new BoxGeometry(0.012, 3.0, 0.012);
    hookL.translate(-PW * 0.36, (PH + 0.08) / 2 + 1.5, -0.01);
    const hookR = new BoxGeometry(0.012, 3.0, 0.012);
    hookR.translate(PW * 0.36, (PH + 0.08) / 2 + 1.5, -0.01);
    return mergeOrThrow([board, hookL, hookR]);
  }, []);
  const faceGeo = useMemo(() => new PlaneGeometry(PW, PH).translate(0, 0, 0.0305), []);
  const plaqueTex = usePaintedTextures(paintPlaque(sub), TEX_W, TEX_H, COPY.scene.plaque + sub, [sub]);
  const boardMat = useMemo(() => makeWoodMaterial(tier, { dark: '#1a0a06', light: '#3a1a0e', scale: 2.2 }, 'plaque'), [tier]);
  const faceMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: plaqueTex.map,
        roughnessMap: plaqueTex.mask,
        metalnessMap: plaqueTex.mask,
        roughness: 1,
        metalness: 1,
        emissive: new Color('#ffffff'),
        emissiveMap: plaqueTex.map,
        emissiveIntensity: 0.16,
      }),
    [plaqueTex],
  );

  // Couplets + pillars (wide screens).
  const coupletTex = usePaintedTextures(paintCouplets, 512, 1280, COPY.scene.coupletLeft + COPY.scene.coupletRight, []);
  const coupletUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const coupletGeo = useMemo(() => {
    const x = layout.couplet.x;
    const l = remapUv(new PlaneGeometry(CPL_W, CPL_H, 1, 10), 0, 0.5, 0, 1);
    l.translate(-x, 0, 0);
    const r = remapUv(new PlaneGeometry(CPL_W, CPL_H, 1, 10), 0.5, 1, 0, 1);
    r.translate(x, 0, 0);
    return mergeOrThrow([l, r]);
  }, [layout.couplet.x]);
  const coupletMat = useMemo(() => {
    const m = new MeshStandardMaterial({
      map: coupletTex.map,
      roughnessMap: coupletTex.mask,
      metalnessMap: coupletTex.mask,
      roughness: 1,
      metalness: 1,
    });
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, coupletUniforms);
      let vs = addHeader(shader.vertexShader, 'uniform float uTime;');
      vs = injectAfter(
        vs,
        '#include <begin_vertex>',
        /* glsl */ `
        {
          float hang = 1.0 - uv.y;
          float side = sign(position.x);
          transformed.z += hang * hang * (0.012 * sin(uTime * 0.7 + side * 1.7) + 0.004 * sin(uTime * 1.9 + side));
          transformed.x += hang * hang * 0.004 * sin(uTime * 0.5 + side * 2.3);
        }
        `,
      );
      shader.vertexShader = vs;
    };
    m.customProgramCacheKey = () => 'couplet';
    return m;
  }, [coupletTex, coupletUniforms]);
  const pillarGeo = useMemo(() => {
    const x = layout.pillarX;
    const a = new CylinderGeometry(0.11, 0.125, 4.6, 28, 1, true);
    a.translate(-x, 0.6, -1.15);
    const b = new CylinderGeometry(0.11, 0.125, 4.6, 28, 1, true);
    b.translate(x, 0.6, -1.15);
    return mergeOrThrow([a, b]);
  }, [layout.pillarX]);
  const pillarMat = useMemo(() => {
    const common = { color: new Color('#6e0b10'), roughness: 0.32, metalness: 0 };
    const m: MeshStandardMaterial =
      tier === 2 ? new MeshPhysicalMaterial({ ...common, clearcoat: 0.8, clearcoatRoughness: 0.1 }) : new MeshStandardMaterial(common);
    if (tier !== 2) {
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => patchLacquerFresnel(shader, 0.3);
      m.customProgramCacheKey = () => 'pillar-lacquer';
    }
    return m;
  }, [tier]);

  useEffect(
    () => () => {
      boardGeo.dispose();
      faceGeo.dispose();
    },
    [boardGeo, faceGeo],
  );
  useEffect(() => () => coupletGeo.dispose(), [coupletGeo]);
  useEffect(() => () => pillarGeo.dispose(), [pillarGeo]);
  useEffect(() => () => faceMat.dispose(), [faceMat]);
  useEffect(() => () => boardMat.dispose(), [boardMat]);
  useEffect(() => () => coupletMat.dispose(), [coupletMat]);
  useEffect(() => () => pillarMat.dispose(), [pillarMat]);

  useFrame((state) => {
    coupletUniforms.uTime.value = state.clock.elapsedTime * (reduced ? 0.3 : 1);
  });

  const s = layout.plaqueScale;
  return (
    <group>
      <group position={layout.plaque} scale={[s, s, s]} rotation={[0.06, 0, 0]}>
        <mesh ref={noContact} geometry={boardGeo} material={boardMat} />
        <mesh ref={noContact} geometry={faceGeo} material={faceMat} />
      </group>
      {layout.couplet.visible && (
        <>
          <mesh ref={noContact} geometry={pillarGeo} material={pillarMat} />
          <mesh ref={noContact} geometry={coupletGeo} material={coupletMat} position={[0, layout.couplet.y, layout.couplet.z]} />
        </>
      )}
    </group>
  );
}
