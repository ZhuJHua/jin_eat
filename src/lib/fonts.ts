/**
 * The brush font's @font-face CSS (~50 KB gzip of unicode-range slices) is loaded as a separate,
 * non-render-blocking chunk. Canvas painters must await it before `document.fonts.load`, otherwise
 * the load resolves at once with no matching face and they would paint the fallback for good.
 */
let css: Promise<void> | null = null;

/** Idempotent; never rejects. */
export function loadBrushFontCss(): Promise<void> {
  if (!css) {
    css = import('@fontsource/ma-shan-zheng/400.css').then(
      () => undefined,
      (err: unknown) => console.warn('[font] brush font CSS failed', err),
    );
  }
  return css;
}
