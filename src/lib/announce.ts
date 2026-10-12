/** Screen-reader announcements, rendered by ui/Announcer.tsx into an aria-live region. */

type Listener = (text: string, id: number) => void;

const listeners = new Set<Listener>();
let nextId = 1;
let lastText = '';
let lastAt = -Infinity;
let lastMessage: { text: string; id: number } | null = null;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Announce `text` (identical text within 300 ms is dropped). */
export function announce(text: string): void {
  const t = now();
  const clean = text.trim();
  if (!clean) return;
  if (clean === lastText && t - lastAt < 300) return;
  lastText = clean;
  lastAt = t;
  const id = nextId++;
  lastMessage = { text: clean, id };
  for (const fn of Array.from(listeners)) {
    try {
      fn(clean, id);
    } catch (err) {
      console.error('[announce] listener threw', err);
    }
  }
}

export function subscribeAnnounce(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Most recent announcement (useful for tests and late-mounting live regions). */
export function lastAnnouncement(): { text: string; id: number } | null {
  return lastMessage;
}
