/**
 * Pointer input on the stage: hover parallax + "grab the tube and wiggle".
 * Writes `rt.input.pointer`:
 *  - `ndc`  — pointer position in normalised device coords (x right, y up, −1..1);
 *  - `over` — the pointer is over the tube hit mesh;
 *  - `grabbing` — the primary pointer grabbed the tube (idle/armed only);
 *  - `vel`  — smoothed pointer velocity in viewport-heights/s (x right, y up);
 *  - `mag`  — pseudo shake magnitude: clamp(|Δv|/dt · 0.25, 0, 25), smoothed;
 *  - `lastTs` — performance.now() of the last move.
 * Arming happens in stepShake from sustained wiggle energy, so a plain click on the tube does not
 * start a draw by accident.
 */
import { CFG } from '@/config';
import { getState, useStore } from '@/state/store';
import { rt } from '@/state/runtime';
import { holdFullRate } from '@/engine/loop';
import { pointerMag } from '@/sensors/filters';

/** Velocity smoothing time constant (s): tames 120–240 Hz pointer jitter before differentiating. */
const VEL_TAU = 0.03;
/** Pseudo-magnitude smoothing time constant (s). */
const MAG_TAU = 0.05;
/** Shortest dt used for differentiation (s); coalesced events can arrive with ~0 spacing. */
const MIN_DT = 1 / 240;

const tauAlpha = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

function canGrab(): boolean {
  const s = getState();
  return s.drawer === null && (s.phase === 'idle' || s.phase === 'armed');
}

/**
 * Attach pointer handlers to the canvas element. `hitTest(ndc)` raycasts the tube; a grab only
 * starts when it returns true. Returns a detach function.
 */
export function attachPointerShake(canvas: HTMLElement, hitTest: (ndc: [number, number]) => boolean): () => void {
  const p = rt.input.pointer;
  let grabId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  const vs: [number, number] = [0, 0];
  let cursor = '';

  const setCursor = (c: string): void => {
    if (c === cursor) return;
    cursor = c;
    canvas.style.cursor = c;
  };

  const toNdc = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    return [((e.clientX - r.left) / w) * 2 - 1, -(((e.clientY - r.top) / h) * 2 - 1)];
  };

  const safeHit = (ndc: [number, number]): boolean => {
    try {
      return hitTest(ndc);
    } catch {
      return false;
    }
  };

  const updateHover = (ndc: [number, number], fine: boolean): void => {
    p.ndc[0] = ndc[0];
    p.ndc[1] = ndc[1];
    // Hover raycasts only for mouse/pen; touch has no hover.
    p.over = fine ? safeHit(ndc) : false;
    if (grabId !== null) setCursor('grabbing');
    else setCursor(p.over && canGrab() ? 'grab' : '');
  };

  const endGrab = (): void => {
    if (grabId === null) return;
    const id = grabId;
    grabId = null;
    p.grabbing = false;
    p.mag = 0;
    vs[0] = vs[1] = 0;
    p.vel[0] = p.vel[1] = 0;
    try {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      // ignore
    }
    setCursor(p.over && canGrab() ? 'grab' : '');
    // The 250 ms stillness window starts at release.
    rt.shake.stillMs = 0;
    rt.shake.lastInputTs = performance.now();
  };

  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || grabId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ndc = toNdc(e);
    p.ndc[0] = ndc[0];
    p.ndc[1] = ndc[1];
    if (!canGrab() || !safeHit(ndc)) return;
    grabId = e.pointerId;
    p.grabbing = true;
    p.over = true;
    p.mag = 0;
    p.lastTs = performance.now();
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = p.lastTs;
    vs[0] = vs[1] = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore (synthetic events)
    }
    setCursor('grabbing');
    holdFullRate(400);
    e.preventDefault();
  };

  const integrate = (x: number, y: number, t: number): void => {
    const vh = window.innerHeight || 1;
    const dt = Math.max(MIN_DT, (t - lastT) / 1000);
    // Screen y grows downward; store y up.
    const rvx = (x - lastX) / vh / dt;
    const rvy = -(y - lastY) / vh / dt;
    lastX = x;
    lastY = y;
    lastT = t;
    const av = tauAlpha(dt, VEL_TAU);
    const pvx = vs[0];
    const pvy = vs[1];
    vs[0] += av * (rvx - vs[0]);
    vs[1] += av * (rvy - vs[1]);
    const accel = Math.hypot(vs[0] - pvx, vs[1] - pvy) / dt;
    const raw = pointerMag(accel, CFG.sensors.pointerAccelScale);
    p.mag += tauAlpha(dt, MAG_TAU) * (raw - p.mag);
    p.vel[0] = vs[0];
    p.vel[1] = vs[1];
  };

  const onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    const fine = e.pointerType !== 'touch';
    if (grabId !== null && e.pointerId === grabId) {
      const ndc = toNdc(e);
      p.ndc[0] = ndc[0];
      p.ndc[1] = ndc[1];
      const t = performance.now();
      // Use coalesced samples when available for a faithful acceleration estimate.
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (list.length > 1) {
        const t0 = lastT;
        const span = Math.max(0, t - t0);
        list.forEach((ce, i) => integrate(ce.clientX, ce.clientY, t0 + (span * (i + 1)) / list.length));
      } else {
        integrate(e.clientX, e.clientY, t);
      }
      p.lastTs = t;
      holdFullRate(250);
      return;
    }
    updateHover(toNdc(e), fine);
    if (fine) holdFullRate(250);
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId === grabId) endGrab();
  };

  const onLeave = (e: PointerEvent): void => {
    if (grabId !== null) return;
    if (e.pointerType !== 'touch') {
      p.over = false;
      setCursor('');
    }
  };

  const onBlur = (): void => endGrab();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onBlur);

  // Drop a grab if the phase moves on (draw triggered by the forced rule, a drawer opened…).
  const unsub = useStore.subscribe((s, prev) => {
    if (s.phase === prev.phase && s.drawer === prev.drawer) return;
    if (grabId !== null && !canGrab()) endGrab();
    if (grabId === null) setCursor(p.over && canGrab() ? 'grab' : '');
  });

  return () => {
    endGrab();
    unsub();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onBlur);
    p.over = false;
    setCursor('');
  };
}
