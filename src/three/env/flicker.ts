/**
 * Shared, allocation-free candle/lantern flicker so the emissive paper, the point lights, the
 * glow sprites and the wall spill all breathe together. Returns roughly −1..1.
 */
export function lanternFlicker(t: number, seed: number): number {
  const s = seed * 7.13;
  return (
    0.5 * Math.sin(t * 0.8 * 2.1 + s) +
    0.3 * Math.sin(t * 0.8 * 5.3 + s * 1.7) +
    0.2 * Math.sin(t * 0.8 * 11.9 + s * 2.3 + Math.sin(t * 1.3 + s))
  );
}

/** Faster, twitchier flicker for incense embers. */
export function emberFlicker(t: number, seed: number): number {
  const s = seed * 3.71;
  return 0.6 * Math.sin(t * 7.1 + s) * Math.sin(t * 2.3 + s * 2.0) + 0.4 * Math.sin(t * 17.3 + s * 5.0);
}
