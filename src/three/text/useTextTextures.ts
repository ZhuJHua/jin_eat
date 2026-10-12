/**
 * React hook: a pair of canvas textures (sRGB colour + linear mask) painted by one function,
 * repainted once the brush font slices for `text` have loaded, and disposed on unmount.
 */
import { useEffect, useMemo } from 'react';
import type { CanvasTexture } from 'three';
import { fontsReady, makeMaskTexture, makeTextTexture, redrawTexture } from './canvasText';

export type PaintMode = 'color' | 'mask';
export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, mode: PaintMode) => void;

export interface PaintedTextures {
  map: CanvasTexture;
  /** Linear data: R = emissive/glow, G = roughness, B = metalness (three's channel conventions). */
  mask: CanvasTexture;
}

export function usePaintedTextures(paint: Painter, w: number, h: number, text: string, deps: readonly unknown[]): PaintedTextures {
  const textures = useMemo<PaintedTextures>(
    () => ({
      map: makeTextTexture((ctx, cw, ch) => paint(ctx, cw, ch, 'color'), w, h),
      mask: makeMaskTexture((ctx, cw, ch) => paint(ctx, cw, ch, 'mask'), w, h),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the deps that change the painting; `paint` is usually an inline closure
    [w, h, ...deps],
  );

  useEffect(() => {
    let alive = true;
    void fontsReady(text).then(() => {
      if (!alive) return;
      redrawTexture(textures.map, (ctx, cw, ch) => paint(ctx, cw, ch, 'color'));
      redrawTexture(textures.mask, (ctx, cw, ch) => paint(ctx, cw, ch, 'mask'));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `paint` is an inline closure; textures/text identify what needs repainting
  }, [textures, text]);

  useEffect(
    () => () => {
      textures.map.dispose();
      textures.mask.dispose();
    },
    [textures],
  );

  return textures;
}
