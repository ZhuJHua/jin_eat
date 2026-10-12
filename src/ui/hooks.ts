/** Small React helpers shared by the UI. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

function mediaStore(query: string): { subscribe: (cb: () => void) => () => void; get: () => boolean } {
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  return {
    subscribe(cb) {
      if (!mq) return () => {};
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    get: () => mq?.matches ?? false,
  };
}

const stores = new Map<string, ReturnType<typeof mediaStore>>();

/** Live `matchMedia(query).matches`. */
export function useMedia(query: string): boolean {
  let st = stores.get(query);
  if (!st) {
    st = mediaStore(query);
    stores.set(query, st);
  }
  return useSyncExternalStore(st.subscribe, st.get, () => false);
}

/** Layout of the reveal scroll: docked right (desktop / landscape) or a bottom sheet (portrait). */
export type ScrollLayout = 'right' | 'landscape' | 'bottom';

export const Q_LANDSCAPE = '(orientation: landscape)';
export const Q_DESKTOP = '(min-width: 1024px) and (orientation: landscape)';
export const Q_WIDE = '(min-width: 1280px)';
export const Q_FINE = '(hover: hover) and (pointer: fine)';

export function useScrollLayout(): ScrollLayout {
  const landscape = useMedia(Q_LANDSCAPE);
  const desktop = useMedia(Q_DESKTOP);
  if (desktop) return 'right';
  return landscape ? 'landscape' : 'bottom';
}

/**
 * Poll a value from the mutable runtime (`rt`) at `hz` while `enabled`, re-rendering only when it
 * changes. Keeps React out of the per-frame path.
 */
export function useRtPoll<T>(read: () => T, hz: number, enabled: boolean, equal: (a: T, b: T) => boolean = Object.is): T {
  const readRef = useRef(read);
  readRef.current = read;
  const eqRef = useRef(equal);
  eqRef.current = equal;
  const [value, setValue] = useState<T>(() => read());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(
      () => {
        const next = readRef.current();
        setValue((prev) => (eqRef.current(prev, next) ? prev : next));
      },
      Math.max(16, 1000 / hz),
    );
    return () => window.clearInterval(id);
  }, [enabled, hz]);
  return value;
}

/** Previous render's value. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const prev = ref.current;
  useEffect(() => {
    ref.current = value;
  });
  return prev;
}

/** Copy text to the clipboard with a textarea fallback for insecure contexts. Never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
