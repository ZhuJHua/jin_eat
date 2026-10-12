/**
 * Top-centre toast. Visual only: text that was not just announced is forwarded to the live region,
 * so screen readers hear it once.
 */
import { useEffect } from 'react';
import { useStore } from '@/state/store';
import { announce, lastAnnouncement } from '@/lib/announce';
import { holdFullRate } from '@/engine/loop';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const hideToast = useStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    holdFullRate(500);
    const last = lastAnnouncement();
    if (!last || !last.text.includes(toast.text)) announce(toast.text);
  }, [toast]);

  if (!toast) return null;
  return (
    // Position per layout (index.css .toast-host): portrait over the (faded) title, phone landscape
    // under the plaque, desktop under the plaque's frame.
    <div className="toast-host pointer-events-none fixed z-40 flex justify-center px-4">
      <button
        key={toast.id}
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={hideToast}
        className="toast lacquer pointer-events-auto flex max-w-[min(92vw,460px)] items-center gap-2.5 rounded-full px-5 py-2.5 text-[15px] tracking-wide text-paper"
      >
        <span className="inline-block h-2 w-2 flex-none rotate-45 bg-gold shadow-[0_0_10px_rgb(232_182_76/0.8)]" />
        <span className="font-brush text-[18px] leading-snug text-gold-soft">{toast.text}</span>
      </button>
    </div>
  );
}
