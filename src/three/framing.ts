/**
 * Camera framing. Pure functions: given a shot, the canvas aspect, a focus point and the
 * reveal dock, return where the camera should sit, what it looks at and its vertical FOV.
 *
 * Every shot is defined as "look point + view direction + the half-extents that must stay visible";
 * the distance is the larger of the shot's preferred distance and what is needed to fit those
 * extents into the visible region (the region shrinks when the reveal scroll docks right or rises as
 * a bottom sheet — the dock itself is applied with `camera.setViewOffset`).
 */
import type { CameraShot, Vec3 } from '@/types';
import type { Runtime } from '@/state/runtime';
import { CFG } from '@/config';

export interface Framing {
  pos: Vec3;
  look: Vec3;
  fov: number;
}

export type Dock = Runtime['camera']['dock'];

export interface Viewport {
  w: number;
  h: number;
}

const DEG = Math.PI / 180;

/** Base framings for landscape and portrait canvases. */
const DESKTOP = { pos: [0, 1.25, 3.6] as Vec3, look: [0, 0.65, 0] as Vec3, fov: 35 };
const PORTRAIT = { pos: [0, 1.35, 3.0] as Vec3, look: [0, 0.7, 0] as Vec3 };

/** Width (CSS px) of the docked scroll on the right: 420 px on desktop, 45vw on phones in landscape. */
export function dockPx(w: number): number {
  return w >= 1024 ? 420 : Math.round(w * 0.45);
}

/** Fraction of the canvas height covered by the bottom sheet (max 62dvh). */
export const SHEET_FRAC = 0.62;

/** Which dock the reveal uses for this viewport: landscape docks right, portrait uses the bottom sheet. */
export function dockForViewport(w: number, h: number): Exclude<Dock, 'none'> {
  return w > h ? 'right' : 'bottom';
}

export function baseFov(aspect: number): number {
  if (aspect >= 1) return DESKTOP.fov;
  return Math.min(55, Math.max(45, 45 + (0.6 - aspect) * 20));
}

/** Visible-region fractions (width, height) of the full canvas for a dock. */
export function regionFrac(
  dock: Dock,
  vp: Viewport | undefined,
  aspect: number,
  out: { fw: number; fh: number } = { fw: 1, fh: 1 },
): { fw: number; fh: number } {
  out.fw = 1;
  out.fh = 1;
  if (dock === 'right') out.fw = vp && vp.w > 0 ? Math.max(0.35, 1 - dockPx(vp.w) / vp.w) : aspect >= 1.6 ? 0.7 : 0.55;
  else if (dock === 'bottom') out.fh = 1 - SHEET_FRAC;
  return out;
}

const _region = { fw: 1, fh: 1 };

/** setViewOffset shift (CSS px) that centres the 3D subject in the region left visible by the dock. */
export function viewOffsetFor(dock: Dock, w: number, h: number): { x: number; y: number } | null {
  if (dock === 'none') return null;
  return viewOffsetInto({ x: 0, y: 0 }, dock, w, h);
}

/** Allocation-free `viewOffsetFor` (writes 0,0 for 'none'). */
export function viewOffsetInto(out: { x: number; y: number }, dock: Dock, w: number, h: number): { x: number; y: number } {
  out.x = dock === 'right' ? dockPx(w) / 2 : 0;
  out.y = dock === 'bottom' ? (SHEET_FRAC / 2) * h : 0;
  return out;
}

const _dirDesk = norm(sub(DESKTOP.pos, DESKTOP.look));
const _dirPort = norm(sub(PORTRAIT.pos, PORTRAIT.look));
const DIST_DESK = len(sub(DESKTOP.pos, DESKTOP.look));
const DIST_PORT = len(sub(PORTRAIT.pos, PORTRAIT.look));
/**
 * From the right and slightly above: parallax moves the barrel to the right of the presented stick
 * (under the docked scroll on desktop), leaving a clean backdrop behind the name.
 */
const PRESENT_DIR: Vec3 = norm([0.22, Math.sin(8 * DEG) + 0.02, Math.cos(8 * DEG)]);
const JIAOBEI_DIR: Vec3 = norm([0.05, 0.62, 1]);

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Desktop present FOV factor (CFG.camera.fovDesktop, 1 → 0.8) mapped onto this aspect's range; on
 * portrait the CFG.camera.fovMobile ratio (45 → 40) is used instead.
 */
export function effectiveFovScale(desktopScale: number, aspect: number): number {
  if (aspect >= 1) return desktopScale;
  const dEnd = CFG.camera.fovDesktop[1] / CFG.camera.fovDesktop[0];
  const mEnd = CFG.camera.fovMobile[1] / CFG.camera.fovMobile[0];
  return 1 - ((1 - desktopScale) * (1 - mEnd)) / (1 - dEnd);
}

/** Allocation-free variant of `frameFor`; writes into `out` and returns it. */
export function frameForInto(
  out: Framing,
  shot: CameraShot,
  aspect: number,
  focus: Vec3,
  dock: Dock,
  fovScale = 1,
  vp?: Viewport,
): Framing {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const portrait = a < 1;
  const fov0 = baseFov(a);
  const dir = portrait ? _dirPort : _dirDesk;
  const baseLook = portrait ? PORTRAIT.look : DESKTOP.look;
  const baseDist = portrait ? DIST_PORT : DIST_DESK;
  const { fw, fh } = regionFrac(dock, vp, a, _region);

  let lx = baseLook[0];
  let ly = baseLook[1];
  let lz = baseLook[2];
  let dx = dir[0];
  let dy = dir[1];
  let dz = dir[2];
  let fov = fov0;
  let minDist = baseDist;
  let halfH = 0;
  let halfW = 0.62;

  switch (shot) {
    case 'idle':
      break;
    case 'shake':
      minDist = baseDist * 0.95;
      break;
    case 'follow': {
      lx = baseLook[0] + (focus[0] - baseLook[0]) * 0.55;
      ly = baseLook[1] + (focus[1] - baseLook[1]) * 0.55;
      lz = baseLook[2] + (focus[2] - baseLook[2]) * 0.55;
      minDist = baseDist * 0.82;
      halfH = 0.82;
      halfW = 0.8;
      break;
    }
    case 'present': {
      lx = focus[0];
      ly = focus[1] + 0.02;
      lz = focus[2];
      dx = PRESENT_DIR[0];
      dy = PRESENT_DIR[1];
      dz = PRESENT_DIR[2];
      fov = fov0 * effectiveFovScale(fovScale, a);
      minDist = 0;
      halfH = 0.64;
      halfW = 0.3;
      break;
    }
    case 'toss': {
      // 筊杯 in the air: pulled back and tilted up so the whole arc (tube mouth → altar) is in frame.
      lx = 0.12;
      ly = 0.6;
      lz = 0.42;
      dx = JIAOBEI_DIR[0];
      dy = JIAOBEI_DIR[1] * 0.55;
      dz = JIAOBEI_DIR[2];
      minDist = 0;
      halfH = 0.9;
      halfW = 0.8;
      break;
    }
    case 'jiaobei': {
      // Centred on where the blocks come to rest (y 0.02, z 0.72, x ±0.22); the tube stays at the top.
      lx = 0.04;
      ly = 0.1;
      lz = 0.64;
      dx = JIAOBEI_DIR[0];
      dy = JIAOBEI_DIR[1];
      dz = JIAOBEI_DIR[2];
      minDist = 0;
      halfH = 0.52;
      halfW = 0.66;
      break;
    }
    case 'locked': {
      // Today's stick resting on the altar in front of its tube (tube and bundle kept in frame).
      lx = 0.06;
      ly = 0.46;
      lz = 0.32;
      minDist = baseDist * 0.78;
      halfH = 0.74;
      halfW = 0.76;
      break;
    }
  }

  const tv = Math.tan((fov * DEG) / 2);
  const needH = halfH > 0 ? halfH / (tv * fh) : 0;
  const needW = halfW > 0 ? halfW / (tv * a * fw) : 0;
  const d = Math.max(minDist, needH, needW);

  out.look[0] = lx;
  out.look[1] = ly;
  out.look[2] = lz;
  out.pos[0] = lx + dx * d;
  out.pos[1] = ly + dy * d;
  out.pos[2] = lz + dz * d;
  out.fov = fov;
  return out;
}

export function frameFor(shot: CameraShot, aspect: number, focus: Vec3, dock: Dock, fovScale = 1, vp?: Viewport): Framing {
  return frameForInto({ pos: [0, 0, 0], look: [0, 0, 0], fov: 35 }, shot, aspect, focus, dock, fovScale, vp);
}
