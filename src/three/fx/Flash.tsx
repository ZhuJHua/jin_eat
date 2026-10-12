/**
 * Full-screen colour tint driven by `rt.fx.flash` (veto 「锦少动用了特权」, decayed by the Director).
 * A cinnabar vignette rather than a white strobe; under reduced motion it is a soft, capped tint.
 * Works on every tier (no composer needed); hidden when idle so it costs nothing.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial } from 'three';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';
import { noContact } from '../env/layout';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAmount;
void main() {
  vec2 c = vUv - 0.5;
  float vig = smoothstep(0.15, 0.75, length(c * vec2(1.2, 1.0)));
  float a = uAmount * (0.35 + 0.65 * vig);
  gl_FragColor = vec4(uColor * a, a);
}
`;

export function Flash() {
  const reduced = useStore((s) => s.reducedMotion);
  const mesh = useMemo(() => {
    const g = new BufferGeometry();
    // One oversized triangle covering clip space.
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new Color('#c4121c') }, uAmount: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
      toneMapped: false,
    });
    const me = new Mesh(g, m);
    me.frustumCulled = false;
    me.renderOrder = 1000;
    me.visible = false;
    noContact(me);
    return me;
  }, []);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );

  useFrame(() => {
    const f = Math.max(0, Math.min(1, rt.fx.flash));
    mesh.visible = f > 0.002;
    if (!mesh.visible) return;
    const amount = reduced ? Math.min(0.22, f * 0.3) : Math.pow(f, 1.3) * 0.55;
    (mesh.material as ShaderMaterial).uniforms.uAmount!.value = amount;
  });

  return <primitive object={mesh} />;
}
