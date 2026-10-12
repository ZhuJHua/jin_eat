/**
 * Brush-font helpers for the stick textures. `@fontsource/ma-shan-zheng` ships unicode-range
 * slices, so `document.fonts.load(font, text)` fetches exactly the slices covering the names.
 */
import { loadBrushFontCss } from '@/lib/fonts';

export const BRUSH_FAMILY = '"Ma Shan Zheng", "STKaiti", "KaiTi", "Kaiti SC", serif';
const PROBE = '48px "Ma Shan Zheng"';

/** CSS font shorthand for the brush family at `px` pixels. */
export function brushFont(px: number): string {
  return `${Math.max(1, Math.round(px))}px ${BRUSH_FAMILY}`;
}

/** Whether Ma Shan Zheng glyphs for `text` are already usable. */
export function brushReady(text: string): boolean {
  try {
    return typeof document !== 'undefined' && !!document.fonts && document.fonts.check(PROBE, text || '锦');
  } catch {
    return false;
  }
}

/**
 * Resolve once the brush font covering `text` is loaded, or after `timeoutMs` (the textures then
 * repaint with the serif fallback). Resolves `true` when the brush font is actually available.
 */
export function fontsReady(text: string, timeoutMs = 3000): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve(false);
  if (brushReady(text)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(brushReady(text));
    };
    const timer = setTimeout(finish, timeoutMs);
    void loadBrushFontCss()
      .then(() => document.fonts.load(PROBE, text || '锦'))
      .then(finish, finish);
  });
}
