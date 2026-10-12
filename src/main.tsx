/**
 * Entry: styles, master loop, audio/haptics wiring, boot detection, the React tree and the service worker.
 * The brush font's @font-face CSS (~50 KB gzip) loads as a separate non-render-blocking chunk: the poster
 * paints with the Kaiti/serif fallback first; canvas painters wait on document.fonts.load themselves.
 */
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, bootApp } from '@/App';
import { wireAudioToBus } from '@/audio/synth';
import { startLoop } from '@/engine/loop';
import { wireHapticsToBus } from '@/lib/haptics';
import { loadBrushFontCss } from '@/lib/fonts';
import { registerSW } from '@/lib/sw';

void loadBrushFontCss();

wireAudioToBus();
wireHapticsToBus();
bootApp();
startLoop();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerSW();
