/**
 * Randomness.
 * - `cryptoSource`: unbiased crypto randomness for normal draws.
 * - `sfc32FromString`: seeded, reproducible stream for team mode and per-day copy.
 */

export interface RandomSource {
  nextUint32(): number;
}

const TWO_32 = 4294967296;

let warnedNoCrypto = false;
const BUF_SIZE = 64;
const buf = new Uint32Array(BUF_SIZE);
let bufPos = BUF_SIZE;

function cryptoUint32(): number {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    if (bufPos >= BUF_SIZE) {
      c.getRandomValues(buf);
      bufPos = 0;
    }
    return buf[bufPos++]!;
  }
  if (!warnedNoCrypto) {
    warnedNoCrypto = true;
    console.warn('[rng] crypto.getRandomValues unavailable; falling back to Math.random');
  }
  return Math.floor(Math.random() * TWO_32) >>> 0;
}

export const cryptoSource: RandomSource = { nextUint32: cryptoUint32 };

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** FNV-1a 32-bit over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  if (encoder) {
    const bytes = encoder.encode(s);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
  } else {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** Small Fast Counting PRNG (sfc32). */
export function sfc32(a: number, b: number, c: number, d: number): RandomSource {
  let A = a >>> 0;
  let B = b >>> 0;
  let C = c >>> 0;
  let D = d >>> 0;
  return {
    nextUint32(): number {
      let t = (A + B) | 0;
      A = B ^ (B >>> 9);
      B = (C + (C << 3)) | 0;
      C = (C << 21) | (C >>> 11);
      D = (D + 1) | 0;
      t = (t + D) | 0;
      C = (C + t) | 0;
      return t >>> 0;
    },
  };
}

/** sfc32 seeded from fnv(seed), fnv(seed#1..#3); discards 12 warm-up outputs plus `skip`. */
export function sfc32FromString(seed: string, skip = 0): RandomSource {
  const src = sfc32(fnv1a32(seed), fnv1a32(seed + '#1'), fnv1a32(seed + '#2'), fnv1a32(seed + '#3'));
  const n = 12 + Math.max(0, Math.floor(skip));
  for (let i = 0; i < n; i++) src.nextUint32();
  return src;
}

/** Unbiased integer in [0, n) via rejection sampling. */
export function uniformInt(n: number, src: RandomSource = cryptoSource): number {
  const m = Math.floor(n);
  if (!(m >= 1)) throw new RangeError(`uniformInt: n must be >= 1 (got ${n})`);
  if (m === 1) return 0;
  if (m > TWO_32) throw new RangeError('uniformInt: n too large');
  const limit = Math.floor(TWO_32 / m) * m;
  for (;;) {
    const x = src.nextUint32();
    if (x < limit) return x % m;
  }
}

/** Float in [0, 1) with 53 bits of randomness (two uint32 draws). */
export function uniformFloat(src: RandomSource = cryptoSource): number {
  const a = src.nextUint32() >>> 5; // 27 bits
  const b = src.nextUint32() >>> 6; // 26 bits
  return (a * 67108864 + b) / 9007199254740992;
}

/**
 * Weighted pick by cumulative sum. Non-finite / negative weights count as 0.
 * If every weight is 0 the pick is uniform. Returns -1 only for an empty list.
 */
export function weightedPick<T>(items: readonly T[], weight: (t: T) => number, src: RandomSource = cryptoSource): number {
  const n = items.length;
  if (n === 0) return -1;
  let total = 0;
  const ws = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const w = weight(items[i]!);
    const v = Number.isFinite(w) && w > 0 ? w : 0;
    ws[i] = v;
    total += v;
  }
  if (total <= 0) return uniformInt(n, src);
  const r = uniformFloat(src) * total;
  let acc = 0;
  let lastPositive = 0;
  for (let i = 0; i < n; i++) {
    const v = ws[i]!;
    if (v <= 0) continue;
    lastPositive = i;
    acc += v;
    if (r < acc) return i;
  }
  return lastPositive;
}

/** True with probability p. */
export function chance(p: number, src: RandomSource = cryptoSource): boolean {
  return uniformFloat(src) < p;
}

/** RFC 4122 v4 uuid that also works outside secure contexts (crypto.randomUUID needs HTTPS). */
export function uuid(src: RandomSource = cryptoSource): string {
  const c = globalThis.crypto;
  if (src === cryptoSource && c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const hex: string[] = [];
  for (let i = 0; i < 4; i++) hex.push(src.nextUint32().toString(16).padStart(8, '0'));
  const s = hex.join('').split('');
  s[12] = '4';
  s[16] = '89ab'[parseInt(s[16]!, 16) & 3]!;
  const h = s.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
