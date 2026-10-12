/**
 * Stick textures.
 *
 * - `createStickAtlas(names, size)`: one square canvas, 16 columns, each column painted as a bamboo
 *   签 with nodes, a red-lacquered tip, the restaurant name carved vertically in Ma Shan Zheng and
 *   「第{n}签」 near the foot. Columns are indexed by stick index.
 * - `drawHeroTexture(...)`: a 256×2048 column for the chosen stick plus a matching emissive text mask
 *   (gold glow, picked up by bloom). The 锦少请客签 variant is gilded.
 *
 * Text is "carved": dark offset (+1,+1), light offset (−1,−1), then the base fill. Glyphs are drawn
 * with a vertical squash that cancels the column/stick aspect mismatch so they look square in 3D.
 */
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { CFG } from '@/config';
import { toChineseNumeral } from '@/lib/date';
import { brushFont } from './fonts';

export const ATLAS_COLUMNS = 16 as const;

export interface StickAtlas {
  texture: CanvasTexture;
  columns: 16;
  /** Repaint with new names (keeps the same texture object). */
  repaint(names: readonly string[]): void;
  dispose(): void;
}

const STICK_ASPECT = CFG.stick.size[1] / CFG.stick.size[0];
const RED = '#b3121b';

function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
}

function charsOf(s: string): string[] {
  return Array.from(s);
}

interface ColumnStyle {
  /** Bamboo (default) or gilded (锦少请客签). */
  gold: boolean;
}

/** Paint the bamboo body, nodes and red tip of one column. */
function paintBody(ctx: CanvasRenderingContext2D, x0: number, w: number, h: number, seed: number, style: ColumnStyle): void {
  const rand = seeded(seed * 2654435761 + 7);
  // Body gradient (vertical) with a soft cross-grain sheen.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (style.gold) {
    g.addColorStop(0, '#f3d27a');
    g.addColorStop(0.5, '#d6a443');
    g.addColorStop(1, '#b07a26');
  } else {
    g.addColorStop(0, '#dcbc80');
    g.addColorStop(0.55, '#d1ad6c');
    g.addColorStop(1, '#c19552');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, w, h);
  const sheen = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  sheen.addColorStop(0, 'rgba(90,50,10,0.18)');
  sheen.addColorStop(0.35, 'rgba(255,240,200,0.10)');
  sheen.addColorStop(0.65, 'rgba(255,240,200,0.06)');
  sheen.addColorStop(1, 'rgba(90,50,10,0.22)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x0, 0, w, h);

  // Fibre streaks.
  const streaks = Math.round(w * 0.35);
  for (let i = 0; i < streaks; i++) {
    const x = x0 + rand() * w;
    const y = rand() * h * 0.4;
    const len = h * (0.3 + rand() * 0.7);
    ctx.strokeStyle = rand() < 0.55 ? `rgba(120,75,25,${0.06 + rand() * 0.1})` : `rgba(255,245,215,${0.05 + rand() * 0.08})`;
    ctx.lineWidth = Math.max(0.5, (w / 128) * (0.6 + rand() * 1.2));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2, y + len);
    ctx.stroke();
  }

  // Two bamboo nodes.
  for (const f of [0.4 + rand() * 0.04, 0.74 + rand() * 0.04]) {
    const y = f * h;
    const band = h * 0.006;
    const ng = ctx.createLinearGradient(0, y - band * 2, 0, y + band * 2);
    ng.addColorStop(0, 'rgba(110,65,20,0)');
    ng.addColorStop(0.45, style.gold ? 'rgba(120,70,10,0.55)' : 'rgba(110,65,20,0.55)');
    ng.addColorStop(0.55, style.gold ? 'rgba(255,240,180,0.55)' : 'rgba(250,230,180,0.5)');
    ng.addColorStop(1, 'rgba(110,65,20,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(x0, y - band * 2, w, band * 4);
  }

  // Red-lacquered tip with a slightly ragged brushed edge.
  const tipH = h * 0.15;
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x0 + w, 0);
  const steps = 8;
  for (let i = steps; i >= 0; i--) {
    const x = x0 + (w * i) / steps;
    ctx.lineTo(x, tipH + (rand() - 0.5) * h * 0.006);
  }
  ctx.closePath();
  ctx.fill();
  const tg = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  tg.addColorStop(0, 'rgba(60,0,0,0.35)');
  tg.addColorStop(0.4, 'rgba(255,120,110,0.18)');
  tg.addColorStop(1, 'rgba(60,0,0,0.4)');
  ctx.fillStyle = tg;
  ctx.fillRect(x0, 0, w, tipH);
  // Gold pin-stripe under the red.
  ctx.fillStyle = style.gold ? '#7a0a10' : '#d9a441';
  ctx.fillRect(x0, tipH + h * 0.004, w, Math.max(1, h * 0.0025));

  // Worn foot.
  const fg = ctx.createLinearGradient(0, h * 0.9, 0, h);
  fg.addColorStop(0, 'rgba(80,45,10,0)');
  fg.addColorStop(1, 'rgba(80,45,10,0.35)');
  ctx.fillStyle = fg;
  ctx.fillRect(x0, h * 0.9, w, h * 0.1);
}

interface CarveOpts {
  fill: string;
  dark: string;
  light: string;
  offset: number;
}

/**
 * Draw `chars` stacked vertically, centred at column centre `cx`, starting at `top`, each glyph
 * `fs` px wide and squashed by `squash` vertically. Returns the y after the last glyph.
 */
function carveVertical(
  ctx: CanvasRenderingContext2D,
  chars: readonly string[],
  cx: number,
  top: number,
  fs: number,
  squash: number,
  gap: number,
  o: CarveOpts | null,
  maskFill: string | null,
): number {
  ctx.save();
  ctx.font = brushFont(fs);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = fs * squash * gap;
  let y = top + step / 2;
  for (const ch of chars) {
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(1, squash);
    if (maskFill) {
      ctx.fillStyle = maskFill;
      ctx.fillText(ch, 0, 0);
    } else if (o) {
      ctx.fillStyle = o.dark;
      ctx.fillText(ch, o.offset, o.offset);
      ctx.fillStyle = o.light;
      ctx.fillText(ch, -o.offset, -o.offset);
      ctx.fillStyle = o.fill;
      ctx.fillText(ch, 0, 0);
    }
    ctx.restore();
    y += step;
  }
  ctx.restore();
  return top + step * chars.length;
}

interface NameRegion {
  /** Fractions of the stick height / width. */
  top: number;
  h: number;
  fs: number;
}
/** Sticks in the tube: name from 20% to 66% of the height. */
const TUBE_NAME_REGION: NameRegion = { top: 0.2, h: 0.46, fs: 0.7 };
/** The presented hero stick: a larger name so it reads on a phone at the reveal. */
const HERO_NAME_REGION: NameRegion = { top: 0.14, h: 0.56, fs: 0.86 };

/** Layout for a column: name in the upper-middle, 「第n签」 near the foot. */
function paintColumnText(
  ctx: CanvasRenderingContext2D,
  x0: number,
  w: number,
  h: number,
  name: string,
  footer: string[],
  carve: CarveOpts | null,
  mask: string | null,
  region: NameRegion = TUBE_NAME_REGION,
): void {
  const squash = h / w / STICK_ASPECT;
  const cx = x0 + w / 2;
  const chars = charsOf(name).slice(0, 8);
  const regionTop = h * region.top;
  const regionH = h * region.h;
  let fs = w * region.fs;
  const gap = 1.04;
  const need = fs * squash * gap * chars.length;
  if (need > regionH) fs *= regionH / need;
  const used = fs * squash * gap * chars.length;
  const top = regionTop + Math.max(0, (regionH - used) * 0.25);
  carveVertical(ctx, chars, cx, top, fs, squash, gap, carve, mask);

  // Footer: e.g. 第 七 签 (and optional level) in smaller glyphs, bottom-aligned at 95%.
  let ffs = w * 0.44;
  const fgap = 1.08;
  const footRegion = h * 0.26;
  const fneed = ffs * squash * fgap * footer.length;
  if (fneed > footRegion) ffs *= footRegion / fneed;
  const fused = ffs * squash * fgap * footer.length;
  carveVertical(ctx, footer, cx, h * 0.955 - fused, ffs, squash, fgap, carve, mask);
}

function carveFor(w: number, gold: boolean): CarveOpts {
  const o = Math.max(0.6, w / 128);
  return gold
    ? { fill: '#8a0b12', dark: 'rgba(70,20,0,0.85)', light: 'rgba(255,245,200,0.6)', offset: o }
    : { fill: 'rgba(78,34,8,0.95)', dark: 'rgba(60,25,5,0.85)', light: 'rgba(255,240,200,0.5)', offset: o };
}

function paintAtlas(canvas: HTMLCanvasElement, names: readonly string[], size: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const colW = size / ATLAS_COLUMNS;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < ATLAS_COLUMNS; i++) {
    const x0 = i * colW;
    paintBody(ctx, x0, colW, size, i + 1, { gold: false });
    const name = names[i];
    if (name) {
      const footer = ['第', ...charsOf(toChineseNumeral(i + 1)), '签'];
      paintColumnText(ctx, x0, colW, size, name, footer, carveFor(colW, false), null);
    }
  }
}

/** Synchronously painted atlas (fallback fonts if the brush font is not ready yet). */
export function createStickAtlas(names: readonly string[], size: 1024 | 2048): StickAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paintAtlas(canvas, names, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  return {
    texture,
    columns: ATLAS_COLUMNS,
    repaint(next) {
      paintAtlas(canvas, next, size);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

/** Hero stick textures: colour map and an emissive text mask, both 256×2048. */
export function drawHeroTexture(args: { name: string; stickNo: number; levelLabel: string; treat: boolean }): {
  map: CanvasTexture;
  emissiveMap: CanvasTexture;
} {
  const w = 256;
  const h = 2048;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = w;
  mapCanvas.height = h;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const ctx = mapCanvas.getContext('2d');
  const mctx = maskCanvas.getContext('2d');
  const footer = ['第', ...charsOf(toChineseNumeral(args.stickNo)), '签', '·', ...charsOf(args.levelLabel)];
  if (ctx) {
    paintBody(ctx, 0, w, h, 977 + args.stickNo, { gold: args.treat });
    // Dark ink carving with a gilded inner edge (~8:1 against the pale wood).
    const carve: CarveOpts = args.treat ? carveFor(w, true) : { fill: '#2a0d04', dark: 'rgba(40,14,2,0.9)', light: '#e8b64c', offset: 1.5 };
    paintColumnText(ctx, 0, w, h, args.name, footer, carve, null, HERO_NAME_REGION);
  }
  if (mctx) {
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, w, h);
    // Emissive only on a soft rim around each glyph: paint glowing glyphs, then knock the
    // interiors back to black so the ink stays dark and the gold edge glows.
    mctx.shadowColor = 'rgba(255,255,255,0.9)';
    mctx.shadowBlur = 7;
    paintColumnText(mctx, 0, w, h, args.name, footer, null, '#ffffff', HERO_NAME_REGION);
    mctx.shadowBlur = 0;
    paintColumnText(mctx, 0, w, h, args.name, footer, null, '#000000', HERO_NAME_REGION);
    // A faint glow along the red tip's gold stripe ties the mask to the stick body.
    mctx.shadowBlur = 0;
    mctx.fillStyle = 'rgba(255,255,255,0.35)';
    mctx.fillRect(0, h * 0.15 + h * 0.004, w, Math.max(1, h * 0.0025));
  }
  const map = new CanvasTexture(mapCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const emissiveMap = new CanvasTexture(maskCanvas);
  emissiveMap.colorSpace = SRGBColorSpace;
  emissiveMap.anisotropy = 8;
  return { map, emissiveMap };
}
