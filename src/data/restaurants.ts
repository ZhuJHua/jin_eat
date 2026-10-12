import type { Restaurant } from '@/types';
import { fnv1a32 } from '@/lib/rng';

export interface RestaurantMeta {
  tagline: string;
}

const def = (id: string, name: string): Restaurant => ({ id, name, weight: 1, closedOn: null });

/** The 9 house favourites. Ids are stable: copy, tests and team signatures depend on them. */
export const DEFAULT_RESTAURANTS: Restaurant[] = [
  def('xiaogu', '小谷姐姐'),
  def('hmj', '黄焖鸡'),
  def('plaza', '美食广场'),
  def('datong', '大同'),
  def('gaima', '盖码帮'),
  def('jxxc', '江西小炒'),
  def('jianggu', '犟骨头'),
  def('daoxiang', '稻香'),
  def('xbf', '西北风'),
];

export const RESTAURANT_META: Record<string, RestaurantMeta> = {
  xiaogu: { tagline: '家常味，姐姐的手艺' },
  hmj: { tagline: '酱汁拌饭第三碗' },
  plaza: { tagline: '选择困难终极解法' },
  datong: { tagline: '天下大同，饭量也同' },
  gaima: { tagline: '一勺浇头盖满碗' },
  jxxc: { tagline: '辣是礼貌' },
  jianggu: { tagline: '啃得越犟下午越强' },
  daoxiang: { tagline: '稻花香里说丰年' },
  xbf: { tagline: '别人喝风我吃面' },
};

const NAME_TO_DEFAULT_ID: ReadonlyMap<string, string> = new Map(DEFAULT_RESTAURANTS.map((r) => [r.name, r.id]));

/**
 * Resolve the "copy id" of a restaurant: its own id when it is a default, or the default id
 * of a re-added restaurant with the same name (so a user who re-creates 黄焖鸡 keeps its poems).
 */
export function canonicalId(r: Pick<Restaurant, 'id' | 'name'>): string {
  if (RESTAURANT_META[r.id]) return r.id;
  return NAME_TO_DEFAULT_ID.get(r.name.trim()) ?? r.id;
}

export function taglineFor(r: Restaurant): string {
  const meta = RESTAURANT_META[canonicalId(r)];
  return meta ? meta.tagline : `锦少私藏 · ${r.name}`;
}

/** 4 hex chars fingerprint of the list names, in order. Shown in team mode so colleagues can compare. */
export function listSignature(list: Restaurant[]): string {
  return (fnv1a32(list.map((r) => r.name).join('\u0001')) & 0xffff).toString(16).padStart(4, '0');
}

/** Fresh copy of the defaults (never hand out the shared array). */
export function defaultRestaurants(): Restaurant[] {
  return DEFAULT_RESTAURANTS.map((r) => ({ ...r }));
}

/** Character count in code points (names and copy limits are measured this way). */
export function charLen(s: string): number {
  return Array.from(s).length;
}
