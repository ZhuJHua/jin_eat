/**
 * Incense smoke / tea steam ribbons. Each ribbon is a 1×N strip whose centre line
 * meanders upward and bends with `uBend` (tube motion); it is cylindrically billboarded toward the
 * camera in the vertex shader. The fragment shader scrolls a domain-warped fbm upward with soft
 * edges and outputs premultiplied alpha (NormalBlending + premultipliedAlpha).
 * Up to 4 ribbons share one draw call; per-ribbon data lives in uniform arrays.
 */
import { NOISE_GLSL } from './noise';

export const MAX_RIBBONS = 4;

export const SMOKE_VERT = /* glsl */ `
attribute float aRibbon;
uniform vec3 uOrigin[${MAX_RIBBONS}];
uniform vec4 uShape[${MAX_RIBBONS}];   // height, width, alpha, seed
uniform float uTime;
uniform float uSpeed;
uniform vec2 uBend;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vT;
void main() {
  int k = int(aRibbon + 0.5);
  vec3 o = uOrigin[k];
  vec4 s = uShape[k];
  float h = uv.y;
  float t = uTime * uSpeed + s.w * 17.0;
  float meander = sin(h * 4.6 - t * 1.1 + s.w * 6.28) * 0.6 + sin(h * 10.3 - t * 1.9 + s.w * 3.1) * 0.25;
  float sway = meander * h * h * 0.09 * s.x;
  vec2 bend = uBend * h * h * s.x;
  float width = s.y * mix(0.12, 1.0, smoothstep(0.0, 0.75, h));
  vec3 c = o + vec3(sway + bend.x, h * s.x, bend.y * 0.6 + meander * h * 0.03);
  vec3 toCam = cameraPosition - c;
  toCam.y = 0.0;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  vec3 pos = c + right * (uv.x - 0.5) * width;
  vUv = uv;
  vAlpha = s.z;
  vSeed = s.w;
  vT = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

export const SMOKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vT;
uniform vec3 uColor;
${NOISE_GLSL}
void main() {
  float x = vUv.x - 0.5;
  float h = vUv.y;
  float t = vT;
  vec2 w0 = vec2(x * 2.6 + vSeed * 9.0, h * 3.4 - t * 0.55);
  float warp = jFbm2(w0);
  float d = jFbm2(vec2(x * 3.6 + warp * 1.6, h * 5.2 - t * 0.95 + warp * 1.2));
  float cx = x + (warp - 0.5) * 0.35 * h;
  float edge = 1.0 - smoothstep(0.08, 0.48, abs(cx));
  float density = smoothstep(0.38, 0.78, d) * edge;
  // Thin rising thread near the source.
  float thread = (1.0 - smoothstep(0.0, 0.05 + h * 0.2, abs(cx))) * (1.0 - smoothstep(0.0, 0.32, h));
  float fadeIn = smoothstep(0.0, 0.05, h);
  float fadeOut = 1.0 - smoothstep(0.45, 1.0, h);
  float a = max(density * 0.9, thread * 0.75) * fadeIn * fadeOut * vAlpha;
  vec3 col = uColor * (0.85 + 0.3 * d);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
