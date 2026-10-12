/**
 * Offerings: three pleated 包子 stacked on a blue-rimmed porcelain plate and a celadon
 * tea cup of dark amber tea. Porcelain + tea share one vertex-coloured mesh; the buns are instanced.
 * (No chopsticks standing in rice: that is a funeral offering.)
 */
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityTier } from '@/types';
import { useLayout } from './layout';

function colored(g: BufferGeometry, colorAt: (i: number, x: number, y: number, z: number) => string | Color): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.deleteAttribute('uv');
  const p = ng.getAttribute('position');
  const cols = new Float32Array(p.count * 3);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const v = colorAt(i, p.getX(i), p.getY(i), p.getZ(i));
    c.set(v);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new BufferAttribute(cols, 3));
  return ng;
}

const PORCELAIN = new Color('#f4efe6');
const COBALT = new Color('#1f3f8f');
const CELADON = new Color('#9fbfa5');
const TEA = new Color('#5a2e0a');

function lathe(profile: [number, number][], segs: number): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segs,
  );
}

/** Plate at the origin, cup offset by `cupOffset` (both resting on y = 0). */
function porcelainGeometry(cupOffset: Vector3): BufferGeometry {
  const plate = colored(
    lathe(
      [
        [0.0, 0.006],
        [0.06, 0.006],
        [0.062, 0.0],
        [0.07, 0.0],
        [0.072, 0.008],
        [0.12, 0.013],
        [0.158, 0.024],
        [0.172, 0.03],
        [0.168, 0.034],
        [0.152, 0.029],
        [0.11, 0.019],
        [0.0, 0.015],
      ],
      48,
    ),
    (_i, x, y, z) => {
      const r = Math.hypot(x, z);
      // Cobalt rim line and an inner ring, classic 青花 plate.
      if (y > 0.02 && r > 0.149 && r < 0.163) return COBALT;
      if (y > 0.012 && r > 0.112 && r < 0.118) return COBALT;
      return PORCELAIN;
    },
  );
  const cupProfile: [number, number][] = [
    [0.0, 0.004],
    [0.026, 0.004],
    [0.028, 0.0],
    [0.034, 0.0],
    [0.036, 0.008],
    [0.05, 0.03],
    [0.06, 0.056],
    [0.064, 0.062],
    [0.059, 0.062],
    [0.054, 0.05],
    [0.041, 0.022],
    [0.0, 0.014],
  ];
  const cup = colored(lathe(cupProfile, 40), () => CELADON);
  cup.translate(cupOffset.x, cupOffset.y, cupOffset.z);
  const tea = colored(new CircleGeometry(0.0545, 32).rotateX(-Math.PI / 2), () => TEA);
  tea.translate(cupOffset.x, cupOffset.y + 0.05, cupOffset.z);
  const merged = mergeGeometries([plate, cup, tea], false);
  plate.dispose();
  cup.dispose();
  tea.dispose();
  if (!merged) throw new Error('porcelain merge failed');
  return merged;
}

function baoziGeometry(): BufferGeometry {
  const g = new SphereGeometry(0.07, 28, 18);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const ny = y / 0.07;
    const th = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    // Flat-ish bottom, domed top.
    y = ny < 0 ? y * 0.45 : y * 0.8;
    // 8 radial pleats twisting toward the top knot.
    const top = Math.max(0, Math.min(1, (ny - 0.35) / 0.6));
    const pleat = Math.pow(0.5 + 0.5 * Math.cos(8 * th + ny * 2.2), 2.0);
    const dent = 0.0065 * pleat * top;
    const k = r > 1e-5 ? (r - dent) / r : 1;
    x *= k;
    z *= k;
    // Pinched knot at the crown.
    if (ny > 0.9) y += 0.006 * (ny - 0.9) * 10;
    p.setXYZ(i, x, y + 0.07 * 0.45, z);
  }
  g.computeVertexNormals();
  return g;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3(1, 1, 1);

export function Offerings({ tier }: { tier: QualityTier }) {
  const layout = useLayout();
  const plate = layout.plate;
  const cup = layout.cup;
  const geo = useMemo(() => porcelainGeometry(new Vector3(cup[0] - plate[0], cup[1] - plate[1], cup[2] - plate[2])), [cup, plate]);
  const mat = useMemo(
    () =>
      tier === 2
        ? new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })
        : new MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0 }),
    [tier],
  );
  const bunGeo = useMemo(baoziGeometry, []);
  const bunMat = useMemo(
    () =>
      tier === 2
        ? new MeshPhysicalMaterial({
            color: new Color('#f3e6cc'),
            roughness: 0.8,
            sheen: 0.6,
            sheenColor: new Color('#fff4dc'),
            sheenRoughness: 0.8,
          })
        : new MeshStandardMaterial({ color: new Color('#f3e6cc'), roughness: 0.8 }),
    [tier],
  );
  const buns = useMemo(() => {
    const m = new InstancedMesh(bunGeo, bunMat, 3);
    const spots: [number, number, number, number][] = [
      [-0.052, 0.012, 0.03, 0.4],
      [0.056, 0.012, 0.022, -0.7],
      [0.002, 0.07, 0.026, 1.9],
    ];
    spots.forEach(([x, y, z, yaw], i) => {
      tmpE.set(i === 2 ? 0.12 : 0, yaw, i === 2 ? -0.05 : 0);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(x, y, z);
      tmpS.setScalar(i === 2 ? 0.92 : 1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [bunGeo, bunMat]);

  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => bunMat.dispose(), [bunMat]);
  useEffect(() => () => bunGeo.dispose(), [bunGeo]);

  return (
    <group position={plate}>
      <mesh geometry={geo} material={mat} />
      <primitive object={buns} />
    </group>
  );
}
