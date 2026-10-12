/**
 * 签文 share card: an offscreen 1080×1440 canvas on procedural red paper, delivered through
 * the Web Share API with a file when possible, otherwise downloaded as a PNG.
 */
import type { DrawResult, FortuneCopy } from '@/types';
import { COPY } from '@/data/copy';
import { LEVELS } from '@/data/fortunes';
import { shortDateZh, parseDayKey, toChineseNumeral, weekdayZh } from '@/lib/date';
import { sfc32FromString, uniformFloat, type RandomSource } from '@/lib/rng';
import { loadBrushFontCss } from '@/lib/fonts';

const W = 1080;
const H = 1440;
const BRUSH = "'Ma Shan Zheng', 'STKaiti', 'KaiTi', serif";
const SANS = "'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";

const GOLD = '#f0c766';
const PAPER = '#fbeed2';

/** Site URL used on the card and in the share text (team links carry `#team=`). */
export function siteUrl(): string {
  if (typeof location === 'undefined') return '';
  return `${location.origin}/`;
}

export function teamLink(phrase: string): string {
  return `${siteUrl()}#team=${encodeURIComponent(phrase.trim())}`;
}

/** 锦少灵签第七签：黄焖鸡，上上签。{jie} {url} */
export function shareText(draw: DrawResult, copy: FortuneCopy, url: string): string {
  return COPY.share.text(toChineseNumeral(draw.stickNo), draw.restaurantName, LEVELS[draw.level].label, copy.jie, url).trim();
}

function shareUrlFor(draw: DrawResult): string {
  return draw.team ? teamLink(draw.team) : siteUrl();
}

// ───────────────────────────── fonts ─────────────────────────────

async function ensureFonts(text: string): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const load = loadBrushFontCss()
    .then(() => Promise.all([fonts.load(`220px "Ma Shan Zheng"`, text), fonts.load(`40px "Ma Shan Zheng"`, text)]))
    .then(() => undefined);
  await Promise.race([load.catch(() => undefined), new Promise<void>((r) => setTimeout(r, 2500))]);
}

// ───────────────────────────── paper ─────────────────────────────

/** 2D value noise with smoothstep interpolation on a seeded lattice. */
function makeValueNoise(src: RandomSource, size = 64): (x: number, y: number) => number {
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = uniformFloat(src);
  const at = (x: number, y: number): number => lattice[((y & (size - 1)) * size + (x & (size - 1))) >>> 0]!;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function paperTexture(src: RandomSource): HTMLCanvasElement {
  const w = W / 4;
  const h = H / 4;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const noise = makeValueNoise(src);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // fbm: broad mottling + fine grain + horizontal fibres
      const n = noise(x / 40, y / 40) * 0.5 + noise(x / 12, y / 12) * 0.25 + noise(x / 4, y / 4) * 0.15 + noise(x / 30, y / 2.2) * 0.1;
      const v = Math.round(n * 255);
      const o = (y * w + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawBackground(ctx: CanvasRenderingContext2D, src: RandomSource): void {
  const base = ctx.createRadialGradient(W * 0.5, H * 0.38, 80, W * 0.5, H * 0.5, H * 0.78);
  base.addColorStop(0, '#c81e27');
  base.addColorStop(0.55, '#a0121a');
  base.addColorStop(1, '#5c070d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const tex = paperTexture(src);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.42;
  ctx.drawImage(tex, 0, 0, W, H);
  ctx.restore();

  // Long paper fibres.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  for (let i = 0; i < 220; i++) {
    const x = uniformFloat(src) * W;
    const y = uniformFloat(src) * H;
    const len = 20 + uniformFloat(src) * 70;
    const a = (uniformFloat(src) - 0.5) * 0.8;
    ctx.strokeStyle = uniformFloat(src) < 0.5 ? 'rgba(255,230,200,0.35)' : 'rgba(60,0,0,0.3)';
    ctx.lineWidth = 0.6 + uniformFloat(src) * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + 4, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  // Gold flecks (洒金).
  ctx.save();
  for (let i = 0; i < 140; i++) {
    const x = uniformFloat(src) * W;
    const y = uniformFloat(src) * H;
    const r = 0.8 + uniformFloat(src) * 2.6;
    ctx.globalAlpha = 0.25 + uniformFloat(src) * 0.5;
    ctx.fillStyle = uniformFloat(src) < 0.7 ? '#f6d27a' : '#fff1c0';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r, uniformFloat(src) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Vignette.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(30,0,4,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function goldGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#fff0b8');
  g.addColorStop(0.35, GOLD);
  g.addColorStop(0.7, '#c98d2c');
  g.addColorStop(1, '#ffe39a');
  return g;
}

/** 回纹 corner ornament. */
function cornerFret(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number): void {
  const u = 14;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.moveTo(0, 5 * u);
  ctx.lineTo(0, 0);
  ctx.lineTo(5 * u, 0);
  ctx.moveTo(u, 4 * u);
  ctx.lineTo(u, u);
  ctx.lineTo(4 * u, u);
  ctx.lineTo(4 * u, 2.6 * u);
  ctx.lineTo(2.4 * u, 2.6 * u);
  ctx.lineTo(2.4 * u, 2 * u);
  ctx.stroke();
  ctx.restore();
}

function drawBorder(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.lineWidth = 8;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(54, 54, W - 108, H - 108);
  ctx.lineWidth = 3;
  ctx.strokeStyle = GOLD;
  cornerFret(ctx, 70, 70, 1, 1);
  cornerFret(ctx, W - 70, 70, -1, 1);
  cornerFret(ctx, 70, H - 70, 1, -1);
  cornerFret(ctx, W - 70, H - 70, -1, -1);
  ctx.restore();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, max: number, maxWidth: number): number {
  let size = max;
  for (; size > 40; size -= 6) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Square cinnabar seal with worn edges, characters in two columns right-to-left. */
function drawSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, text: string, src: RandomSource): void {
  let chars = Array.from(text);
  if (chars.length % 2 === 1) chars = [...chars, '印'];
  const half = Math.ceil(chars.length / 2);
  const right = chars.slice(0, half);
  const left = chars.slice(half);
  const w = size;
  const h = size * (0.35 + half * 0.3);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.1);
  // Paper-coloured seal on red: draw a pale "stamp" plate first so the seal reads on the red card.
  ctx.fillStyle = 'rgba(251,238,210,0.92)';
  ctx.fillRect(-w / 2 - 10, -h / 2 - 10, w + 20, h + 20);
  ctx.fillStyle = '#b3121b';
  ctx.beginPath();
  const jag = (v: number): number => v + (uniformFloat(src) - 0.5) * 3;
  const steps = 18;
  for (let i = 0; i <= steps; i++) ctx.lineTo(jag(-w / 2 + (w * i) / steps), jag(-h / 2));
  for (let i = 0; i <= steps; i++) ctx.lineTo(jag(w / 2), jag(-h / 2 + (h * i) / steps));
  for (let i = steps; i >= 0; i--) ctx.lineTo(jag(-w / 2 + (w * i) / steps), jag(h / 2));
  for (let i = steps; i >= 0; i--) ctx.lineTo(jag(-w / 2), jag(-h / 2 + (h * i) / steps));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18);
  const cell = (h - 30) / half;
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(cell * 0.86)}px ${BRUSH}`;
  right.forEach((c, i) => ctx.fillText(c, w * 0.23, -h / 2 + 15 + cell * (i + 0.5)));
  left.forEach((c, i) => ctx.fillText(c, -w * 0.23, -h / 2 + 15 + cell * (i + 0.5)));
  // Wear: knock out speckles.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.3 + uniformFloat(src) * 0.6;
    ctx.beginPath();
    ctx.arc((uniformFloat(src) - 0.5) * w, (uniformFloat(src) - 0.5) * h, 0.6 + uniformFloat(src) * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────────── card ─────────────────────────────

function drawCard(ctx: CanvasRenderingContext2D, draw: DrawResult, copy: FortuneCopy, url: string): void {
  const src = sfc32FromString(`card|${draw.id}`);
  drawBackground(ctx, src);
  drawBorder(ctx);

  const no = toChineseNumeral(draw.stickNo);
  const level = LEVELS[draw.level].label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Header: 锦少灵签 + 第七签 · 上上签
  ctx.fillStyle = 'rgba(251,238,210,0.75)';
  ctx.font = `34px ${BRUSH}`;
  ctx.fillText(`${COPY.app.temple} · ${COPY.app.medallion}`, W / 2, 132);
  ctx.save();
  ctx.font = `70px ${BRUSH}`;
  ctx.fillStyle = goldGradient(ctx, W * 0.3, 160, W * 0.7, 240);
  ctx.shadowColor = 'rgba(40,0,0,0.6)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillText(`第${no}签 · ${level}`, W / 2, 214);
  ctx.restore();

  // Badges: team / treat
  if (draw.team || draw.treat) {
    const label = draw.treat ? COPY.reveal.treatBadge : `${COPY.reveal.teamBadge} · ${draw.team ?? ''}`;
    ctx.font = `30px ${SANS}`;
    const tw = Math.min(ctx.measureText(label).width + 56, W - 220);
    ctx.fillStyle = draw.treat ? 'rgba(255,225,140,0.95)' : 'rgba(26,11,20,0.55)';
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    const bx = W / 2 - tw / 2;
    ctx.beginPath();
    ctx.roundRect(bx, 238, tw, 48, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = draw.treat ? '#5a1a00' : PAPER;
    ctx.fillText(label, W / 2, 272, tw - 40);
  }

  // Divider
  ctx.strokeStyle = 'rgba(240,199,102,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(220, 312);
  ctx.lineTo(W - 220, 312);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.save();
  ctx.translate(W / 2, 312);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-7, -7, 14, 14);
  ctx.restore();

  // Name, huge brush with gold fill.
  const nameSize = fitFont(ctx, draw.restaurantName, BRUSH, 200, W - 200);
  ctx.save();
  ctx.font = `${nameSize}px ${BRUSH}`;
  ctx.shadowColor = 'rgba(50,0,0,0.7)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = goldGradient(ctx, 0, 380, 0, 380 + nameSize);
  ctx.fillText(draw.restaurantName, W / 2, 330 + nameSize * 0.92);
  ctx.restore();

  // Vertical poem: 4 columns, right to left, on a pale panel.
  const panelTop = 552;
  const charSize = 44;
  const lineGap = 50;
  const colGap = 92;
  const panelH = 7 * lineGap + 48;
  ctx.save();
  ctx.fillStyle = 'rgba(251,238,210,0.93)';
  ctx.shadowColor = 'rgba(30,0,0,0.45)';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.roundRect(W / 2 - 250, panelTop, 500, panelH, 10);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(179,18,27,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 236, panelTop + 14, 472, panelH - 28);
  ctx.font = `${charSize}px ${BRUSH}`;
  ctx.fillStyle = '#2b130d';
  ctx.textBaseline = 'middle';
  copy.poem.forEach((line, col) => {
    const x = W / 2 + colGap * 1.5 - col * colGap;
    Array.from(line).forEach((ch, row) => {
      ctx.fillText(ch, x, panelTop + 24 + lineGap * (row + 0.5));
    });
    if (col < 3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,40,20,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - colGap / 2, panelTop + 30);
      ctx.lineTo(x - colGap / 2, panelTop + panelH - 30);
      ctx.stroke();
      ctx.restore();
    }
  });
  ctx.textBaseline = 'alphabetic';

  // 解曰
  let y = panelTop + panelH + 70;
  ctx.textAlign = 'left';
  ctx.font = `46px ${BRUSH}`;
  ctx.fillStyle = GOLD;
  ctx.fillText(COPY.reveal.jieLabel, 130, y);
  ctx.font = `38px ${SANS}`;
  ctx.fillStyle = PAPER;
  const lines = wrapLines(ctx, copy.jie, W - 260 - 110);
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, 240, y + i * 48));
  y += (Math.min(lines.length, 2) - 1) * 48 + 84;

  // 宜 / 忌
  const pill = (x: number, mark: string, text: string, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y - 44, 60, 60, 10);
    ctx.fill();
    ctx.font = `44px ${BRUSH}`;
    ctx.fillStyle = PAPER;
    ctx.textAlign = 'center';
    ctx.fillText(mark, x + 30, y + 2);
    ctx.textAlign = 'left';
    ctx.font = `36px ${SANS}`;
    ctx.fillText(text, x + 80, y);
  };
  pill(130, COPY.reveal.yiLabel, copy.yi, '#2f6b4f');
  y += 74;
  pill(130, COPY.reveal.jiLabel, copy.ji, '#2a1a18');

  // Seal (bottom right) and footer.
  drawSeal(ctx, W - 180, H - 245, 132, COPY.app.committee, src);

  ctx.textAlign = 'left';
  ctx.font = `30px ${BRUSH}`;
  ctx.fillStyle = 'rgba(251,238,210,0.9)';
  const date = parseDayKey(draw.date);
  ctx.fillText(`${shortDateZh(draw.date)} ${Number.isNaN(date.getTime()) ? '' : weekdayZh(date)} · ${COPY.app.credit}`, 160, H - 172);
  ctx.font = `28px ${SANS}`;
  ctx.fillStyle = 'rgba(251,238,210,0.7)';
  ctx.fillText(COPY.share.footer, 160, H - 132);
  ctx.fillStyle = 'rgba(240,199,102,0.85)';
  ctx.fillText(url.replace(/^https?:\/\//, ''), 160, H - 96, W - 460);

  // Gold dust burst behind the name for 上上 / 请客.
  if (draw.level === 'shangshang' || draw.treat) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const a = uniformFloat(src) * Math.PI * 2;
      const r = 200 + uniformFloat(src) * 260;
      ctx.globalAlpha = 0.15 + uniformFloat(src) * 0.35;
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * r, 440 + Math.sin(a) * r * 0.45, 1.5 + uniformFloat(src) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Render the share card to a PNG blob. */
export async function renderShareCard(args: { draw: DrawResult; copy: FortuneCopy; url: string }): Promise<Blob> {
  const { draw, copy, url } = args;
  await ensureFonts(
    `${draw.restaurantName}${copy.poem.join('')}${copy.jie}${copy.yi}${copy.ji}${COPY.app.committee}印第签上中吉小下${COPY.app.temple}${COPY.app.medallion}${COPY.reveal.jieLabel}${COPY.reveal.yiLabel}${COPY.reveal.jiLabel}${COPY.app.credit}${COPY.share.footer}${COPY.reveal.treatBadge}${COPY.reveal.teamBadge}${draw.team ?? ''}0123456789月日周一二三四五六七八九十`,
  );
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  drawCard(ctx, draw, copy, url);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function fileName(draw: DrawResult): string {
  return `锦少灵签-${draw.date}-${draw.restaurantName}.png`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Share the card image (Web Share with files) or download it. */
export async function shareDraw(args: {
  draw: DrawResult;
  copy: FortuneCopy;
  blob?: Blob;
}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { draw, copy } = args;
  const url = shareUrlFor(draw);
  const blob = args.blob ?? (await renderShareCard({ draw, copy, url }));
  const text = shareText(draw, copy, url);
  const file = typeof File !== 'undefined' ? new File([blob], fileName(draw), { type: 'image/png' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, title: COPY.app.title });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Some browsers reject file shares at runtime; fall back to a download.
    }
  }
  download(blob, fileName(draw));
  return 'downloaded';
}

/** Download only (desktop 「保存图片」). */
export function downloadCard(draw: DrawResult, blob: Blob): void {
  download(blob, fileName(draw));
}

/** Text + URL for the current draw (used by 复制文字). */
export function shareTextFor(draw: DrawResult, copy: FortuneCopy): string {
  return shareText(draw, copy, shareUrlFor(draw));
}
