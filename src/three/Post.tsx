/**
 * Post-processing, lazy chunk for tiers 1–2. HDR half-float composer; bloom catches the
 * lanterns, embers, gold and the dusk window; tier 2 adds a chromatic-aberration pulse on the pop
 * and, on desktop, a depth-of-field pull during the present beat. ACES tone mapping runs last
 * (the composer switches the renderer to NoToneMapping while mounted).
 *
 * DOF stays mounted on desktop tier 2 with bokehScale 0 outside the present beat: mounting it at
 * that moment would recompile the effect pass exactly when the shot needs to be smoothest.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import {
  BlendFunction,
  ToneMappingMode,
  type BloomEffect,
  type ChromaticAberrationEffect,
  type DepthOfFieldEffect,
  type EffectComposer as EffectComposerImpl,
} from 'postprocessing';
import { HalfFloatType, Vector2 } from 'three';
import type { QualityTier } from '@/types';
import { rt } from '@/state/runtime';
import { useStore } from '@/state/store';

export interface PostProps {
  tier: QualityTier;
  isMobile: boolean;
  /** Called once the composer exists (Stage then warms up shaders for the HDR target). */
  onReady?: () => void;
}

const CA_MAX = 0.004;
const CA_ZERO = new Vector2(0, 0);

export default function Post({ tier, isMobile, onReady }: PostProps) {
  const reduced = useStore((s) => s.reducedMotion);
  const full = tier === 2;
  const withDof = full && !isMobile;
  const composer = useRef<EffectComposerImpl>(null);
  const bloom = useRef<BloomEffect>(null);
  const ca = useRef<ChromaticAberrationEffect>(null);
  const dof = useRef<DepthOfFieldEffect>(null);
  const readySent = useRef(false);
  const bokeh = useRef(0);

  useEffect(() => {
    readySent.current = false;
  }, [tier]);

  useFrame((_, delta) => {
    if (!readySent.current && composer.current) {
      readySent.current = true;
      onReady?.();
    }
    const b = bloom.current;
    if (b) b.intensity = 0.9 + 0.35 * Math.max(0, Math.min(1, rt.fx.presentBloom));
    const c = ca.current;
    if (c) {
      const k = reduced ? 0 : Math.max(0, Math.min(1, rt.fx.caPulse)) * CA_MAX;
      c.offset.set(k, k * 0.6);
    }
    const d = dof.current;
    if (d) {
      const presenting = !reduced && rt.camera.shot === 'present' && rt.hero.mode !== 'off';
      const target = presenting ? 2 : 0;
      bokeh.current += (target - bokeh.current) * Math.min(1, delta * 5);
      if (bokeh.current < 0.01 && target === 0) bokeh.current = 0;
      d.bokehScale = bokeh.current;
      const p = rt.hero.pose.p;
      d.target?.set(p[0], p[1] + 0.25, p[2]);
    }
  });

  return (
    <EffectComposer ref={composer} multisampling={full ? 4 : 0} frameBufferType={HalfFloatType} enableNormalPass={false}>
      {withDof && <DepthOfField ref={dof} target={[0, 0.7, 0.7]} worldFocusRange={0.9} bokehScale={0} resolutionScale={0.5} />}
      <Bloom
        ref={bloom}
        mipmapBlur
        luminanceThreshold={0.8}
        luminanceSmoothing={0.3}
        intensity={0.9}
        radius={0.78}
        resolutionScale={tier === 1 ? 0.5 : 1}
      />
      {full && <ChromaticAberration ref={ca} offset={CA_ZERO} radialModulation={false} modulationOffset={0} />}
      <Vignette offset={0.3} darkness={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* Zero-mean film grain doubles as dither against banding in the dark dusk gradients. */}
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.07} />
    </EffectComposer>
  );
}
