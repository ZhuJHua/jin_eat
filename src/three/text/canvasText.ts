/**
 * Canvas text helpers for procedural textures. Brush text uses the bundled Ma Shan Zheng
 * (fontsource unicode-range slices) with a Kaiti/serif fallback.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, NoColorSpace } from 'three';
import { loadBrushFontCss } from '@/lib/fonts';

export const BRUSH_FONT = '"Ma Shan Zheng", "STKaiti", "KaiTi", "Kaiti SC", serif';

const loaded = new Map<string, Promise<void>>();

/**
 * Resolves once the brush-font slices covering `text` are loaded (or after `timeoutMs`).
 * Never rejects. Safe outside the browser.
 */
export function fontsReady(text: string, timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  const chars = Array.from(new Set(Array.from(text)))
    .sort()
    .join('');
  const key = chars || ' ';
  const existing = loaded.get(key);
  if (existing) return existing;
  const p = new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    loadBrushFontCss()
      .then(() => document.fonts.load(`48px "Ma Shan Zheng"`, key))
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        finish();
      });
  });
  loaded.set(key, p);
  return p;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draws into a fresh canvas and wraps it as an sRGB CanvasTexture (mipmapped, anisotropic).
 * Call `redrawTexture(tex, draw)` to repaint later (e.g. after fonts load).
 */
export function makeTextTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): CanvasTexture {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Same as makeTextTexture but for data (roughness/metalness/emissive masks): no colour space. */
export function makeMaskTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): CanvasTexture {
  const tex = makeTextTexture(draw, w, h);
  tex.colorSpace = NoColorSpace;
  return tex;
}

/** Clear and repaint a texture made by makeTextTexture / makeMaskTexture. */
export function redrawTexture(tex: CanvasTexture, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const canvas = tex.image as HTMLCanvasElement | undefined;
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  draw(ctx, canvas.width, canvas.height);
  tex.needsUpdate = true;
}

/** A warm metallic gold gradient across [y0, y1]. */
export function goldGradient(ctx: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff1b8');
  g.addColorStop(0.35, '#f2c65a');
  g.addColorStop(0.6, '#c98f2a');
  g.addColorStop(1, '#f7d77c');
  return g;
}
