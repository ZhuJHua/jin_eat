import type { DrawResult, QualityTier } from '@/types';

/** Fire-and-forget event bus between logic, audio, haptics and visuals. */
export interface BusEvents {
  clack: { force: number };
  thunk: { force: number };
  scrape: { durationMs: number };
  pop: Record<string, never>;
  bell: Record<string, never>;
  gong: Record<string, never>;
  woodfish: Record<string, never>;
  'meter-full': Record<string, never>;
  eject: Record<string, never>;
  landed: Record<string, never>;
  'jiaobei-land': { force: number };
  reveal: { draw: DrawResult };
  'list-changed': Record<string, never>;
  'context-lost': Record<string, never>;
  'quality-changed': { tier: QualityTier };
}

type Handler<K extends keyof BusEvents> = (p: BusEvents[K]) => void;

const handlers = new Map<keyof BusEvents, Set<(p: never) => void>>();

export const bus: {
  on<K extends keyof BusEvents>(k: K, fn: (p: BusEvents[K]) => void): () => void;
  emit<K extends keyof BusEvents>(k: K, p: BusEvents[K]): void;
} = {
  on<K extends keyof BusEvents>(k: K, fn: Handler<K>): () => void {
    let set = handlers.get(k);
    if (!set) {
      set = new Set();
      handlers.set(k, set);
    }
    set.add(fn as (p: never) => void);
    return () => {
      set.delete(fn as (p: never) => void);
    };
  },
  emit<K extends keyof BusEvents>(k: K, p: BusEvents[K]): void {
    const set = handlers.get(k);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        (fn as Handler<K>)(p);
      } catch (err) {
        console.error(`[bus] handler for "${String(k)}" threw`, err);
      }
    }
  },
};

/** Shared empty payload for events without data (avoids per-emit allocations). */
export const EMPTY: Record<string, never> = Object.freeze({}) as Record<string, never>;
