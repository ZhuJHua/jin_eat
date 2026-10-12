/**
 * Cheap "clearcoat" for tiers 0–1: a Fresnel-weighted, low-roughness environment reflection added
 * on top of MeshStandardMaterial. When no environment map is bound it falls back to a warm Fresnel
 * rim colour. Uniforms are prefixed `uLq`.
 */
import { Color, type WebGLProgramParametersWithUniforms } from 'three';
import { addHeader, injectBefore } from './noise';

export interface LacquerOptions {
  /** Fresnel exponent (default 4). */
  power?: number;
  /** Rim colour used when the material has no env map. */
  color?: string;
  /** Roughness of the fake clear coat reflection (default 0.06). */
  coatRoughness?: number;
}

export function patchLacquerFresnel(shader: WebGLProgramParametersWithUniforms, strength: number, opts: LacquerOptions = {}): void {
  shader.uniforms.uLqStrength = { value: strength };
  shader.uniforms.uLqPower = { value: opts.power ?? 4 };
  shader.uniforms.uLqColor = { value: new Color(opts.color ?? '#ffd2a8') };
  shader.uniforms.uLqRough = { value: opts.coatRoughness ?? 0.06 };

  let fs = addHeader(
    shader.fragmentShader,
    /* glsl */ `
uniform float uLqStrength;
uniform float uLqPower;
uniform vec3 uLqColor;
uniform float uLqRough;
`,
  );
  fs = injectBefore(
    fs,
    '#include <opaque_fragment>',
    /* glsl */ `
  {
    float jNv = saturate(dot(geometryNormal, geometryViewDir));
    float jFres = 0.04 + 0.96 * pow(1.0 - jNv, uLqPower);
    #ifdef USE_ENVMAP
      vec3 jCoat = getIBLRadiance(geometryViewDir, geometryNormal, uLqRough);
      outgoingLight += jCoat * jFres * uLqStrength * 2.5;
    #else
      outgoingLight += uLqColor * jFres * uLqStrength;
    #endif
  }
`,
  );
  shader.fragmentShader = fs;
}
