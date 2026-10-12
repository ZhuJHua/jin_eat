/**
 * Procedural dark lacquered wood for MeshStandardMaterial / MeshPhysicalMaterial (onBeforeCompile).
 * Grain is computed in object space: 3-octave fbm stretched 1:12 along X, ring figure, fine
 * fibres and pores, with roughness 0.35 ± 0.1 from the same noise. An optional emissive gold
 * inlay band runs along the front (+Z) face.
 */
import { Color, type WebGLProgramParametersWithUniforms } from 'three';
import { addHeader, injectAfter, NOISE_GLSL } from './noise';

export interface WoodOptions {
  dark?: string;
  light?: string;
  /** Grain frequency multiplier (object units). */
  scale?: number;
  /** Base roughness (± 0.1 from noise). */
  roughness?: number;
  /** Gold inlay band on the +Z face between these object-space Y values. */
  inlay?: { y0: number; y1: number; color?: string; intensity?: number } | null;
  /** Darken toward object-space Y below this value (cabinet shadowing). */
  shadeBelow?: number | null;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vWoodPos;
varying vec3 vWoodNrm;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vWoodPos;
varying vec3 vWoodNrm;
uniform vec3 uWoodDark;
uniform vec3 uWoodLight;
uniform float uWoodScale;
uniform float uWoodRough;
uniform vec2 uInlayY;
uniform vec3 uInlayColor;
uniform float uInlayIntensity;
uniform float uShadeBelow;
${NOISE_GLSL}
float jWoodGrain(vec3 p, out float fibre) {
  vec3 q = p * uWoodScale;
  float w = jFbm3(vec3(q.x * 0.55, q.y * 6.6, q.z * 6.6));
  float figure = fract(w * 5.0 + jNoise3(vec3(q.x * 0.9, q.y * 9.0, q.z * 9.0)) * 0.35);
  float ring = smoothstep(0.0, 0.18, figure) * smoothstep(1.0, 0.62, figure);
  fibre = jNoise3(vec3(q.x * 2.2, q.y * 90.0, q.z * 90.0));
  float pore = smoothstep(0.78, 0.95, jNoise3(vec3(q.x * 9.0, q.y * 140.0, q.z * 140.0)));
  return clamp(0.5 * ring + 0.35 * w + 0.2 * fibre - 0.25 * pore, 0.0, 1.0);
}
`;

export function patchWood(shader: WebGLProgramParametersWithUniforms, opts: WoodOptions = {}): void {
  const inlay = opts.inlay ?? null;
  shader.uniforms.uWoodDark = { value: new Color(opts.dark ?? '#2a120b') };
  shader.uniforms.uWoodLight = { value: new Color(opts.light ?? '#4a2214') };
  shader.uniforms.uWoodScale = { value: opts.scale ?? 1 };
  shader.uniforms.uWoodRough = { value: opts.roughness ?? 0.35 };
  shader.uniforms.uInlayY = { value: inlay ? [inlay.y0, inlay.y1] : [1e5, 1e5] };
  shader.uniforms.uInlayColor = { value: new Color(inlay?.color ?? '#e8b64c') };
  shader.uniforms.uInlayIntensity = { value: inlay?.intensity ?? 0.6 };
  shader.uniforms.uShadeBelow = { value: opts.shadeBelow ?? -1e5 };

  let vs = addHeader(shader.vertexShader, VERT_HEAD);
  vs = injectAfter(vs, '#include <begin_vertex>', 'vWoodPos = transformed; vWoodNrm = objectNormal;');
  shader.vertexShader = vs;

  let fs = addHeader(shader.fragmentShader, FRAG_HEAD);
  fs = injectAfter(
    fs,
    '#include <color_fragment>',
    /* glsl */ `
    float jFibre;
    float jGrain = jWoodGrain(vWoodPos, jFibre);
    vec3 jWood = mix(uWoodDark, uWoodLight, jGrain);
    float jShade = smoothstep(uShadeBelow - 0.9, uShadeBelow, vWoodPos.y);
    jWood *= mix(0.45, 1.0, jShade);
    float jFront = step(0.5, vWoodNrm.z);
    float jBand = jFront * step(uInlayY.x, vWoodPos.y) * step(vWoodPos.y, uInlayY.y);
    diffuseColor.rgb *= mix(jWood, uInlayColor, jBand);
    `,
  );
  fs = injectAfter(
    fs,
    '#include <roughnessmap_fragment>',
    'roughnessFactor = mix(clamp(uWoodRough + (jFibre - 0.5) * 0.2 + (0.5 - jGrain) * 0.08, 0.12, 0.9), 0.28, jBand);',
  );
  fs = injectAfter(fs, '#include <metalnessmap_fragment>', 'metalnessFactor = mix(metalnessFactor, 1.0, jBand);');
  fs = injectAfter(fs, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += uInlayColor * uInlayIntensity * jBand;');
  shader.fragmentShader = fs;
}
