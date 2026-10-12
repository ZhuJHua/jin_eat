/**
 * Keyboard map: Space (hold to shake), Enter (quick draw), J (掷筊), R (再求一签),
 * S (分享), M (静音), E (名单), H (签簿), Q (设置), Esc (close drawer).
 *
 * Rules:
 *  - never while typing (inputs, textareas, selects, contenteditable) or composing with an IME;
 *  - never with Ctrl/Meta/Alt (browser shortcuts keep working);
 *  - with a drawer open only Esc is handled (the Drawer's focus trap owns the rest);
 *  - Space/Enter on other focused buttons keep their native behaviour. The main shake button
 *    carries `data-shake-button`, so Space on it means "hold to shake" rather than "click".
 */
import { COPY } from '@/data/copy';
import { announce } from '@/lib/announce';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { endHold, quickDraw, reshake, startHold, throwJiaobei } from '@/draw/controller';

/** Attribute the UI puts on the main 「摇签」 button. */
export const SHAKE_BUTTON_ATTR = 'data-shake-button';

function isEditable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(type);
  }
  return false;
}

function isShakeButton(el: Element | null): boolean {
  return !!el && el instanceof HTMLElement && el.closest(`[${SHAKE_BUTTON_ATTR}]`) !== null;
}

/** Focus is "nowhere in particular": body, the document element or the stage canvas. */
function isNeutral(el: Element | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  return el instanceof HTMLCanvasElement || (el instanceof HTMLElement && el.dataset.stage !== undefined);
}

/** Interactive element that would handle Space/Enter natively. */
function isInteractive(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  return (
    el.closest(
      'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="option"]',
    ) !== null
  );
}

function letter(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  return null;
}

/** Attach the global keyboard handler. Returns a detach function. */
export function attachKeys(): () => void {
  let spaceHeld = false;

  const releaseSpace = (): void => {
    if (!spaceHeld) return;
    spaceHeld = false;
    endHold();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = getState();
    const target = (e.target instanceof Element ? e.target : null) ?? document.activeElement;

    if (e.key === 'Escape') {
      if (s.drawer !== null) {
        s.closeDrawer();
        e.preventDefault();
      }
      return;
    }
    if (s.drawer !== null) return;
    if (s.phase === 'boot' || s.phase === 'gate') return;
    if (isEditable(target)) return;

    if (e.code === 'Space' || e.key === ' ') {
      const own = isNeutral(target) || isShakeButton(target);
      if (!own) return; // let other buttons click natively
      e.preventDefault();
      if (e.repeat || spaceHeld) return;
      if (s.phase !== 'idle' && s.phase !== 'armed') return;
      spaceHeld = true;
      startHold('key');
      return;
    }

    if (e.key === 'Enter') {
      // On the main button the native click already runs quickDraw.
      if (!isNeutral(target) || e.repeat) return;
      if (s.phase !== 'idle' && s.phase !== 'armed') return;
      e.preventDefault();
      quickDraw();
      return;
    }

    if (e.repeat) return;
    const k = letter(e);
    if (!k) return;
    // Letters are shortcuts even when a button has focus, but not inside other widgets.
    if (!isNeutral(target) && !isInteractive(target)) return;

    switch (k) {
      case 'J':
        if (!s.settings.ritualJiaobei) return;
        if (s.current && s.day.lockedDrawId === s.current.id) return;
        if (s.phase === 'reveal' || (s.phase === 'jiaobei' && !rt.jiaobei.active)) throwJiaobei();
        break;
      case 'R':
        reshake();
        break;
      case 'S':
        if (s.current && (s.phase === 'reveal' || s.phase === 'jiaobei')) s.openDrawer('share');
        break;
      case 'M': {
        const on = !s.settings.sound;
        s.updateSettings({ sound: on });
        announce(on ? `${COPY.control.sound}已开启` : `${COPY.control.mute}`);
        break;
      }
      case 'E':
        if (s.phase !== 'drawing') s.openDrawer('list');
        break;
      case 'H':
        s.openDrawer('history');
        break;
      case 'Q':
        s.openDrawer('settings');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.key === ' ') {
      if (spaceHeld) e.preventDefault();
      releaseSpace();
    }
  };

  const onBlur = (): void => releaseSpace();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') releaseSpace();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    releaseSpace();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
