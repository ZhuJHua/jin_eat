/**
 * Per-frame visual parameters of the hero stick, written by the Director and read by HeroStick.
 * (Kept out of `rt` because they are purely presentational.)
 */
export const heroVisual = {
  /** Uniform scale (reduced-motion fade-in grows 0.55 → 1). */
  scale: 1,
  /** Opacity 0..1. */
  opacity: 1,
  /** Multiplier on the gold engraving's emissive intensity. */
  glow: 0,
  /** Opacity of the soft halo behind the stick (present / reveal). */
  halo: 0,
};
