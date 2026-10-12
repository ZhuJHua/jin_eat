/**
 * Haptics. `navigator.vibrate` is feature-detected (it does not exist on iOS Safari),
 * gated by `settings.haptics`, and only used after the first user activation so Chrome does not log
 * interventions. Tiny clack pulses are rate-limited and never cut off a longer pattern that is
 * still playing (a new vibrate() call replaces the current one).
 */
import { CFG } from '@/config';
import { bus } from '@/lib/bus';
import { getState, useStore } from '@/state/store';

const H = CFG.haptics;
/** Pulses this short count as "ticks" for the rate limit. */
const TICK_MAX_MS = 12;

let lastTick = -Infinity;
let busyUntil = 0;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function canVibrate(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

function enabled(): boolean {
  try {
    return getState().settings.haptics;
  } catch {
    return false;
  }
}

function total(pattern: number | readonly number[]): number {
  if (typeof pattern === 'number') return Math.max(0, pattern);
  let sum = 0;
  for (const v of pattern) sum += Math.max(0, v);
  return sum;
}

/** Vibrate with feature detection, the 震动 setting and tick rate-limiting. */
export function vibrate(pattern: number | readonly number[]): void {
  if (!enabled() || !canVibrate()) return;
  const dur = total(pattern);
  if (dur <= 0) return;
  const t = nowMs();
  const tick = typeof pattern === 'number' ? pattern <= TICK_MAX_MS : pattern.length === 1 && dur <= TICK_MAX_MS;
  if (tick) {
    if (t - lastTick < H.clackGapMs || t < busyUntil) return;
    lastTick = t;
  }
  try {
    const ok = navigator.vibrate(typeof pattern === 'number' ? pattern : Array.from(pattern));
    if (ok && !tick) busyUntil = t + dur;
  } catch {
    // Some webviews throw on vibrate; haptics are best effort.
  }
}

/** Stop any running pattern (e.g. when haptics are switched off). */
export function cancelVibration(): void {
  busyUntil = 0;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(0);
  } catch {
    // ignore
  }
}

/** Subscribe haptics to the bus (and to 圣筊 results in the store). Returns an unsubscribe. */
export function wireHapticsToBus(): () => void {
  let lastEject = -Infinity;
  const ejectPulse = (): void => {
    const t = nowMs();
    if (t - lastEject < 250) return;
    lastEject = t;
    vibrate(H.eject);
  };
  const offs = [
    bus.on('clack', ({ force }) => {
      if (force > 0.25) vibrate(H.clack);
    }),
    bus.on('jiaobei-land', ({ force }) => {
      if (force > 0.2) vibrate(H.clack + 4);
    }),
    bus.on('meter-full', () => vibrate(H.meterFull)),
    // Timelines emit pop + eject together; either one alone (e.g. Fallback2D) still gets the pattern.
    bus.on('eject', ejectPulse),
    bus.on('pop', ejectPulse),
    bus.on('landed', () => vibrate(H.land)),
    bus.on('bell', () => vibrate(H.bell)),
    useStore.subscribe((s, prev) => {
      if (s.jiaobeiResult === 'sheng' && prev.jiaobeiResult !== 'sheng') vibrate(H.sheng);
      if (prev.settings.haptics && !s.settings.haptics) cancelVibration();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
