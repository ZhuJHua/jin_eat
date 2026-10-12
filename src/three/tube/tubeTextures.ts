/**
 * Procedural canvas textures for the 签筒: the red-lacquer barrel skin (gold 回纹 key-fret borders and
 * 祥云 cloud scrolls painted over mottled urushi) and the gold 「锦少灵签」 medallion. Each comes as a
 * colour map plus an "ORM" map (G = roughness, B = metalness) so painted gold reads as metal under
 * the lacquer while the red stays dielectric.
 */
import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { brushFont } from '@/three/sticks/fonts';
import { TUBE_DIMS } from './tubeGeometry';

export interface PaintedTexture {
  map: CanvasTexture;
  orm: CanvasTexture;
  /** Repaint (e.g. after the brush font loads). */
  repaint(): void;
  dispose(): void;
}

const GOLD = '#d9a441';
const ORM_LACQUER = 'rgb(255,80,0)';
/** Painted gold: metallic but not mirror-dark when nothing bright is reflected. */
const ORM_GOLD = 'rgb(255,70,185)';

/** Tiny seeded PRNG so the pattern is identical on every load. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

// ───────────────────────────── motifs ─────────────────────────────

/** Archimedean curl used by the 祥云 scrolls. */
function curl(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, turns: number, dir: 1 | -1, phase: number): void {
  const steps = Math.ceil(turns * 40);
  const total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * total;
    const r = r0 * (1 - (th / total) * 0.82);
    const a = phase + dir * th;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** One 祥云 cloud: two opposed curls joined by a sweeping tail. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip: boolean): void {
  const f = flip ? -1 : 1;
  ctx.beginPath();
  curl(ctx, x, y, s * 0.42, 1.35, 1, Math.PI * 0.5);
  ctx.moveTo(x + f * s * 0.95, y + s * 0.02);
  curl(ctx, x + f * s * 0.62, y + s * 0.02, s * 0.3, 1.2, flip ? 1 : -1, flip ? 0 : Math.PI);
  ctx.moveTo(x - f * s * 0.42, y + s * 0.05);
  ctx.bezierCurveTo(x - f * s * 0.5, y + s * 0.55, x + f * s * 0.3, y + s * 0.62, x + f * s * 0.62, y + s * 0.32);
  ctx.moveTo(x + f * s * 0.92, y + s * 0.2);
  ctx.bezierCurveTo(x + f * s * 1.3, y + s * 0.42, x + f * s * 1.7, y + s * 0.3, x + f * s * 2.05, y + s * 0.45);
  ctx.stroke();
}

/** Continuous 回纹 key-fret strip between y0 and y1, period `p` px, wrapping horizontally. */
function fretBand(ctx: CanvasRenderingContext2D, w: number, y0: number, y1: number, p: number, lw: number): void {
  const h = y1 - y0;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'square';
  // Border lines.
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w, y0);
  ctx.moveTo(0, y1);
  ctx.lineTo(w, y1);
  ctx.stroke();
  // Meander: each unit is a squared spiral.
  const m = h * 0.18;
  const top = y0 + m;
  const bot = y1 - m;
  const hh = bot - top;
  ctx.beginPath();
  for (let x = 0; x < w + p; x += p) {
    const a = x;
    const u = p;
    ctx.moveTo(a, bot);
    ctx.lineTo(a, top);
    ctx.lineTo(a + u * 0.78, top);
    ctx.lineTo(a + u * 0.78, top + hh * 0.72);
    ctx.lineTo(a + u * 0.3, top + hh * 0.72);
    ctx.lineTo(a + u * 0.3, top + hh * 0.36);
    ctx.lineTo(a + u * 0.52, top + hh * 0.36);
    ctx.moveTo(a, bot);
    ctx.lineTo(a + u, bot);
  }
  ctx.stroke();
}

// ───────────────────────────── barrel skin ─────────────────────────────

function paintLacquer(map: CanvasRenderingContext2D, orm: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = mulberry(0x51a7e);
  const yOf = (worldY: number): number => (1 - worldY / TUBE_DIMS.height) * h;

  // Base urushi: deep at the foot, warm in the belly, slightly brighter under the lip.
  const g = map.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#9c0e17');
  g.addColorStop(0.08, '#b3121b');
  g.addColorStop(0.55, '#b0111a');
  g.addColorStop(0.86, '#8a0c14');
  g.addColorStop(1, '#5e080d');
  map.fillStyle = g;
  map.fillRect(0, 0, w, h);
  orm.fillStyle = ORM_LACQUER;
  orm.fillRect(0, 0, w, h);

  // Mottled depth, wrapped horizontally.
  for (let i = 0; i < 420; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.01 + rand() * 0.05) * w;
    const dark = rand() < 0.6;
    const a = 0.025 + rand() * 0.04;
    for (const dx of [0, -w, w]) {
      const rg = map.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      rg.addColorStop(0, dark ? `rgba(40,0,4,${a})` : `rgba(255,90,70,${a * 0.7})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      map.fillStyle = rg;
      map.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
  // Horizontal brush drag of the lacquer.
  map.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    const y = rand() * h;
    map.strokeStyle = `rgba(${rand() < 0.5 ? '255,120,100' : '30,0,0'},${0.025 + rand() * 0.03})`;
    map.beginPath();
    map.moveTo(0, y);
    map.lineTo(w, y + (rand() - 0.5) * 3);
    map.stroke();
  }
  // Roughness variation in the ORM green channel.
  for (let i = 0; i < 120; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.02 + rand() * 0.06) * w;
    orm.fillStyle = `rgba(255,${60 + Math.floor(rand() * 60)},0,0.25)`;
    orm.beginPath();
    orm.arc(x, y, r, 0, Math.PI * 2);
    orm.fill();
  }

  // Gold work, painted identically into both canvases.
  const unit = Math.max(16, Math.round(w / 40));
  const lw = Math.max(1.5, w / 420);
  const both = (fn: (c: CanvasRenderingContext2D, gold: boolean) => void): void => {
    fn(map, true);
    fn(orm, false);
  };
  both((c, isMap) => {
    c.strokeStyle = isMap ? GOLD : ORM_GOLD;
    fretBand(c, w, yOf(0.215), yOf(0.165), unit, lw);
    fretBand(c, w, yOf(0.765), yOf(0.715), unit, lw);
  });

  // Clouds flanking the medallion (u = 0 is the front) and around the back.
  const placements: readonly [number, number, number, boolean][] = [
    [0.13, 0.6, 0.06, false],
    [0.2, 0.36, 0.045, true],
    [0.87, 0.6, 0.06, true],
    [0.8, 0.36, 0.045, false],
    [0.36, 0.55, 0.05, false],
    [0.5, 0.42, 0.06, true],
    [0.64, 0.58, 0.05, false],
  ];
  both((c, isMap) => {
    c.lineWidth = Math.max(2, w / 300);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [u, y, s, flip] of placements) {
      const px = u * w;
      const py = yOf(y);
      const sz = s * w;
      if (isMap) {
        c.strokeStyle = 'rgba(60,0,0,0.35)';
        c.save();
        c.translate(1.2, 1.2);
        cloud(c, px, py, sz, flip);
        c.restore();
        c.strokeStyle = GOLD;
      } else c.strokeStyle = ORM_GOLD;
      cloud(c, px, py, sz, flip);
    }
  });
}

export function createLacquerTextures(size: 512 | 1024): PaintedTexture {
  const w = size;
  const h = size / 2;
  const mc = makeCanvas(w, h);
  const oc = makeCanvas(w, h);
  const map = new CanvasTexture(mc);
  const orm = new CanvasTexture(oc);
  map.colorSpace = SRGBColorSpace;
  orm.colorSpace = NoColorSpace;
  for (const t of [map, orm]) {
    t.wrapS = RepeatWrapping;
    t.anisotropy = 4;
  }
  const repaint = (): void => {
    paintLacquer(ctx2d(mc), ctx2d(oc), w, h);
    map.needsUpdate = true;
    orm.needsUpdate = true;
  };
  repaint();
  return {
    map,
    orm,
    repaint,
    dispose() {
      map.dispose();
      orm.dispose();
    },
  };
}

// ───────────────────────────── medallion ─────────────────────────────

function paintMedallion(map: CanvasRenderingContext2D, orm: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  map.clearRect(0, 0, s, s);
  orm.clearRect(0, 0, s, s);

  // Gold disc with a soft radial sheen.
  const rg = map.createRadialGradient(c * 0.8, c * 0.7, s * 0.05, c, c, c);
  rg.addColorStop(0, '#f6d27a');
  rg.addColorStop(0.55, '#d9a441');
  rg.addColorStop(1, '#a8741f');
  map.fillStyle = rg;
  map.beginPath();
  map.arc(c, c, c, 0, Math.PI * 2);
  map.fill();
  orm.fillStyle = ORM_GOLD;
  orm.fillRect(0, 0, s, s);

  // Rings and a bead border.
  const ring = (r: number, lw: number, color: string): void => {
    map.strokeStyle = color;
    map.lineWidth = lw;
    map.beginPath();
    map.arc(c, c, r, 0, Math.PI * 2);
    map.stroke();
  };
  ring(c * 0.95, s * 0.012, '#7a4a12');
  ring(c * 0.78, s * 0.01, '#7a4a12');
  ring(c * 0.74, s * 0.004, '#fbe3a0');
  const beads = 36;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2;
    const x = c + Math.cos(a) * c * 0.865;
    const y = c + Math.sin(a) * c * 0.865;
    const bg = map.createRadialGradient(x - s * 0.006, y - s * 0.006, 0, x, y, s * 0.022);
    bg.addColorStop(0, '#fff0b8');
    bg.addColorStop(0.6, '#d9a441');
    bg.addColorStop(1, '#8a5a16');
    map.fillStyle = bg;
    map.beginPath();
    map.arc(x, y, s * 0.02, 0, Math.PI * 2);
    map.fill();
  }

  // Lacquered inner field.
  const field = map.createRadialGradient(c, c * 0.9, 0, c, c, c * 0.72);
  field.addColorStop(0, '#c0141e');
  field.addColorStop(1, '#7e0a12');
  map.fillStyle = field;
  map.beginPath();
  map.arc(c, c, c * 0.72, 0, Math.PI * 2);
  map.fill();
  orm.fillStyle = ORM_LACQUER;
  orm.beginPath();
  orm.arc(c, c, c * 0.72, 0, Math.PI * 2);
  orm.fill();

  // 「锦少灵签」 in two columns read right-to-left: 锦少 | 灵签.
  const fs = s * 0.25;
  const cols: readonly [string, number][] = [
    ['锦少', c + s * 0.13],
    ['灵签', c - s * 0.13],
  ];
  map.textAlign = 'center';
  map.textBaseline = 'middle';
  orm.textAlign = 'center';
  orm.textBaseline = 'middle';
  map.font = brushFont(fs);
  orm.font = brushFont(fs);
  for (const [txt, x] of cols) {
    for (let k = 0; k < 2; k++) {
      const ch = txt[k]!;
      const y = c + (k === 0 ? -1 : 1) * s * 0.135;
      map.fillStyle = 'rgba(70,20,0,0.7)';
      map.fillText(ch, x + s * 0.005, y + s * 0.006);
      map.fillStyle = '#f2c560';
      map.fillText(ch, x, y);
      orm.fillStyle = ORM_GOLD;
      orm.fillText(ch, x, y);
    }
  }
}

export function createMedallionTextures(size: 256 | 512): PaintedTexture {
  const mc = makeCanvas(size, size);
  const oc = makeCanvas(size, size);
  const map = new CanvasTexture(mc);
  const orm = new CanvasTexture(oc);
  map.colorSpace = SRGBColorSpace;
  orm.colorSpace = NoColorSpace;
  map.anisotropy = 4;
  const repaint = (): void => {
    paintMedallion(ctx2d(mc), ctx2d(oc), size);
    map.needsUpdate = true;
    orm.needsUpdate = true;
  };
  repaint();
  return {
    map,
    orm,
    repaint,
    dispose() {
      map.dispose();
      orm.dispose();
    },
  };
}
