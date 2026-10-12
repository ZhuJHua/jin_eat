/**
 * Scene graph: lighting, the shrine set, the ritual objects, camera rig/director and the effects
 * layer. The main camera also renders NO_CONTACT_LAYER so set pieces that must not darken the
 * contact shadow stay visible.
 */
import { useLayoutEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, FogExp2 } from 'three';
import type { QualityTier } from '@/types';
import { isMobileDevice, tierParams } from '@/lib/quality';
import { Lighting } from './Lighting';
import { Altar } from './env/Altar';
import { Backdrop } from './env/Backdrop';
import { Plaque } from './env/Plaque';
import { Lanterns } from './env/Lanterns';
import { Incense } from './env/Incense';
import { Offerings } from './env/Offerings';
import { NO_CONTACT_LAYER } from './env/layout';
import { Glows } from './fx/Glows';
import { Dust } from './fx/Dust';
import { Confetti } from './fx/Confetti';
import { Flash } from './fx/Flash';
import { Tube } from './tube/Tube';
import { Sticks } from './sticks/Sticks';
import { HeroStick } from './hero/HeroStick';
import { Jiaobei } from './jiaobei/Jiaobei';
import { CameraRig } from './CameraRig';
import { Director } from './Director';

export const SCENE_BACKGROUND = '#12070d';

function Atmosphere() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = new Color(SCENE_BACKGROUND);
    scene.fog = new FogExp2('#1a0b12', 0.05);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  }, [scene]);
  useLayoutEffect(() => {
    camera.layers.enable(NO_CONTACT_LAYER);
  }, [camera]);
  // Cheap guard in case the camera rig swaps or resets the default camera's layers.
  useFrame((state) => {
    state.camera.layers.enable(NO_CONTACT_LAYER);
  });
  return null;
}

export function Scene({ tier }: { tier: QualityTier }) {
  const isMobile = useMemo(isMobileDevice, []);
  const params = tierParams(tier, isMobile);
  return (
    <>
      <Atmosphere />
      <Lighting tier={tier} />
      <Backdrop tier={tier} />
      <Altar tier={tier} />
      <Plaque tier={tier} />
      <Lanterns tier={tier} />
      <Incense tier={tier} />
      <Offerings tier={tier} />
      <Tube tier={tier} />
      <Sticks tier={tier} />
      <HeroStick />
      <Jiaobei />
      <Glows />
      <Dust count={params.dust} />
      <Confetti count={params.confetti} />
      <Flash />
      <CameraRig />
      <Director />
    </>
  );
}
