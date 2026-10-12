/**
 * The chosen 签 (the "hero"). A separate mesh that follows `rt.hero.pose` whenever
 * `rt.hero.mode !== 'off'`. Its texture is rebuilt for every new draw: the name and
 * 「第七签 · 上上签」 are carved and back-lit with a gold emissive mask (bloom picks it up).
 * A soft additive halo sits behind it while it is presented.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CanvasTexture, type Mesh, MeshStandardMaterial, SRGBColorSpace, type Sprite, SpriteMaterial } from 'three';
import type { DrawResult } from '@/types';
import { LEVELS } from '@/data/fortunes';
import { useStore } from '@/state/store';
import { rt } from '@/state/runtime';
import { drawHeroTexture } from '@/three/sticks/stickAtlas';
import { sharedStickGeometry } from '@/three/sticks/stickGeometry';
import { fontsReady } from '@/three/sticks/fonts';
import { toChineseNumeral } from '@/lib/date';
import { heroVisual } from './heroVisual';

const BASE_EMISSIVE = 1.4;

function levelLabelFor(d: DrawResult): string {
  if (d.treat) return '锦少请客';
  return `${LEVELS[d.level].short}签`;
}

function haloTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.translate(64, 128);
    ctx.scale(1, 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,214,140,0.85)');
    g.addColorStop(0.35, 'rgba(255,170,70,0.35)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-64, -64, 128, 128);
    ctx.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function HeroStick(): React.JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const haloRef = useRef<Sprite>(null);
  const current = useStore((s) => s.current);
  const tier = useStore((s) => s.tier);
  const [fontTick, setFontTick] = useState(0);

  const key = current ? `${current.id}|${current.restaurantName}|${current.level}|${current.treat ? 1 : 0}` : '';
  const textures = useMemo(() => {
    void fontTick;
    if (!current) return drawHeroTexture({ name: '', stickNo: 1, levelLabel: '', treat: false });
    return drawHeroTexture({
      name: current.restaurantName,
      stickNo: current.stickNo,
      levelLabel: levelLabelFor(current),
      treat: current.treat,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` is read through `key`, which changes whenever anything painted changes
  }, [key, fontTick]);
  useEffect(
    () => () => {
      textures.map.dispose();
      textures.emissiveMap.dispose();
    },
    [textures],
  );

  // Repaint once the brush font for this name is in.
  useEffect(() => {
    if (!current) return;
    let alive = true;
    const text = `${current.restaurantName}第${toChineseNumeral(current.stickNo)}签·${levelLabelFor(current)}`;
    void fontsReady(text).then((ok) => {
      if (alive && ok) setFontTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `key` on purpose: re-run only when the painted text changes
  }, [key]);

  const treat = current?.treat ?? false;
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: textures.map,
        emissiveMap: textures.emissiveMap,
        roughness: 0.52,
        metalness: 0,
        emissive: '#ffcf6a',
        emissiveIntensity: BASE_EMISSIVE,
        transparent: true,
        envMapIntensity: 0.9,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- material is created once; maps are swapped in imperatively below
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    material.map = textures.map;
    material.emissiveMap = textures.emissiveMap;
    material.roughness = treat ? 0.32 : 0.52;
    material.metalness = treat ? 0.55 : 0;
    material.envMapIntensity = treat ? 1.4 : 0.9;
  }, [material, textures, treat]);

  const halo = useMemo(() => {
    const map = haloTexture();
    const m = new SpriteMaterial({ map, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, color: '#ffe6b8' });
    return { map, m };
  }, []);
  useEffect(
    () => () => {
      halo.map.dispose();
      halo.m.dispose();
    },
    [halo],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const sprite = haloRef.current;
    if (!mesh || !sprite) return;
    const visible = rt.hero.mode !== 'off';
    mesh.visible = visible;
    const p = rt.hero.pose;
    if (visible) {
      mesh.position.set(p.p[0], p.p[1], p.p[2]);
      mesh.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]);
      const sc = heroVisual.scale;
      mesh.scale.set(sc, sc, sc);
      material.opacity = heroVisual.opacity;
      material.depthWrite = heroVisual.opacity > 0.98;
      material.emissiveIntensity = BASE_EMISSIVE * heroVisual.glow;
    }
    const h = visible ? heroVisual.halo : 0;
    sprite.visible = h > 0.003;
    if (sprite.visible) {
      sprite.position.set(p.p[0], p.p[1], p.p[2] - 0.05);
      // Narrow and soft: a glow around the stick, not a wash over the red tube behind it.
      sprite.scale.set(0.24 * heroVisual.scale, 1.35 * heroVisual.scale, 1);
      halo.m.opacity = h * (tier === 0 ? 0.3 : 0.38);
    }
  });

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={sharedStickGeometry()}
        material={material}
        castShadow={tier === 2}
        visible={false}
        dispose={null}
        name="hero-stick"
        renderOrder={2}
      />
      <sprite ref={haloRef} material={halo.m} visible={false} dispose={null} renderOrder={1} />
    </>
  );
}
