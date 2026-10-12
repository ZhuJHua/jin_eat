/**
 * Service worker registration (production only). The SW script URL carries the build id so every
 * deploy installs a fresh worker with its own cache; the worker itself is network-first for pages.
 */
import { COPY } from '@/data/copy';
import { getState, useStore } from '@/state/store';

const CALM_MS = 4000;

/**
 * Show the 「已缓存」 note only once the shrine is calm: gate gone, idle for a few seconds, no drawer.
 * Never on top of the opening reveal or during a draw.
 */
function toastWhenCalm(text: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const calm = (): boolean => {
    const s = getState();
    return s.phase === 'idle' && !s.gate.needed && s.drawer === null && s.toast === null;
  };
  const check = (): void => {
    if (done) return;
    if (!calm()) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (done || !calm()) return;
      done = true;
      unsub();
      getState().showToast(text);
    }, CALM_MS);
  };
  const unsub = useStore.subscribe(check);
  check();
}

export function registerSW(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window !== 'undefined' && !window.isSecureContext) return;

  const register = (): void => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(__BUILD_ID__)}`, { scope: '/' })
      .then((reg) => {
        const worker = reg.installing;
        if (!worker || hadController) return;
        // First install on this device: tell the user the shrine now works offline.
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') toastWhenCalm(COPY.toast.offlineReady);
        });
      })
      .catch((err: unknown) => {
        console.warn('[sw] registration failed', err);
      });
  };

  if (document.readyState === 'complete') setTimeout(register, 1500);
  else window.addEventListener('load', () => setTimeout(register, 1500), { once: true });
}
