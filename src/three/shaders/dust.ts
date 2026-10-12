/**
 * Gold dust and soft glow sprites. Dust drift is analytic in the vertex shader (no
 * CPU work per particle): slow rise with wrap, curl-ish sway and twinkle. `uBurst` (0→1→0) pushes
 * particles radially from `uBurstOrigin`; burst-only sparks (aSeed.w < 0) fly out and fade.
 * Additive, size-attenuated points. `uScale` = drawing-buffer height / (2·tan(fov/2)).
 */

export const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;          // xyz ∈ [0,1]³, w = random ∈ [0,1) (negative → burst spark)
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform float uBurst;          // displacement envelope 0→1→0
uniform float uGlow;           // burst brightness (decays 1→0)
uniform float uPhase;          // burst progress 0→1
uniform vec3 uBurstOrigin;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uMotion;         // 1 normal, 0.3 reduced motion
varying float vAlpha;
varying float vHot;
void main() {
  float r = abs(aSeed.w);
  vec3 p;
  float alpha;
  float hot = 0.0;
  if (aSeed.w >= 0.0) {
    float t = uTime * uMotion;
    float rise = fract(aSeed.y + t * (0.01 + r * 0.018));
    p = uBoxMin + vec3(aSeed.x, rise, aSeed.z) * uBoxSize;
    p.x += sin(t * 0.21 + r * 40.0 + p.y * 1.7) * 0.16 + sin(t * 0.57 + r * 13.0) * 0.04;
    p.z += cos(t * 0.17 + r * 23.0 + p.x * 1.3) * 0.12;
    p.y += sin(t * 0.33 + r * 31.0) * 0.035;
    vec3 d = p - uBurstOrigin;
    float dl = length(d) + 1e-3;
    float fall = exp(-dl * 1.3);
    p += (d / dl) * uBurst * fall * 0.85;
    hot = uGlow * fall;
    float tw = 0.45 + 0.55 * sin(uTime * (1.3 + r * 2.7) + r * 60.0);
    alpha = tw * smoothstep(0.0, 0.12, rise) * (1.0 - smoothstep(0.82, 1.0, rise));
  } else {
    // Burst spark: shell expansion with a little gravity, only while the burst glows.
    vec3 dir = normalize(aSeed.xyz * 2.0 - 1.0 + vec3(0.0, 0.35, 0.25));
    float e = 1.0 - pow(max(1.0 - uPhase, 0.0), 3.0);
    p = uBurstOrigin + dir * e * (0.35 + r * 0.75) + vec3(0.0, -0.35 * uPhase * uPhase, 0.0);
    alpha = uGlow * step(0.0001, uGlow) * (0.6 + 0.4 * sin(uTime * 23.0 + r * 50.0));
    hot = 1.0;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSeed.w >= 0.0 ? uSize * (0.45 + r) * (1.0 + hot * 1.2) : uSize * (0.35 + r * 0.5);
  gl_PointSize = alpha > 0.001 ? size * uScale / max(-mv.z, 0.05) : 0.0;
  vAlpha = alpha;
  vHot = hot;
}
`;

export const DUST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uHotColor;
uniform float uIntensity;
varying float vAlpha;
varying float vHot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c);
  float core = exp(-d2 * 70.0);
  float halo = exp(-d2 * 14.0) * 0.35;
  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uHotColor, clamp(vHot, 0.0, 1.0)) * uIntensity * (1.0 + vHot * 0.8);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Soft additive glow sprites (lantern halos, incense embers): per-point colour (HDR) and size. */
export const GLOW_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uScale;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  vColor = aColor;
}
`;

export const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.75, 1.0, d));
  a += exp(-d * d * 40.0) * 0.6;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
