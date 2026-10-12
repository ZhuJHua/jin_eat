/**
 * Shared GLSL noise (value noise + fbm). All symbols are prefixed `j` so they never collide with
 * three.js shader chunks. Cheap enough for mobile fragment shaders at 2–3 octaves.
 */

export const NOISE_GLSL = /* glsl */ `
float jHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float jHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float jNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = jHash12(i);
  float b = jHash12(i + vec2(1.0, 0.0));
  float c = jHash12(i + vec2(0.0, 1.0));
  float d = jHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float jNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = jHash13(i);
  float n100 = jHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = jHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = jHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = jHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = jHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = jHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = jHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
float jFbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    s += a * jNoise2(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.875;
}
float jFbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * jNoise3(p);
    p = p * 2.07 + vec3(11.3, 5.7, 3.1);
    a *= 0.5;
  }
  return s / 0.875;
}
`;

/** Insert `code` right after the first occurrence of `anchor` (warns in dev and returns `src` unchanged if missing). */
export function injectAfter(src: string, anchor: string, code: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) {
    if (import.meta.env.DEV) console.warn(`[shader] anchor not found: ${anchor}`);
    return src;
  }
  return src.slice(0, i + anchor.length) + '\n' + code + '\n' + src.slice(i + anchor.length);
}

/** Insert `code` right before the first occurrence of `anchor`. */
export function injectBefore(src: string, anchor: string, code: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) {
    if (import.meta.env.DEV) console.warn(`[shader] anchor not found: ${anchor}`);
    return src;
  }
  return src.slice(0, i) + code + '\n' + src.slice(i);
}

/** Prepend declarations after `#include <common>` (present in every built-in material). */
export function addHeader(src: string, code: string): string {
  return injectAfter(src, '#include <common>', code);
}
