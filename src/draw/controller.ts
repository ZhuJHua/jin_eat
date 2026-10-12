/**
 * Phase machine and side effects. Called by the UI, the master loop,
 * the 3D Director and Fallback2D. All timestamps are performance.now() ms.
 */
import type { DrawResult, FortuneCopy, HistoryEntry, ShakeSource } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { composeLocalCopy, LEVELS } from '@/data/fortunes';
import { allClosed, isTeamActive, pickDraw } from '@/draw/pick';
import { JIAOBEI_DURATION, jiaobeiTargets, rollJiaobei, sampleJiaobei } from '@/draw/jiaobei';
import { announce } from '@/lib/announce';
import { bus, EMPTY } from '@/lib/bus';
import { todayKey, toChineseNumeral } from '@/lib/date';
import { cryptoSource } from '@/lib/rng';
import { ensureToday, getState } from '@/state/store';
import { resetForDraw, rt } from '@/state/runtime';
import { audio } from '@/audio/synth';
import { motionCapability, requestMotionPermission } from '@/sensors/permission';
import { startSensorsOrFallback } from '@/sensors/motion';

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** What happens when the current `resetting` finishes. */
let afterReset: 'idle' | 'quick' = 'idle';
let preload: (() => void) | null = null;
let lastDayCheck = -Infinity;
let lastMirror = -Infinity;

/**
 * Register the 3D chunk preloader (App: `() => { import('./three/Stage'); if (tier ≥ 1) import(physics) }`).
 * passGate/skipGate call it so loading overlaps the iOS permission sheet.
 */
export function registerPreload(fn: (() => void) | null): void {
  preload = fn;
}

function runPreload(): void {
  try {
    preload?.();
  } catch (err) {
    console.error('[controller] preload failed', err);
  }
}

// ───────────────────────────── text ─────────────────────────────

/** 「今日签文：第七签，上上签，黄焖鸡。锦少大师解曰：…… 宜…，忌…。」 */
export function revealAnnouncement(d: DrawResult, c: FortuneCopy): string {
  const head = d.treat ? `${COPY.reveal.treatBadge}！` : '';
  return `${head}今日签文：第${toChineseNumeral(d.stickNo)}签，${LEVELS[d.level].label}，${d.restaurantName}。锦少大师解曰：${c.jie} 宜${c.yi}，忌${c.ji}。`;
}

// ───────────────────────────── helpers ─────────────────────────────

function lockedEntry(): HistoryEntry | null {
  const s = getState();
  const id = s.day.date === todayKey() ? s.day.lockedDrawId : null;
  if (!id) return null;
  return s.history.find((e) => e.draw.id === id) ?? null;
}

/** A stored pending pick is still valid for the current list, mode and date. */
function pendingValid(p: DrawResult): boolean {
  const s = getState();
  if (p.date !== todayKey()) return false;
  const r = s.restaurants[p.index];
  if (!r || r.id !== p.restaurantId || r.name !== p.restaurantName) return false;
  const team = isTeamActive(s.settings) ? s.settings.teamPhrase.trim() : null;
  return p.team === team;
}

function freshPick(): DrawResult {
  ensureToday();
  const s = getState();
  const today = todayKey();
  if (!isTeamActive(s.settings) && allClosed(s.restaurants, today)) s.showToast(COPY.toast.allClosed);
  return pickDraw({
    list: s.restaurants,
    history: s.history,
    settings: s.settings,
    day: s.day,
    today,
    reducedMotion: s.reducedMotion,
  });
}

/** Go to the stage after the gate: straight into a locked reveal, or idle. */
function enterStage(): void {
  const s = getState();
  const locked = lockedEntry();
  if (locked) {
    s.setCurrent(locked.draw, locked.copy);
    rt.hero.index = indexOfRestaurant(locked.draw.restaurantId);
    rt.hero.landed = true;
    rt.camera.shot = 'locked';
    s.setPhase('reveal');
    announce(`${COPY.reveal.lockedBanner(locked.draw.restaurantName)}。${revealAnnouncement(locked.draw, locked.copy)}`);
    return;
  }
  s.setPhase('idle');
}

/** Current list position of a restaurant (the stored draw index goes stale after a reorder). */
export function indexOfRestaurant(id: string): number {
  return getState().restaurants.findIndex((r) => r.id === id);
}

/**
 * The open reveal belongs to a previous day (the page stayed open past midnight): acting on it would
 * attach a lock / veto / 掷筊 to the wrong day, so close it and start fresh instead.
 */
function staleReveal(): boolean {
  const s = getState();
  const cur = s.current;
  if (!cur || cur.date === todayKey()) return false;
  s.showToast(COPY.toast.newDay);
  announce(COPY.toast.newDay);
  afterReset = 'idle';
  beginReset();
  return true;
}

function beginReset(): void {
  const s = getState();
  rt.jiaobei.active = false;
  s.setJiaobeiResult(null);
  const cur = s.current;
  if (cur && s.day.lockedDrawId === cur.id) s.patchDay({ lockedDrawId: null });
  s.setPhase('resetting');
}

function setAuto(kind: 'hold' | 'quick', now: number, until: number): void {
  const a = rt.input.auto;
  a.active = true;
  a.kind = kind;
  a.t0 = now;
  a.until = until;
}

function clearAuto(): void {
  const a = rt.input.auto;
  a.active = false;
  a.kind = null;
}

// ───────────────────────────── boot / gate ─────────────────────────────

/**
 * Called once by App after boot detection. With `gateNeeded` the gate card shows; otherwise the
 * stage opens directly (sensors start without a prompt on Android; desktop stays in pointer mode).
 */
export function bootTo(gateNeeded: boolean): void {
  const s = getState();
  if (gateNeeded) {
    s.setGate({ needed: true });
    s.setPhase('gate');
    runPreload();
    return;
  }
  s.setGate({ needed: false });
  const cap = motionCapability();
  // Android starts without a prompt; any phone on an insecure origin resolves 'insecure' at once and
  // lands in pointer mode with the 「摇不动？」 hint, iOS included.
  if (cap.coarse && cap.hasMotion && (!cap.needsPermission || !cap.secure)) {
    void requestMotionPermission()
      .then((perm) => startSensorsOrFallback(perm))
      .catch((err: unknown) => console.error('[controller] sensors failed', err));
  } else {
    s.setGate({ inputMode: 'pointer' });
  }
  runPreload();
  enterStage();
}

/** 「进殿上香」. Synchronous first: audio unlock and both permission requests in this tick. */
export function passGate(): void {
  audio.unlock();
  const perm = requestMotionPermission();
  runPreload();
  const s = getState();
  s.setGate({ needed: false });
  void perm.then((p) => startSensorsOrFallback(p)).catch((err: unknown) => console.error('[controller] sensors failed', err));
  audio.startAmbience();
  enterStage();
}

/** 「不用体感，直接进」 */
export function skipGate(): void {
  audio.unlock();
  runPreload();
  getState().setGate({ needed: false, inputMode: 'pointer' });
  rt.input.mode = 'pointer';
  audio.startAmbience();
  enterStage();
}

// ───────────────────────────── shaking ─────────────────────────────

/** idle → armed. Picks the winner now (or reuses `pending`). */
export function beginShake(src: ShakeSource): void {
  const s = getState();
  if (s.drawer !== null) return;
  const now = nowMs();
  if (s.phase === 'armed') {
    rt.shake.lastInputTs = now;
    return;
  }
  if (s.phase !== 'idle') return;

  let pending = s.pending;
  if (!pending || !pendingValid(pending)) {
    pending = freshPick();
    getState().setPending(pending);
  }
  rt.shake.lastInputTs = now;
  rt.shake.stillMs = 0;
  if (src !== 'motion' && src !== 'pointer') bus.emit('woodfish', EMPTY);
  getState().setPhase('armed');
  announce(COPY.announce.shaking);
  if (src === 'reduced') triggerDraw();
}

/** Space / long-press: auto-shake until endHold(). */
export function startHold(kind: 'key' | 'button-hold'): void {
  const s = getState();
  if (s.drawer !== null) return;
  if (s.reducedMotion) {
    quickDraw();
    return;
  }
  if (s.phase === 'idle') beginShake(kind);
  if (getState().phase !== 'armed') return;
  const now = nowMs();
  rt.shake.lastInputTs = now;
  setAuto('hold', now, Infinity);
}

export function endHold(): void {
  if (rt.input.auto.kind === 'hold') clearAuto();
  rt.shake.stillMs = 0;
  rt.shake.lastInputTs = nowMs();
}

/** Click / Enter / tap: 1.2 s auto-shake then draw. Reduced motion draws immediately. */
export function quickDraw(): void {
  const s = getState();
  if (s.drawer !== null) return;
  if (s.phase !== 'idle' && s.phase !== 'armed') return;
  if (s.reducedMotion) {
    if (s.phase === 'idle') beginShake('reduced');
    else triggerDraw();
    return;
  }
  if (s.phase === 'armed' && rt.shake.fullLatched) {
    triggerDraw();
    return;
  }
  if (s.phase === 'idle') beginShake('quick');
  if (getState().phase !== 'armed') return;
  const now = nowMs();
  rt.shake.lastInputTs = now;
  setAuto('quick', now, now + CFG.sensors.quickDrawSec * 1000);
}

/** armed → drawing. The result is `pending`; copy is composed locally and a history entry pushed. */
export function triggerDraw(): void {
  const s = getState();
  if (s.phase !== 'armed' && s.phase !== 'idle') return;
  let draw = s.pending && pendingValid(s.pending) ? s.pending : null;
  if (!draw) draw = freshPick();
  const restaurant = s.restaurants[draw.index]!;
  const recentJie = draw.team ? [] : s.history.slice(0, 3).map((e) => e.copy.jie);
  const copy = composeLocalCopy({ draw, restaurant, recentJie });

  s.setCurrent(draw, copy);
  s.setPending(null);
  s.setJiaobeiResult(null);
  s.pushHistory({ draw, copy, confirmed: false, vetoed: false, jiaobei: [] });
  s.patchDay(draw.team ? { teamDrawCount: s.day.teamDrawCount + 1, xiaoStreak: 0 } : { xiaoStreak: 0 });

  clearAuto();
  rt.hero.index = draw.index;
  rt.hero.landed = false;
  rt.hero.handoffAt = null;
  rt.decoy.index = draw.decoyIndex ?? -1;
  rt.decoy.active = false;
  getState().setPhase('drawing');
  announce(COPY.announce.drawing);
}

/** drawing → reveal (Director / Fallback2D when the choreography ends). */
export function onDrawingDone(): void {
  const s = getState();
  if (s.phase !== 'drawing') return;
  const draw = s.current;
  s.setPhase('reveal');
  if (!draw || !s.copy) return;
  bus.emit('reveal', { draw });
  if (draw.level === 'shangshang' || draw.treat) bus.emit('gong', EMPTY);
  announce(revealAnnouncement(draw, s.copy));
}

// ───────────────────────────── reveal actions ─────────────────────────────

/** Lock the current draw as today's lunch (no toast / announcement). */
function lockCurrent(): void {
  const s = getState();
  const cur = s.current;
  if (!cur) return;
  if (s.history.some((e) => e.draw.id === cur.id)) s.patchHistory(cur.id, { confirmed: true });
  else if (s.copy) {
    // 签簿 was cleared while the scroll was open: re-record the draw so the lock survives a reload.
    s.pushHistory({ draw: cur, copy: s.copy, confirmed: true, vetoed: false, jiaobei: [] });
  }
  s.patchDay({ lockedDrawId: cur.id, xiaoStreak: 0 });
  if (s.phase === 'jiaobei') {
    rt.jiaobei.active = false;
    s.setPhase('reveal');
  }
}

/**
 * 就它了. The scroll is open, so its 今日已定 banner and seal are the visual feedback; only the live
 * region hears the confirmation (a toast would say it a third time).
 */
export function confirm(): void {
  const s = getState();
  const cur = s.current;
  if (!cur || (s.phase !== 'reveal' && s.phase !== 'jiaobei')) return;
  if (staleReveal()) return;
  lockCurrent();
  announce(COPY.toast.confirmed(cur.restaurantName));
}

/** 再求一签: reveal → resetting → idle. */
export function reshake(): void {
  const s = getState();
  if (s.phase !== 'reveal' && s.phase !== 'jiaobei') return;
  afterReset = 'idle';
  beginReset();
}

/** resetting → idle (or straight into a quick draw after a veto). */
export function onResetDone(): void {
  const s = getState();
  if (s.phase !== 'resetting') return;
  resetForDraw();
  s.setCurrent(null, null);
  s.setJiaobeiResult(null);
  s.setPhase('idle');
  const next = afterReset;
  afterReset = 'idle';
  if (next === 'quick') quickDraw();
  else announce(COPY.announce.reset);
}

/** 一票否决: once per day, not in team mode. */
export function veto(): void {
  const s = getState();
  const cur = s.current;
  if (!cur || s.phase !== 'reveal') return;
  if (staleReveal()) return;
  if (isTeamActive(s.settings) || cur.team) {
    s.showToast(COPY.veto.teamDisabled);
    return;
  }
  if (s.day.vetoUsed) return;
  const excluded = s.day.excluded.includes(cur.restaurantId) ? s.day.excluded : [...s.day.excluded, cur.restaurantId];
  s.patchDay({ vetoUsed: true, excluded });
  s.patchHistory(cur.id, { vetoed: true, confirmed: false });
  rt.fx.flash = 1;
  s.showToast(COPY.veto.quote);
  announce(COPY.announce.vetoed);
  afterReset = 'quick';
  beginReset();
}

// ───────────────────────────── 掷筊 ─────────────────────────────

/** 不服？掷筊问锦少 (and 「再掷」 after a 笑筊). The outcome is rolled before the throw. */
export function throwJiaobei(): void {
  const s = getState();
  if (!s.current) return;
  if (s.phase !== 'reveal' && s.phase !== 'jiaobei') return;
  if (s.phase === 'jiaobei' && rt.jiaobei.active) return;
  // A locked lunch (就它了 / 今日已定) is final: no more asking.
  if (s.day.lockedDrawId === s.current.id) return;
  if (staleReveal()) return;
  const outcome = rollJiaobei();
  const j = rt.jiaobei;
  j.targets = jiaobeiTargets(outcome);
  j.seed = cryptoSource.nextUint32();
  j.t0 = nowMs();
  j.outcome = outcome;
  j.active = true;
  s.setJiaobeiResult(null);
  s.setPhase('jiaobei');
  announce(COPY.jiaobei.throwing);
  if (s.reducedMotion) onJiaobeiDone();
}

/** Both blocks at rest (Director, Fallback2D, reduced motion or the watchdog). */
export function onJiaobeiDone(): void {
  const s = getState();
  const j = rt.jiaobei;
  if (s.phase !== 'jiaobei' || !j.active || !j.outcome) return;
  const o = j.outcome;
  j.active = false;
  j.poses = sampleJiaobei(j.targets, j.seed, JIAOBEI_DURATION).poses;
  const cur = s.current;
  if (!cur) {
    s.setPhase('reveal');
    return;
  }
  const prev = s.history.find((e) => e.draw.id === cur.id)?.jiaobei ?? [];
  s.patchHistory(cur.id, { jiaobei: [...prev, o] });
  s.setJiaobeiResult(o);

  if (o === 'sheng') {
    // The panel closes into the locked reveal, so one toast carries the outcome; one announcement says it all.
    bus.emit('gong', EMPTY);
    s.showToast(`${COPY.jiaobei.name.sheng}：${COPY.jiaobei.result.sheng}`);
    lockCurrent();
    announce(`${COPY.jiaobei.name.sheng}：${COPY.jiaobei.result.sheng}。${COPY.toast.confirmed(cur.restaurantName)}`);
    return;
  }
  if (o === 'xiao') {
    const streak = s.day.xiaoStreak + 1;
    if (streak >= CFG.limits.xiaoForceAccept) {
      s.showToast(COPY.jiaobei.forced);
      lockCurrent();
      announce(`${COPY.jiaobei.name.xiao}：${COPY.jiaobei.forced}。${COPY.toast.confirmed(cur.restaurantName)}`);
      return;
    }
    // The 掷筊 panel shows the result line right there: announce only.
    s.patchDay({ xiaoStreak: streak });
    announce(`${COPY.jiaobei.name.xiao}：${COPY.jiaobei.result.xiao}`);
    return;
  }
  // 阴筊: exclude for today and reset. A rejected draw is never a confirmed one.
  s.patchHistory(cur.id, { jiaobei: [...prev, o], confirmed: false });
  const excluded = s.day.excluded.includes(cur.restaurantId) ? s.day.excluded : [...s.day.excluded, cur.restaurantId];
  s.patchDay({ excluded, xiaoStreak: 0 });
  s.showToast(COPY.jiaobei.result.yin);
  announce(`${COPY.jiaobei.name.yin}：${COPY.jiaobei.result.yin}`);
  afterReset = 'idle';
  beginReset();
}

/** 「跳过」: leave the 掷筊 ritual and return to the reveal. */
export function skipJiaobei(): void {
  const s = getState();
  if (s.phase !== 'jiaobei') return;
  rt.jiaobei.active = false;
  s.setJiaobeiResult(null);
  s.setPhase('reveal');
}

// ───────────────────────────── per-frame ─────────────────────────────

/** Trigger rule, abandon rule, meterMirror throttle, ensureToday and watchdogs. */
export function tick(dt: number, now: number): void {
  void dt;
  if (now - lastDayCheck > 1000) {
    lastDayCheck = now;
    ensureToday();
  }
  const s = getState();
  const sh = rt.shake;
  const auto = rt.input.auto;

  if (auto.active && auto.kind === 'quick' && now >= auto.until) {
    clearAuto();
    sh.stillMs = 0;
    if (s.phase === 'armed' && !sh.fullLatched) {
      // Numerical safety: a quick draw always ends full.
      sh.meter = 1;
      sh.fullLatched = true;
      sh.fullSince = now;
      bus.emit('meter-full', EMPTY);
    }
  }

  if (now - lastMirror >= 100) {
    const m = sh.meter;
    if (Math.abs(m - s.meterMirror) > 0.004 || (m === 0 && s.meterMirror !== 0)) {
      s.setMeterMirror(m);
      lastMirror = now;
    }
  }

  switch (s.phase) {
    case 'armed': {
      if (s.drawer !== null) break;
      const grabbing = rt.input.pointer.grabbing;
      if (sh.fullLatched) {
        const still = !auto.active && !grabbing && sh.stillMs >= CFG.sensors.stillMs;
        const forced = sh.fullSince !== null && now - sh.fullSince > CFG.sensors.forceDrawAfterFullMs;
        if (still || forced) triggerDraw();
      } else if (!auto.active && !grabbing && sh.meter < 0.02) {
        const quietSince = Math.max(sh.lastInputTs, s.phaseSince);
        if (now - quietSince > CFG.sensors.abandonMs) s.setPhase('idle');
      }
      break;
    }
    case 'drawing':
      if (now - s.phaseSince > CFG.watchdog.drawingMs) onDrawingDone();
      break;
    case 'resetting':
      if (now - s.phaseSince > CFG.watchdog.resettingMs) onResetDone();
      break;
    case 'jiaobei':
      if (rt.jiaobei.active && now - rt.jiaobei.t0 > CFG.watchdog.jiaobeiMs) onJiaobeiDone();
      break;
    default:
      break;
  }
}
