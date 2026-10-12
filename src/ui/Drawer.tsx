/**
 * Modal drawer: right-docked panel on desktop / landscape, bottom sheet on phones.
 * Focus is trapped inside, Esc closes, and focus returns to the opener on close.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Drawer as DrawerId } from '@/types';
import { COPY } from '@/data/copy';
import { useStore } from '@/state/store';
import { holdFullRate } from '@/engine/loop';
import { IconClose } from '@/ui/Icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );
}

/** Element that opened the most recent drawer (survives drawer → drawer hops like 设置 → 天机). */
let opener: HTMLElement | null = null;

export function Drawer(props: { id: DrawerId; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { id, title, subtitle, children, footer } = props;
  const closeDrawer = useStore((s) => s.closeDrawer);
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const reduced = useStore((s) => s.reducedMotion);

  const close = useCallback(() => {
    if (closing) return;
    if (reduced) {
      closeDrawer();
      return;
    }
    setClosing(true);
    holdFullRate(300);
    window.setTimeout(() => closeDrawer(), 190);
  }, [closing, closeDrawer, reduced]);

  // Remember the opener and move focus inside.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active) && active !== document.body) opener = active;
    holdFullRate(500);
    const panel = panelRef.current;
    if (!panel) return;
    const auto = panel.querySelector<HTMLElement>('[data-autofocus]');
    const first = auto ?? focusables(panel)[0] ?? panel;
    first.focus({ preventScroll: true });
  }, [id]);

  // Restore focus when the last drawer closes.
  useEffect(() => {
    return () => {
      const target = opener;
      window.setTimeout(() => {
        if (useStore.getState().drawer !== null) return;
        if (target && target.isConnected) target.focus({ preventScroll: true });
        else document.getElementById('shake-button')?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const list = focusables(panel);
    if (list.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="drawer-backdrop" data-closing={closing} onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        className="drawer-panel lacquer"
        data-closing={closing}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="drawer-head">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-brush text-[26px] leading-tight tracking-[0.12em] text-gold-soft text-glow-gold">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-[13px] tracking-wider text-paper/65">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label={COPY.a11y.drawerClose}>
            <IconClose />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="border-t border-gold/15 px-5 py-3">{footer}</footer> : null}
      </div>
    </>
  );
}

/** Accessible on/off switch row. */
export function SwitchRow(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { label, hint, checked, onChange, disabled } = props;
  const lid = useId();
  const hid = useId();
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div id={lid} className="text-[15px] tracking-wide">
          {label}
        </div>
        {hint ? (
          <div id={hid} className="mt-0.5 text-[12px] leading-snug text-paper/60">
            {hint}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={lid}
        aria-describedby={hint ? hid : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** Radio-group segmented control. Arrow keys move the selection. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { label, value, options, onChange } = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = options.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const o = options[j]!;
    onChange(o.value);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
