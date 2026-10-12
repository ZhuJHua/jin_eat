/**
 * Ballistic confetti as an onBeforeCompile patch for MeshStandardMaterial on an
 * InstancedMesh whose instance matrices stay identity. Motion lives entirely in the vertex shader:
 *   p = origin + R_yaw·v·(1 − e^(−k t))/k + ½ g t²,   clamped to rest on the altar top,
 * with spin about `aAxis` that decays as the piece settles. The merged geometry contains three
 * shapes (rice grain, chili flake, red envelope); `aShapeId` (per vertex) is compared with `aShape`
 * (per instance) to collapse the shapes an instance does not use.
 */
import { Color, type WebGLProgramParametersWithUniforms } from 'three';
import { addHeader, injectAfter } from './noise';

export interface ConfettiUniforms {
  uTime: { value: number };
  uLife: { value: number };
  uOrigin: { value: [number, number, number] };
  uYaw: { value: number };
  uGravity: { value: number };
  uDrag: { value: number };
  uFloorY: { value: number };
}

export function createConfettiUniforms(): ConfettiUniforms {
  return {
    uTime: { value: -1 },
    uLife: { value: 2.2 },
    uOrigin: { value: [0, 0.8, 0.6] },
    uYaw: { value: 0 },
    uGravity: { value: -4.2 },
    uDrag: { value: 0.6 },
    uFloorY: { value: 0.004 },
  };
}

export function patchConfetti(shader: WebGLProgramParametersWithUniforms, u: ConfettiUniforms): void {
  Object.assign(shader.uniforms, u, { uGold: { value: new Color('#f2c14e') } });

  let vs = addHeader(
    shader.vertexShader,
    /* glsl */ `
attribute float aShapeId;
attribute float aShape;
attribute vec3 aVel;
attribute vec3 aAxis;
attribute vec2 aSpinDelay;   // spin (rad/s), delay (s)
uniform float uTime;
uniform float uLife;
uniform vec3 uOrigin;
uniform float uYaw;
uniform float uGravity;
uniform float uDrag;
uniform float uFloorY;
varying vec3 vConfLocal;
varying float vConfShape;
mat3 jAxisAngle(vec3 a, float ang) {
  float s = sin(ang);
  float c = cos(ang);
  float oc = 1.0 - c;
  return mat3(
    oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
    oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
    oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
}
`,
  );
  vs = injectAfter(
    vs,
    '#include <beginnormal_vertex>',
    /* glsl */ `
  float jT = uTime - aSpinDelay.y;
  float jSpinT = (1.0 - exp(-1.1 * max(jT, 0.0))) / 1.1;
  mat3 jRot = jAxisAngle(normalize(aAxis), aSpinDelay.x * jSpinT);
  objectNormal = jRot * objectNormal;
`,
  );
  vs = injectAfter(
    vs,
    '#include <begin_vertex>',
    /* glsl */ `
  {
    vConfLocal = position;
    vConfShape = aShape;
    float alive = step(0.0, jT) * step(jT, uLife);
    float sel = 1.0 - step(0.5, abs(aShapeId - aShape));
    float shrink = 1.0 - smoothstep(uLife - 0.45, uLife, jT);
    float grow = smoothstep(0.0, 0.06, jT);
    transformed = jRot * transformed * (alive * sel * shrink * grow);
    float cy = cos(uYaw);
    float sy = sin(uYaw);
    vec3 v = vec3(cy * aVel.x + sy * aVel.z, aVel.y, -sy * aVel.x + cy * aVel.z);
    float tt = max(jT, 0.0);
    vec3 p = uOrigin + v * (1.0 - exp(-uDrag * tt)) / uDrag + vec3(0.0, 0.5 * uGravity * tt * tt, 0.0);
    p.y = max(p.y, uFloorY);
    transformed += p;
  }
`,
  );
  shader.vertexShader = vs;

  let fs = addHeader(
    shader.fragmentShader,
    /* glsl */ `
uniform vec3 uGold;
varying vec3 vConfLocal;
varying float vConfShape;
`,
  );
  fs = injectAfter(
    fs,
    '#include <color_fragment>',
    /* glsl */ `
  if (vConfShape > 1.5) {
    float stripe = 1.0 - step(0.0035, abs(vConfLocal.y - 0.006));
    float seal = 1.0 - step(0.0045, length(vConfLocal.xy - vec2(0.0, -0.006)));
    diffuseColor.rgb = mix(diffuseColor.rgb, uGold, max(stripe, seal));
  }
`,
  );
  shader.fragmentShader = fs;
}
