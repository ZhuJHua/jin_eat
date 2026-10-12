/**
 * Visually hidden live region fed by lib/announce. Two alternating regions guarantee that
 * identical consecutive messages are still read out.
 */
import { useEffect, useState } from 'react';
import { lastAnnouncement, subscribeAnnounce } from '@/lib/announce';

export function Announcer() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(() => lastAnnouncement());

  useEffect(() => {
    let raf = 0;
    const off = subscribeAnnounce((text, id) => {
      cancelAnimationFrame(raf);
      // Next frame so the DOM mutation is a separate change from any focus move in the same tick.
      raf = requestAnimationFrame(() => setMsg({ text, id }));
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, []);

  const slot = msg ? msg.id % 2 : 0;
  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true">
        {msg && slot === 0 ? msg.text : ''}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {msg && slot === 1 ? msg.text : ''}
      </div>
    </div>
  );
}
