/**
 * Backdrop wall: dusk gradient wall with faint 窗棂 lattice panels, a round moon
 * window (月洞窗) framing a dusk sky with layered mountains, warm spill around the window and the
 * lanterns. World-space so it composes with the responsive layout. Outputs HDR (bloom catches the
 * horizon and the setting sun).
 */
import { NOISE_GLSL } from './noise';

export const BACKDROP_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const BACKDROP_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uTime;
uniform vec3 uWin;          // x, y, radius
uniform vec3 uLamp0;
uniform vec3 uLamp1;
uniform float uLampGlow;
uniform vec3 uTop;
uniform vec3 uLow;
uniform float uDetail;      // 0 on tier 0 (fewer octaves / no clouds)
${NOISE_GLSL}

vec3 sky(vec2 q, float t) {
  // q in [-1, 1] inside the window.
  float h = q.y * 0.5 + 0.5;
  vec3 c = mix(vec3(1.0, 0.52, 0.2) * 2.1, vec3(1.0, 0.42, 0.36) * 1.3, smoothstep(0.25, 0.55, h));
  c = mix(c, vec3(0.62, 0.3, 0.52) * 0.95, smoothstep(0.5, 0.78, h));
  c = mix(c, vec3(0.2, 0.17, 0.4) * 0.85, smoothstep(0.75, 1.0, h));
  // Setting sun with halo, low on the left so it peeks beside the sticks.
  vec2 sp = vec2(-0.46, -0.06);
  float sd = length((q - sp) * vec2(1.0, 1.1));
  c += vec3(1.0, 0.8, 0.5) * (exp(-sd * sd * 160.0) * 3.0 + exp(-sd * 3.0) * 0.7);
  // Thin drifting clouds lit from below.
  if (uDetail > 0.5) {
    float cl = jFbm2(vec2(q.x * 1.6 + t * 0.012, q.y * 7.0));
    float band = smoothstep(0.55, 0.78, cl) * smoothstep(-0.1, 0.25, q.y) * (1.0 - smoothstep(0.55, 0.85, q.y));
    c = mix(c, vec3(1.0, 0.62, 0.48) * 1.1, band * 0.45);
  }
  // Far ridge (hazy) and near ridge (dark).
  float r1 = -0.3 + 0.14 * jFbm2(vec2(q.x * 1.7 + 3.0, 0.5)) + 0.05 * sin(q.x * 3.0);
  float r2 = -0.58 + 0.2 * jFbm2(vec2(q.x * 1.2 - 7.0, 2.5)) + 0.08 * cos(q.x * 2.1 + 1.0);
  float aa = 0.012;
  float m1 = 1.0 - smoothstep(r1 - aa, r1 + aa, q.y);
  float m2 = 1.0 - smoothstep(r2 - aa, r2 + aa, q.y);
  vec3 far = mix(vec3(0.5, 0.22, 0.32), vec3(0.78, 0.36, 0.38), smoothstep(r1 - 0.3, r1, q.y));
  c = mix(c, far, m1 * 0.85);
  c = mix(c, vec3(0.1, 0.05, 0.11), m2);
  return c;
}

void main() {
  vec2 p = vWorld.xy;
  float t = uTime;

  // ── wall ──
  float hy = smoothstep(-0.4, 3.8, p.y);
  vec3 wall = mix(uLow, uTop, pow(hy, 0.75));
  float side = smoothstep(1.2, 5.2, abs(p.x));
  wall *= mix(1.0, 0.42, side);
  // Vertical boards with seams and grain.
  float bw = 0.46;
  float bx = abs(fract(p.x / bw) - 0.5) * bw;
  float seam = smoothstep(0.0, 0.01, bx);
  float grain = jNoise2(vec2(p.x * 9.0, p.y * 0.7));
  wall *= (0.72 + 0.28 * seam) * (0.86 + 0.24 * grain);
  if (uDetail > 0.5) wall *= 0.85 + 0.3 * jFbm2(p * vec2(0.9, 0.45));
  // Faint 窗棂 lattice panels flanking the window (≈6 % alpha).
  vec2 lp = vec2(abs(p.x) - 1.75, p.y - 1.05);
  float panel = step(abs(lp.x), 0.55) * step(abs(lp.y), 0.95);
  vec2 lg = abs(fract(lp * vec2(5.5, 5.5)) - 0.5);
  float lat = 1.0 - smoothstep(0.38, 0.45, max(lg.x, lg.y));
  wall = mix(wall, wall * 1.9 + vec3(0.05, 0.02, 0.01), lat * panel * 0.06);

  // Warm spill around the window and the lanterns.
  vec2 wq = p - uWin.xy;
  float dw = length(wq);
  float outside = max(dw - uWin.z, 0.0);
  wall += vec3(1.0, 0.42, 0.18) * exp(-outside * 2.4) * 0.16;
  vec3 lampC = vec3(1.0, 0.35, 0.1) * uLampGlow;
  wall += lampC * exp(-length(p - uLamp0.xy) * 1.7) * 0.32;
  wall += lampC * exp(-length(p - uLamp1.xy) * 1.7) * 0.32;

  vec3 col = wall;

  // ── moon window ──
  float r = uWin.z;
  float fw = fwidth(dw) * 1.5;
  if (dw < r + 0.12) {
    vec2 q = wq / r;
    vec3 s = sky(q, t);
    // 菱花 lattice: diagonal grid with a round central medallion.
    mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
    vec2 g = rot * q * 3.0;
    vec2 f = abs(fract(g) - 0.5);
    float edge = 0.5 - max(f.x, f.y);
    float gw = fwidth(edge) + 1e-4;
    float lq = length(q);
    float diamond = (1.0 - smoothstep(0.03, 0.03 + gw * 1.5, edge)) * step(0.4, lq);
    float ring = abs(lq - 0.36);
    float ringL = 1.0 - smoothstep(0.022, 0.022 + fwidth(ring) * 1.5, ring);
    float crs = min(abs(q.x), abs(q.y));
    float crossL = (1.0 - smoothstep(0.018, 0.018 + fwidth(crs) * 1.5, crs)) * step(lq, 0.36);
    float latt = max(max(diamond, ringL), crossL);
    vec3 wood = vec3(0.075, 0.03, 0.022);
    // Lattice edges catch the sky light.
    vec3 latCol = wood + s * 0.06;
    vec3 inner = mix(s, latCol, latt);
    float inside = 1.0 - smoothstep(r - fw, r, dw);
    col = mix(col, inner, inside);
    // Frame: dark wood ring with a gilded bead on the inner edge.
    float fr = smoothstep(r - fw, r, dw) * (1.0 - smoothstep(r + 0.1 - fw, r + 0.1, dw));
    vec3 frameCol = vec3(0.09, 0.035, 0.025) * (0.8 + 0.4 * jNoise2(vec2(atan(wq.y, wq.x) * 30.0, dw * 40.0)));
    float bead = smoothstep(r, r + fw, dw) * (1.0 - smoothstep(r + 0.016, r + 0.016 + fw, dw));
    frameCol = mix(frameCol, vec3(1.0, 0.7, 0.32) * 0.9, bead);
    // Top-lit frame: brighter where the window light grazes it.
    frameCol *= 0.8 + 0.5 * smoothstep(-1.0, 1.0, -wq.y / max(dw, 1e-3));
    col = mix(col, frameCol, fr);
  }

  // Floor line darkening (keeps the wall from glowing below the altar).
  col *= mix(0.25, 1.0, smoothstep(-1.2, 0.2, p.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const FLOOR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform vec3 uColor;
${NOISE_GLSL}
void main() {
  float d = length(vWorld.xz * vec2(0.55, 0.8));
  float n = jNoise2(vWorld.xz * 3.0) * 0.5 + jNoise2(vWorld.xz * 11.0) * 0.25;
  vec2 tile = abs(fract(vWorld.xz * 1.25) - 0.5);
  float grout = smoothstep(0.47, 0.49, max(tile.x, tile.y));
  vec3 c = uColor * (0.75 + 0.5 * n) * (1.0 - grout * 0.45);
  c *= exp(-d * 0.55);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
