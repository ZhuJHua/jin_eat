/** Local-calendar date helpers. All day keys are local YYYY-MM-DD. */

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a YYYY-MM-DD key into a local Date at noon (noon avoids DST edge cases). */
export function parseDayKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** Add whole days to a day key. */
export function addDays(key: string, delta: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + delta);
  return todayKey(d);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function weekdayZh(d: Date = new Date()): string {
  return WEEKDAYS[d.getDay()]!;
}

export function isFriday(d: Date = new Date()): boolean {
  return d.getDay() === 5;
}

/** Monday (as a day key) of the week containing `key`. */
export function mondayOf(key: string): string {
  const d = parseDayKey(key);
  const offset = (d.getDay() + 6) % 7;
  return addDays(key, -offset);
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 1..99 → 一…九十九 (0 → 零). Out-of-range values fall back to arabic digits. */
export function toChineseNumeral(n: number): string {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v < 0 || v > 99) return String(n);
  if (v < 10) return DIGITS[v]!;
  const tens = Math.floor(v / 10);
  const ones = v % 10;
  const head = tens === 1 ? '十' : DIGITS[tens]! + '十';
  return ones === 0 ? head : head + DIGITS[ones]!;
}

/** 「10月12日」 */
export function shortDateZh(key: string): string {
  const d = parseDayKey(key);
  if (Number.isNaN(d.getTime())) return key;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
