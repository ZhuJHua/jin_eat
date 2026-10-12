/**
 * localStorage wrapper that never throws (private mode, blocked storage, quota)
 * and falls back to an in-memory map for the rest of the session.
 */

const memory = new Map<string, string>();
let backend: Storage | null | undefined;

function getBackend(): Storage | null {
  if (backend !== undefined) return backend;
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!ls) {
      backend = null;
      return backend;
    }
    const probe = '__jinshao_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    backend = ls;
  } catch {
    backend = null;
  }
  return backend;
}

export const safeStorage: {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} = {
  getItem(k) {
    const b = getBackend();
    if (b) {
      try {
        const v = b.getItem(k);
        if (v !== null) return v;
      } catch {
        /* fall through to memory */
      }
    }
    return memory.has(k) ? memory.get(k)! : null;
  },
  setItem(k, v) {
    memory.set(k, v);
    const b = getBackend();
    if (!b) return;
    try {
      b.setItem(k, v);
    } catch {
      /* quota or blocked: memory copy remains */
    }
  },
  removeItem(k) {
    memory.delete(k);
    const b = getBackend();
    if (!b) return;
    try {
      b.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export function readJSON<T>(k: string, fallback: T): T {
  const raw = safeStorage.getItem(k);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(k: string, v: unknown): void {
  try {
    safeStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* unserialisable: ignore */
  }
}
