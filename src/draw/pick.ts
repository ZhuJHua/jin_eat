/** Result selection. The RNG decides everything here; the 3D only performs it. */
import type { DayState, DrawResult, HistoryEntry, LevelId, Restaurant, Settings } from '@/types';
import { CFG } from '@/config';
import { listSignature } from '@/data/restaurants';
import { LEVEL_ORDER } from '@/data/fortunes';
import { chance, cryptoSource, sfc32FromString, uniformInt, uuid, weightedPick, type RandomSource } from '@/lib/rng';

export interface WeightRow {
  id: string;
  name: string;
  /** Effective (post-multiplier) weight. */
  weight: number;
  /** Probability in percent, 0–100. Rows sum to 100. */
  pct: number;
}

/** Outputs reserved per team draw; draw k of the day starts at output k·stride of the seeded stream. */
export const TEAM_STREAM_STRIDE = 16;

/** True when team mode is on with a usable phrase. */
export function isTeamActive(settings: Settings): boolean {
  return settings.teamMode && settings.teamPhrase.trim().length > 0;
}

export function normalizeTeamPhrase(phrase: string): string {
  return phrase.trim().toLowerCase();
}

/** Seed of today's team stream. */
export function teamSeed(today: string, phrase: string, list: Restaurant[]): string {
  return `${today}|${normalizeTeamPhrase(phrase)}|${listSignature(list)}`;
}

/**
 * Final pick of each draw-day, newest first. A day's final is its newest confirmed entry, otherwise
 * its newest entry that was not vetoed or rejected by 阴筊.
 */
export function dayFinals(history: HistoryEntry[]): { date: string; restaurantId: string }[] {
  const byDate = new Map<string, { confirmed: HistoryEntry | null; latest: HistoryEntry | null }>();
  for (const e of history) {
    const rejected = e.vetoed || (!e.confirmed && e.jiaobei.includes('yin'));
    if (rejected) continue;
    const slot = byDate.get(e.draw.date) ?? { confirmed: null, latest: null };
    if (!slot.latest || e.draw.ts > slot.latest.draw.ts) slot.latest = e;
    if (e.confirmed && (!slot.confirmed || e.draw.ts > slot.confirmed.draw.ts)) slot.confirmed = e;
    byDate.set(e.draw.date, slot);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, s]) => ({ date, restaurantId: (s.confirmed ?? s.latest)!.draw.restaurantId }));
}

function toRows(list: Restaurant[], weights: number[]): WeightRow[] {
  const total = weights.reduce((a, b) => a + b, 0);
  return list.map((r, i) => {
    const w = weights[i]!;
    return { id: r.id, name: r.name, weight: w, pct: total > 0 ? (w / total) * 100 : 0 };
  });
}

/** Effective weights and percentages for the 天机 panel and the pick. */
export function computeWeights(args: {
  list: Restaurant[];
  history: HistoryEntry[];
  settings: Settings;
  day: DayState;
  today: string;
}): WeightRow[] {
  const { list, history, settings, day, today } = args;
  if (list.length === 0) return [];

  if (isTeamActive(settings))
    return toRows(
      list,
      list.map(() => 1),
    );

  const excluded = day.date === today ? new Set(day.excluded) : new Set<string>();
  const base = list.map((r) => {
    if (r.closedOn === today) return 0;
    if (excluded.has(r.id)) return 0;
    const w = Number.isFinite(r.weight) ? r.weight : 1;
    return Math.max(0, Math.min(3, w));
  });

  if (settings.antiRepeat) {
    // Rank past days only: today's unconfirmed throwaway draws must not push yesterday's meal back.
    const finals = dayFinals(history.filter((e) => e.draw.date < today));
    const rank = new Map<string, number>();
    finals.forEach((f, i) => {
      if (!rank.has(f.restaurantId)) rank.set(f.restaurantId, i);
    });
    const ar = CFG.antiRepeat;
    list.forEach((r, i) => {
      const k = rank.get(r.id);
      let m = 1;
      if (k === 0) m = ar.last;
      else if (k !== undefined && k < ar.recentDays) m = ar.recent;
      else if (k === undefined || k >= ar.coldDays) m = ar.coldBonus;
      base[i] = base[i]! * m;
    });
  }

  if (base.some((w) => w > 0)) return toRows(list, base);

  // Fallbacks: uniform over open entries, else over everything (「全关门了？」).
  const open = list.map((r) => (r.closedOn === today ? 0 : 1));
  if (open.some((w) => w > 0)) return toRows(list, open);
  return toRows(
    list,
    list.map(() => 1),
  );
}

/** Every entry in the list is marked closed today. */
export function allClosed(list: Restaurant[], today: string): boolean {
  return list.length > 0 && list.every((r) => r.closedOn === today);
}

function rollLevel(src: RandomSource): LevelId {
  const odds = CFG.odds.level;
  const i = weightedPick(LEVEL_ORDER, (l) => odds[l], src);
  return LEVEL_ORDER[Math.max(0, i)]!;
}

/**
 * Pick today's stick. Rolls happen in the fixed order index → level → treat → tease → decoy,
 * always consuming the same rolls (so reduced motion on one device doesn't desync team mode).
 */
export function pickDraw(args: {
  list: Restaurant[];
  history: HistoryEntry[];
  settings: Settings;
  day: DayState;
  today: string;
  reducedMotion: boolean;
}): DrawResult {
  const { list, settings, day, today, reducedMotion } = args;
  if (list.length === 0) throw new Error('pickDraw: empty restaurant list');

  const team = isTeamActive(settings);
  const teamCount = day.date === today ? day.teamDrawCount : 0;
  const src: RandomSource = team
    ? sfc32FromString(teamSeed(today, settings.teamPhrase, list), teamCount * TEAM_STREAM_STRIDE)
    : cryptoSource;

  const rows = computeWeights(args);
  const n = list.length;
  const index = Math.max(
    0,
    weightedPick(rows, (r) => r.weight, src),
  );
  const level = rollLevel(src);
  const treat = chance(CFG.odds.treat, src);
  const teaseRoll = chance(CFG.odds.tease, src);
  const decoyRoll = n >= 2 ? uniformInt(n - 1, src) : 0;
  const tease = teaseRoll && !reducedMotion && n >= 2;
  const decoy = decoyRoll >= index ? decoyRoll + 1 : decoyRoll;
  const r = list[index]!;

  const weightsPct: Record<string, number> = {};
  for (const row of rows) weightsPct[row.id] = Math.round(row.pct * 100) / 100;

  return {
    id: uuid(),
    date: today,
    ts: Date.now(),
    restaurantId: r.id,
    restaurantName: r.name,
    index,
    stickNo: index + 1,
    level,
    treat,
    tease,
    decoyIndex: tease ? decoy : null,
    team: team ? settings.teamPhrase.trim() : null,
    weightsPct,
  };
}
