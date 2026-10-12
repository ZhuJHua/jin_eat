/**
 * Motion permission. `requestMotionPermission()` must be called synchronously inside a
 * user gesture (the gate click): on iOS both `requestPermission()` calls are invoked in that same
 * tick and combined with Promise.all, so there is no await before them.
 */

export type MotionPermission = 'granted' | 'denied' | 'not-required' | 'unsupported' | 'insecure';

export interface MotionCapability {
  secure: boolean;
  hasMotion: boolean;
  needsPermission: boolean;
  coarse: boolean;
}

type PermissionFn = () => Promise<PermissionState | 'granted' | 'denied' | 'default'>;
interface WithRequestPermission {
  requestPermission?: PermissionFn;
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function motionCtor(): WithRequestPermission | null {
  if (!hasWindow() || !('DeviceMotionEvent' in window)) return null;
  return window.DeviceMotionEvent as unknown as WithRequestPermission;
}

function orientationCtor(): WithRequestPermission | null {
  if (!hasWindow() || !('DeviceOrientationEvent' in window)) return null;
  return window.DeviceOrientationEvent as unknown as WithRequestPermission;
}

function isCoarse(): boolean {
  if (!hasWindow()) return false;
  try {
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      if (window.matchMedia('(any-pointer: fine)').matches) return false;
    }
  } catch {
    // fall through
  }
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
}

export function motionCapability(): MotionCapability {
  if (!hasWindow()) return { secure: false, hasMotion: false, needsPermission: false, coarse: false };
  const dme = motionCtor();
  return {
    secure: window.isSecureContext === true,
    hasMotion: dme !== null,
    needsPermission: typeof dme?.requestPermission === 'function',
    coarse: isCoarse(),
  };
}

let inflight: Promise<MotionPermission> | null = null;

/**
 * Ask for device-motion access. The iOS prompts are triggered synchronously in this call; only
 * their results are awaited. Never rejects.
 */
export function requestMotionPermission(): Promise<MotionPermission> {
  if (!hasWindow() || window.isSecureContext !== true) return Promise.resolve('insecure');
  const dme = motionCtor();
  if (!dme) return Promise.resolve('unsupported');
  if (typeof dme.requestPermission !== 'function') return Promise.resolve('not-required');
  // A double tap must not open two sheets; the second tap shares the first request.
  if (inflight) return inflight;

  const doe = orientationCtor();
  let both: Promise<[string, string]>;
  try {
    // Both calls happen right here, in the gesture's tick.
    const m = dme.requestPermission();
    const o = typeof doe?.requestPermission === 'function' ? doe.requestPermission() : Promise.resolve('granted' as const);
    both = Promise.all([m, o]);
  } catch {
    return Promise.resolve('denied');
  }
  inflight = both
    .then(([m, o]): MotionPermission => (m === 'granted' && o === 'granted' ? 'granted' : 'denied'))
    .catch((): MotionPermission => 'denied')
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
