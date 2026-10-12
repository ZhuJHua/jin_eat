/**
 * App shell: boot (WebGL detection, quality tier, #team= links, gate decision), the lazily loaded
 * 3D stage (or the 2D shrine), HUD, reveal scroll, drawers, gate, toast and the live region.
 */
import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { QualityPref, QualityTier } from '@/types';
import { COPY } from '@/data/copy';
import { bootTo, registerPreload } from '@/draw/controller';
import { bus } from '@/lib/bus';
import { detectInitialTier, tierForPref } from '@/lib/quality';
import { detectWebGL, onStageReady } from '@/lib/webgl';
import { audio } from '@/audio/synth';
import { attachKeys } from '@/sensors/keys';
import { motionCapability } from '@/sensors/permission';
import { computeReducedMotion, getState, reducedMotionQuery, useStore } from '@/state/store';
import { Announcer } from '@/ui/Announcer';
import { ControlBar } from '@/ui/ControlBar';
import { DebugHud } from '@/ui/DebugHud';
import { FortuneScroll } from '@/ui/FortuneScroll';
import { Gate } from '@/ui/Gate';
import { Header, WeeklyCard } from '@/ui/Header';
import { HintChip } from '@/ui/HintChip';
import { ShakeButton } from '@/ui/ShakeButton';
import { SrStickList } from '@/ui/SrStickList';
import { StickTooltip } from '@/ui/StickTooltip';
import { Toast } from '@/ui/Toast';
import { useScrollLayout } from '@/ui/hooks';
import { hidePoster } from '@/ui/intent';

const Stage = lazy(() => import('@/three/Stage'));
const Fallback2D = lazy(() => import('@/ui/Fallback2D'));

// Drawers are split out of the entry chunk and prefetched once the page is idle.
const loadList = () => import('@/ui/ListDrawer');
const loadHistory = () => import('@/ui/HistoryDrawer');
const loadSettings = () => import('@/ui/SettingsDrawer');
const loadOdds = () => import('@/ui/OddsPanel');
const loadShare = () => import('@/ui/ShareSheet');
const ListDrawer = lazy(() => loadList().then((m) => ({ default: m.ListDrawer })));
const HistoryDrawer = lazy(() => loadHistory().then((m) => ({ default: m.HistoryDrawer })));
const SettingsDrawer = lazy(() => loadSettings().then((m) => ({ default: m.SettingsDrawer })));
const OddsPanel = lazy(() => loadOdds().then((m) => ({ default: m.OddsPanel })));
const ShareSheet = lazy(() => loadShare().then((m) => ({ default: m.ShareSheet })));

function prefetchDrawers(): void {
  for (const load of [loadList, loadHistory, loadSettings, loadOdds, loadShare]) void load().catch(() => undefined);
}

const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';
const RELOAD_FLAG = 'jinshao-chunk-reload';

function tierFor(pref: QualityPref): QualityTier {
  const fixed = tierForPref(pref);
  if (fixed !== null) return fixed;
  try {
    return detectInitialTier();
  } catch {
    return 1;
  }
}

function preloadStage(): void {
  const s = getState();
  if (s.webgl !== 'ok' || s.settings.quality === 'flat') {
    void import('@/ui/Fallback2D');
    return;
  }
  void import('@/three/Stage').catch(() => undefined);
  if (s.tier >= 1) void import('@/three/physics/PhysicsLayer').catch(() => undefined);
}

/** Parse `#team=<phrase>`, join team mode and clean the URL. */
function joinTeamFromHash(): void {
  if (typeof location === 'undefined') return;
  const m = /(?:^#|&)team=([^&]*)/.exec(location.hash);
  if (!m) return;
  let phrase: string;
  try {
    phrase = decodeURIComponent((m[1] ?? '').replace(/\+/g, ' '))
      .trim()
      .slice(0, 40);
  } catch {
    phrase = '';
  }
  try {
    history.replaceState(history.state, '', location.pathname + location.search);
  } catch {
    // ignore (sandboxed iframes)
  }
  if (!phrase) return;
  const s = getState();
  s.updateSettings({ teamMode: true, teamPhrase: phrase });
  s.showToast(COPY.toast.teamJoined(phrase));
}

function syncReducedAttr(v: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.reduced = v ? 'true' : 'false';
}

let booted = false;

/** Boot once before the first render: detection, preferences, team link, gate decision. */
export function bootApp(): void {
  if (booted) return;
  booted = true;
  const s = getState();

  let gl: ReturnType<typeof detectWebGL>;
  try {
    gl = detectWebGL();
  } catch {
    gl = 'none';
  }
  if (gl === 'none') s.setWebgl('none');
  s.setTier(tierFor(s.settings.quality));
  syncReducedAttr(s.reducedMotion);
  joinTeamFromHash();
  registerPreload(preloadStage);

  const cap = motionCapability();
  const st = s.settings.motionStatus;
  const remembered = st === 'granted' || st === 'not-required';
  const gateNeeded = cap.coarse && cap.hasMotion && cap.secure && (cap.needsPermission || !remembered);
  bootTo(gateNeeded);
}

function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(msg);
}

class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[stage] failed, switching to 2D', error, info.componentStack);
    // A new deploy may have removed the old hashed chunk: reload once to pick up the new build.
    if (isChunkError(error)) {
      let reloaded: boolean;
      try {
        reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        reloaded = true;
      }
      if (!reloaded && navigator.onLine) {
        location.reload();
        return;
      }
    }
    getState().setWebgl('none');
    getState().showToast(COPY.fallback.noWebgl);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Mounted next to <Stage/> inside the same Suspense boundary: the chunk has resolved and rendered. */
function StageMounted() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      // storage unavailable
    }
    // The stage calls markStageReady() after its shader warm-up; fade the poster then.
    return onStageReady(() => hidePoster());
  }, []);
  return null;
}

function useGlobalEffects(): void {
  const sound = useStore((s) => s.settings.sound);
  const quality = useStore((s) => s.settings.quality);
  const reduced = useStore((s) => s.reducedMotion);

  useEffect(() => attachKeys(), []);

  useEffect(() => {
    audio.setMuted(!sound);
  }, [sound]);

  // Quality preference → tier (the stage's governor refines 'auto' at runtime).
  useEffect(() => {
    getState().setTier(tierFor(quality));
  }, [quality]);

  // Effective reduced motion: setting + live media query.
  useEffect(() => {
    syncReducedAttr(reduced);
  }, [reduced]);
  useEffect(() => {
    const mq = reducedMotionQuery();
    if (!mq) return;
    const onChange = (): void => {
      const s = getState();
      s.setReducedMotion(computeReducedMotion(s.settings, mq.matches));
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Audio needs a user gesture: unlock on the first one anywhere (desktop skips the gate).
  useEffect(() => {
    const unlock = (): void => {
      audio.unlock();
      if (getState().phase !== 'gate') audio.startAmbience();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // #team= links pasted into an open tab.
  useEffect(() => {
    const onHash = (): void => joinTeamFromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // WebGL trouble → toasts.
  useEffect(() => {
    const off = bus.on('context-lost', () => getState().showToast(COPY.toast.contextLost));
    const unsub = useStore.subscribe((s, prev) => {
      if (s.webgl === 'lost' && prev.webgl !== 'lost') s.showToast(COPY.toast.fallback2d);
    });
    return () => {
      off();
      unsub();
    };
  }, []);

  // Never leave the poster up forever (slow chunk, blocked GPU…).
  useEffect(() => {
    const t = window.setTimeout(() => hidePoster(), 8000);
    return () => window.clearTimeout(t);
  }, []);
}

/** Keep the gate mounted briefly after it is passed so it can fade out. */
function useGatePresence(): { show: boolean; leaving: boolean } {
  const phase = useStore((s) => s.phase);
  const [leaving, setLeaving] = useState(false);
  const [show, setShow] = useState(phase === 'gate');
  useEffect(() => {
    if (phase === 'gate') {
      setShow(true);
      setLeaving(false);
      return;
    }
    if (!show) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setShow(false);
      setLeaving(false);
    }, 520);
    return () => window.clearTimeout(t);
  }, [phase, show]);
  return { show, leaving };
}

function DrawerBody({ drawer }: { drawer: NonNullable<ReturnType<typeof useStore.getState>['drawer']> }) {
  switch (drawer) {
    case 'list':
      return <ListDrawer />;
    case 'history':
      return <HistoryDrawer />;
    case 'settings':
      return <SettingsDrawer />;
    case 'odds':
      return <OddsPanel />;
    case 'share':
      return <ShareSheet />;
  }
}

function DrawerHost() {
  const drawer = useStore((s) => s.drawer);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(prefetchDrawers, { timeout: 4000 });
    else window.setTimeout(prefetchDrawers, 2500);
  }, []);
  if (!drawer) return null;
  return (
    <Suspense fallback={null}>
      <DrawerBody drawer={drawer} />
    </Suspense>
  );
}

function BottomDock() {
  const phase = useStore((s) => s.phase);
  const layout = useScrollLayout();
  const revealing = phase === 'reveal' || phase === 'jiaobei';
  const busy = phase === 'drawing' || phase === 'resetting';

  if (revealing) {
    // The scroll owns the actions; keep the secondary bar reachable when the scroll is docked right.
    if (layout === 'bottom') return null;
    return (
      <div
        className="absolute bottom-0 left-0"
        style={{ paddingLeft: 'calc(var(--sal) + 14px)', paddingBottom: 'calc(var(--sab) + 14px)' }}
      >
        <ControlBar />
      </div>
    );
  }

  return (
    // Portrait: a centred column. Phone landscape and desktop: corners (bar left, chip centre, button
    // right) so nothing sits on the tube or on the altar where the stick lands.
    <div className="pass absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 short:flex-row short:items-end short:justify-between desk:flex-row desk:items-end desk:justify-between desk:pl-[calc(var(--sal)+22px)] desk:pr-[calc(var(--sar)+32px)] desk:pb-[calc(var(--sab)+22px)] pb-[calc(var(--sab)+14px)] pl-[calc(var(--sal)+14px)] pr-[calc(var(--sar)+14px)]">
      <div className="pointer-events-none order-0 short:absolute short:inset-x-0 short:bottom-[calc(var(--sab)+18px)] desk:absolute desk:inset-x-0 desk:bottom-[calc(var(--sab)+30px)]">
        <HintChip />
      </div>
      <div
        className={`order-1 transition-opacity duration-300 ${busy ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        aria-hidden={busy || undefined}
      >
        <ControlBar />
      </div>
      <div
        className={`order-2 transition-[opacity,translate] duration-500 ${busy ? 'pointer-events-none translate-y-4 opacity-0 delay-[400ms]' : 'opacity-100'}`}
      >
        <ShakeButton />
      </div>
    </div>
  );
}

export function App() {
  const phase = useStore((s) => s.phase);
  const webgl = useStore((s) => s.webgl);
  const quality = useStore((s) => s.settings.quality);
  const drawer = useStore((s) => s.drawer);
  const gate = useGatePresence();
  useGlobalEffects();

  const use2D = webgl !== 'ok' || quality === 'flat';
  const hudHidden = phase === 'boot' || phase === 'gate';

  return (
    <div className="app-root" data-phase={phase}>
      <div className="stage-layer" role="img" aria-label={COPY.app.canvasLabel}>
        {use2D ? (
          <Suspense fallback={null}>
            <Fallback2D />
          </Suspense>
        ) : (
          <StageBoundary>
            <Suspense fallback={null}>
              <Stage />
              <StageMounted />
            </Suspense>
          </StageBoundary>
        )}
      </div>

      <main
        className="hud"
        aria-label={COPY.app.title}
        inert={drawer !== null || hudHidden}
        style={{ opacity: hudHidden ? 0 : 1, transition: 'opacity 0.5s ease' }}
      >
        <Header />
        <WeeklyCard />
        <BottomDock />
        <FortuneScroll />
        <StickTooltip />
        <SrStickList />
      </main>

      <DrawerHost />
      {gate.show ? <Gate leaving={gate.leaving} /> : null}
      <Toast />
      <Announcer />
      {DEBUG ? <DebugHud /> : null}
    </div>
  );
}
