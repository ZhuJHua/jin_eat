/**
 * App store (zustand 5 + persist).
 *
 * - Persisted slice: restaurants, settings, history (newest FIRST, ≤ 60), day.
 * - `phaseSince` uses performance.now() (same clock as rAF timestamps and rt.*Ts fields).
 * - `toast.until` uses Date.now().
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type {
  DayState,
  Drawer,
  DrawResult,
  FortuneCopy,
  HistoryEntry,
  InputMode,
  JiaobeiOutcome,
  Phase,
  QualityTier,
  Restaurant,
  SensorStatus,
  Settings,
  Toast,
} from '@/types';
import { CFG } from '@/config';
import { charLen, defaultRestaurants } from '@/data/restaurants';
import { bus, EMPTY } from '@/lib/bus';
import { todayKey } from '@/lib/date';
import { uuid } from '@/lib/rng';
import { safeStorage } from '@/lib/storage';
import { resizeSticks } from '@/state/runtime';

export interface GateState {
  needed: boolean;
  status: SensorStatus;
  inputMode: InputMode;
  hint: string | null;
}

export interface AppState {
  phase: Phase;
  phaseSince: number;
  drawer: Drawer | null;
  gate: GateState;
  tier: QualityTier;
  dpr: number;
  webgl: 'ok' | 'none' | 'lost';
  /** Effective (settings + media query). */
  reducedMotion: boolean;
  /** Throttled ≤ 10 Hz copy of rt.shake.meter for the DOM. */
  meterMirror: number;
  hoverStickId: string | null;
  pending: DrawResult | null;
  current: DrawResult | null;
  copy: FortuneCopy | null;
  jiaobeiResult: JiaobeiOutcome | null;
  toast: Toast | null;
  // persisted
  restaurants: Restaurant[];
  settings: Settings;
  history: HistoryEntry[];
  day: DayState;
}

export type AddResult = { ok: true } | { ok: false; reason: 'empty' | 'dup' | 'max' | 'long' };

export interface AppActions {
  setPhase(p: Phase): void;
  setGate(patch: Partial<GateState>): void;
  setTier(t: QualityTier): void;
  setDpr(d: number): void;
  setWebgl(s: AppState['webgl']): void;
  setReducedMotion(v: boolean): void;
  setMeterMirror(v: number): void;
  setHoverStick(id: string | null): void;
  setPending(d: DrawResult | null): void;
  setCurrent(d: DrawResult | null, copy: FortuneCopy | null): void;
  setCopy(c: FortuneCopy): void;
  setJiaobeiResult(r: JiaobeiOutcome | null): void;
  openDrawer(d: Drawer): void;
  closeDrawer(): void;
  showToast(text: string, ms?: number): void;
  hideToast(): void;
  addRestaurant(name: string): AddResult;
  renameRestaurant(id: string, name: string): { ok: boolean; reason?: string };
  removeRestaurant(id: string): { ok: boolean; reason?: 'min' };
  moveRestaurant(id: string, delta: -1 | 1): void;
  setRestaurantWeight(id: string, w: number): void;
  toggleClosedToday(id: string): void;
  resetRestaurants(): void;
  updateSettings(patch: Partial<Settings>): void;
  pushHistory(e: HistoryEntry): void;
  patchHistory(drawId: string, patch: Partial<HistoryEntry>): void;
  clearHistory(): void;
  /** Auto-rolls DayState when the date changed (ensureToday) before applying the patch. */
  patchDay(patch: Partial<DayState>): void;
}

export type Store = AppState & AppActions;

export const STORE_KEY = 'jinshao-lunch-v1';
export const STORE_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  antiRepeat: true,
  ritualJiaobei: true,
  lowMotion: 'system',
  motionSensitivity: 'mid',
  quality: 'auto',
  teamMode: false,
  teamPhrase: '',
  motionStatus: 'unknown',
};

export function freshDay(date: string = todayKey()): DayState {
  return { date, lockedDrawId: null, vetoUsed: false, teamDrawCount: 0, excluded: [], xiaoStreak: 0 };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** prefers-reduced-motion media query (null outside the browser). */
export function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  } catch {
    return null;
  }
}

/** Effective reduced motion from the 低晕模式 setting and the system preference. */
export function computeReducedMotion(settings: Pick<Settings, 'lowMotion'>, systemPrefers?: boolean): boolean {
  if (settings.lowMotion === 'on') return true;
  if (settings.lowMotion === 'off') return false;
  return systemPrefers ?? reducedMotionQuery()?.matches ?? false;
}

// ───────────────────────────── validation ─────────────────────────────

const LEVEL_IDS = new Set(['shangshang', 'shang', 'zhongji', 'xiaoji', 'xiaxia']);
const SENSOR = new Set<SensorStatus>(['unknown', 'insecure', 'unsupported', 'granted', 'denied', 'silent', 'not-required']);

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1;
  return Math.max(0, Math.min(3, Math.round(w * 2) / 2));
}

function newRestaurantId(): string {
  return 'r-' + uuid().replace(/-/g, '').slice(0, 8);
}

function sanitizeRestaurants(v: unknown): Restaurant[] {
  if (!Array.isArray(v)) return defaultRestaurants();
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: Restaurant[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<Restaurant>;
    const name = typeof r.name === 'string' ? normalizeName(r.name) : '';
    if (!name || charLen(name) > CFG.limits.nameMax || seen.has(name)) continue;
    let id = typeof r.id === 'string' && r.id ? r.id : newRestaurantId();
    if (ids.has(id)) id = newRestaurantId();
    seen.add(name);
    ids.add(id);
    out.push({
      id,
      name,
      weight: clampWeight(typeof r.weight === 'number' ? r.weight : 1),
      closedOn: typeof r.closedOn === 'string' ? r.closedOn : null,
    });
    if (out.length >= CFG.limits.maxRestaurants) break;
  }
  return out.length >= CFG.limits.minRestaurants ? out : defaultRestaurants();
}

function sanitizeSettings(v: unknown): Settings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Settings>;
  const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
  return {
    sound: bool(s.sound, DEFAULT_SETTINGS.sound),
    haptics: bool(s.haptics, DEFAULT_SETTINGS.haptics),
    antiRepeat: bool(s.antiRepeat, DEFAULT_SETTINGS.antiRepeat),
    ritualJiaobei: bool(s.ritualJiaobei, DEFAULT_SETTINGS.ritualJiaobei),
    lowMotion: s.lowMotion === 'on' || s.lowMotion === 'off' || s.lowMotion === 'system' ? s.lowMotion : 'system',
    // Added after v1 shipped: older saves lack it and fall back to 'mid' here (no version bump needed).
    motionSensitivity: s.motionSensitivity === 'low' || s.motionSensitivity === 'high' ? s.motionSensitivity : 'mid',
    quality:
      s.quality === 'low' || s.quality === 'mid' || s.quality === 'high' || s.quality === 'flat' || s.quality === 'auto'
        ? s.quality
        : 'auto',
    teamMode: bool(s.teamMode, false),
    teamPhrase: typeof s.teamPhrase === 'string' ? s.teamPhrase.slice(0, 40) : '',
    motionStatus: typeof s.motionStatus === 'string' && SENSOR.has(s.motionStatus) ? s.motionStatus : 'unknown',
  };
}

function isEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as HistoryEntry;
  return (
    !!x.draw &&
    typeof x.draw.id === 'string' &&
    typeof x.draw.date === 'string' &&
    typeof x.draw.restaurantId === 'string' &&
    typeof x.draw.restaurantName === 'string' &&
    typeof x.draw.ts === 'number' &&
    LEVEL_IDS.has(x.draw.level) &&
    !!x.copy &&
    Array.isArray(x.copy.poem) &&
    x.copy.poem.length === 4 &&
    typeof x.copy.jie === 'string'
  );
}

function sanitizeHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isEntry)
    .map((e) => ({
      ...e,
      copy: { ...e.copy, source: 'local' as const },
      confirmed: !!e.confirmed,
      vetoed: !!e.vetoed,
      jiaobei: Array.isArray(e.jiaobei) ? e.jiaobei.filter((j) => j === 'sheng' || j === 'xiao' || j === 'yin') : [],
    }))
    .sort((a, b) => b.draw.ts - a.draw.ts)
    .slice(0, CFG.limits.historyMax);
}

function sanitizeDay(v: unknown): DayState {
  const today = todayKey();
  const d = (v && typeof v === 'object' ? v : {}) as Partial<DayState>;
  if (d.date !== today) return freshDay(today);
  return {
    date: today,
    lockedDrawId: typeof d.lockedDrawId === 'string' ? d.lockedDrawId : null,
    vetoUsed: !!d.vetoUsed,
    teamDrawCount: typeof d.teamDrawCount === 'number' && d.teamDrawCount >= 0 ? Math.floor(d.teamDrawCount) : 0,
    excluded: Array.isArray(d.excluded) ? d.excluded.filter((x): x is string => typeof x === 'string') : [],
    xiaoStreak: typeof d.xiaoStreak === 'number' ? d.xiaoStreak : 0,
  };
}

type Persisted = Pick<AppState, 'restaurants' | 'settings' | 'history' | 'day'>;

export function sanitizePersisted(v: unknown): Persisted {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Persisted>;
  return {
    restaurants: sanitizeRestaurants(p.restaurants),
    settings: sanitizeSettings(p.settings),
    history: sanitizeHistory(p.history),
    day: sanitizeDay(p.day),
  };
}

// ───────────────────────────── store ─────────────────────────────

let toastSeq = 1;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function initialState(): AppState {
  const settings = { ...DEFAULT_SETTINGS };
  return {
    phase: 'boot',
    phaseSince: now(),
    drawer: null,
    gate: { needed: false, status: 'unknown', inputMode: 'pointer', hint: null },
    tier: 1,
    dpr: 1,
    webgl: 'ok',
    reducedMotion: computeReducedMotion(settings),
    meterMirror: 0,
    hoverStickId: null,
    pending: null,
    current: null,
    copy: null,
    jiaobeiResult: null,
    toast: null,
    restaurants: defaultRestaurants(),
    settings,
    history: [],
    day: freshDay(),
  };
}

/** Current day state, rolled over when the date changed. */
function rolledDay(day: DayState, today: string): DayState {
  return day.date === today ? day : freshDay(today);
}

/**
 * zustand `persist` writes on EVERY set() (including the 10 Hz meter mirror and hover churn).
 * Skip the stringify + localStorage write when none of the persisted references changed.
 */
function dedupedStorage(): PersistStorage<Persisted> {
  const inner = createJSONStorage<Persisted>(() => safeStorage)!;
  let last: StorageValue<Persisted> | null = null;
  return {
    getItem: (name) => inner.getItem(name),
    setItem: (name, value) => {
      const a = value.state;
      const b = last?.state;
      if (
        last &&
        b &&
        last.version === value.version &&
        a.restaurants === b.restaurants &&
        a.settings === b.settings &&
        a.history === b.history &&
        a.day === b.day
      ) {
        return;
      }
      last = value;
      return inner.setItem(name, value);
    },
    removeItem: (name) => {
      last = null;
      return inner.removeItem(name);
    },
  };
}

export const useStore: UseBoundStore<StoreApi<Store>> = create<Store>()(
  persist(
    (set, get) => {
      /** Apply a restaurant-list change: invalidates the pending pick and notifies the 3D. */
      const commitList = (restaurants: Restaurant[]): void => {
        set({ restaurants, pending: null });
        bus.emit('list-changed', EMPTY);
      };

      return {
        ...initialState(),

        setPhase(p) {
          if (get().phase === p) return;
          set({ phase: p, phaseSince: now() });
        },
        setGate(patch) {
          set({ gate: { ...get().gate, ...patch } });
        },
        setTier(t) {
          if (get().tier !== t) set({ tier: t });
        },
        setDpr(d) {
          if (get().dpr !== d) set({ dpr: d });
        },
        setWebgl(s) {
          if (get().webgl !== s) set({ webgl: s });
        },
        setReducedMotion(v) {
          if (get().reducedMotion !== v) set({ reducedMotion: v });
        },
        setMeterMirror(v) {
          set({ meterMirror: Math.max(0, Math.min(1, v)) });
        },
        setHoverStick(id) {
          if (get().hoverStickId !== id) set({ hoverStickId: id });
        },
        setPending(d) {
          set({ pending: d });
        },
        setCurrent(d, copy) {
          set({ current: d, copy });
        },
        setCopy(c) {
          set({ copy: c });
        },
        setJiaobeiResult(r) {
          set({ jiaobeiResult: r });
        },
        openDrawer(d) {
          set({ drawer: d, hoverStickId: null });
        },
        closeDrawer() {
          if (get().drawer !== null) set({ drawer: null });
        },
        showToast(text, ms = CFG.toastMs) {
          const toast: Toast = { id: toastSeq++, text, until: Date.now() + ms };
          set({ toast });
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => {
            if (get().toast?.id === toast.id) set({ toast: null });
          }, ms);
        },
        hideToast() {
          if (get().toast) set({ toast: null });
        },

        addRestaurant(name) {
          const list = get().restaurants;
          const n = normalizeName(name);
          if (!n) return { ok: false, reason: 'empty' };
          if (charLen(n) > CFG.limits.nameMax) return { ok: false, reason: 'long' };
          if (list.some((r) => r.name === n)) return { ok: false, reason: 'dup' };
          if (list.length >= CFG.limits.maxRestaurants) return { ok: false, reason: 'max' };
          commitList([...list, { id: newRestaurantId(), name: n, weight: 1, closedOn: null }]);
          return { ok: true };
        },
        renameRestaurant(id, name) {
          const list = get().restaurants;
          const n = normalizeName(name);
          if (!n) return { ok: false, reason: 'empty' };
          if (charLen(n) > CFG.limits.nameMax) return { ok: false, reason: 'long' };
          if (list.some((r) => r.name === n && r.id !== id)) return { ok: false, reason: 'dup' };
          const idx = list.findIndex((r) => r.id === id);
          if (idx < 0) return { ok: false, reason: 'missing' };
          if (list[idx]!.name === n) return { ok: true };
          commitList(list.map((r) => (r.id === id ? { ...r, name: n } : r)));
          return { ok: true };
        },
        removeRestaurant(id) {
          const list = get().restaurants;
          if (list.length <= CFG.limits.minRestaurants) return { ok: false, reason: 'min' };
          if (!list.some((r) => r.id === id)) return { ok: true };
          commitList(list.filter((r) => r.id !== id));
          return { ok: true };
        },
        moveRestaurant(id, delta) {
          const list = get().restaurants.slice();
          const i = list.findIndex((r) => r.id === id);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= list.length) return;
          const tmp = list[i]!;
          list[i] = list[j]!;
          list[j] = tmp;
          commitList(list);
        },
        setRestaurantWeight(id, w) {
          const weight = clampWeight(w);
          const list = get().restaurants;
          if (!list.some((r) => r.id === id && r.weight !== weight)) return;
          // Weight does not change sticks; keep the list event quiet but drop the stale pending pick.
          set({ restaurants: list.map((r) => (r.id === id ? { ...r, weight } : r)), pending: null });
        },
        toggleClosedToday(id) {
          const today = todayKey();
          set({
            restaurants: get().restaurants.map((r) => (r.id === id ? { ...r, closedOn: r.closedOn === today ? null : today } : r)),
            pending: null,
          });
        },
        resetRestaurants() {
          commitList(defaultRestaurants());
        },

        updateSettings(patch) {
          const prev = get().settings;
          const settings = sanitizeSettings({ ...prev, ...patch });
          const next: Partial<AppState> = { settings };
          if (settings.lowMotion !== prev.lowMotion) next.reducedMotion = computeReducedMotion(settings);
          if (
            settings.teamMode !== prev.teamMode ||
            settings.teamPhrase.trim().toLowerCase() !== prev.teamPhrase.trim().toLowerCase() ||
            settings.antiRepeat !== prev.antiRepeat
          ) {
            next.pending = null;
          }
          set(next);
        },

        pushHistory(e) {
          const rest = get().history.filter((x) => x.draw.id !== e.draw.id);
          set({ history: [e, ...rest].slice(0, CFG.limits.historyMax) });
        },
        patchHistory(drawId, patch) {
          let changed = false;
          const history = get().history.map((e) => {
            if (e.draw.id !== drawId) return e;
            changed = true;
            return { ...e, ...patch, draw: patch.draw ?? e.draw };
          });
          if (changed) set({ history });
        },
        clearHistory() {
          const day = get().day;
          set({ history: [], day: { ...day, lockedDrawId: null } });
        },

        patchDay(patch) {
          const today = todayKey();
          set({ day: { ...rolledDay(get().day, today), ...patch, date: today } });
        },
      };
    },
    {
      name: STORE_KEY,
      version: STORE_VERSION,
      storage: dedupedStorage(),
      partialize: (s): Persisted => ({ restaurants: s.restaurants, settings: s.settings, history: s.history, day: s.day }),
      migrate: (persisted) => sanitizePersisted(persisted) as unknown as Store,
      // merge() sanitizes and rolls `day` over to today, so no post-rehydrate hook is needed.
      merge: (persisted, current) => {
        const p = sanitizePersisted(persisted);
        return { ...current, ...p, reducedMotion: computeReducedMotion(p.settings) };
      },
    },
  ),
);

export const getState: () => Store = useStore.getState;

/** Roll `day` over when the local date changed (called on visibilitychange and by the controller; rehydrate rolls it in merge()). */
export function ensureToday(): boolean {
  const s = useStore.getState();
  const today = todayKey();
  if (s.day.date === today) return false;
  useStore.setState({ day: freshDay(today), pending: null });
  return true;
}

// Keep the stick buffers sized to the list.
resizeSticks(useStore.getState().restaurants.length);
useStore.subscribe((s, prev) => {
  if (s.restaurants.length !== prev.restaurants.length) resizeSticks(s.restaurants.length);
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureToday();
  });
}
