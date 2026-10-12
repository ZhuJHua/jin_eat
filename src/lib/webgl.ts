/**
 * WebGL capability probe plus the "stage ready" signal the UI waits on before
 * fading the poster. Lives in the entry chunk: no three.js imports here.
 */

export type WebGLKind = 'webgl2' | 'webgl' | 'none';

export interface WebGLInfo {
  kind: WebGLKind;
  /** Unmasked renderer string when the browser exposes it, otherwise the masked one ('' if none). */
  renderer: string;
  maxTextureSize: number;
}

let cached: WebGLInfo | null = null;

function probe(): WebGLInfo {
  if (typeof document === 'undefined') return { kind: 'none', renderer: '', maxTextureSize: 0 };
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false, antialias: false, depth: false, stencil: false };
    let kind: WebGLKind = 'none';
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', attrs);
    if (gl) kind = 'webgl2';
    else {
      gl = (canvas.getContext('webgl', attrs) ?? canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
      if (gl) kind = 'webgl';
    }
    if (!gl) return { kind: 'none', renderer: '', maxTextureSize: 0 };

    let renderer = '';
    try {
      // Firefox deprecated the debug extension but already returns the (sanitised) GPU in RENDERER.
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const raw: unknown = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      renderer = typeof raw === 'string' ? raw : '';
    } catch {
      renderer = '';
    }
    const maxRaw: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxTextureSize = typeof maxRaw === 'number' ? maxRaw : 2048;
    // Free the probe context right away (browsers cap live contexts at ~16).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { kind, renderer, maxTextureSize };
  } catch {
    return { kind: 'none', renderer: '', maxTextureSize: 0 };
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/** Cached probe result (creates and immediately releases one tiny context on first call). */
export function webglInfo(): WebGLInfo {
  if (!cached) cached = probe();
  return cached;
}

export function detectWebGL(): WebGLKind {
  return webglInfo().kind;
}

// ───────────────────────────── stage ready signal ─────────────────────────────

let stageReady = false;
const readyListeners = new Set<() => void>();

/**
 * Called by Stage once fonts, text textures and the shader warm-up are done (or timed out).
 * Also hides the inline `#poster` (idempotent; the UI may have hidden it earlier).
 */
export function markStageReady(): void {
  if (stageReady) return;
  stageReady = true;
  if (typeof document !== 'undefined') document.getElementById('poster')?.classList.add('is-hidden');
  for (const fn of Array.from(readyListeners)) {
    try {
      fn();
    } catch (err) {
      console.error('[webgl] stage-ready listener threw', err);
    }
  }
  readyListeners.clear();
}

/** Run `fn` once the 3D stage is warmed up (immediately if it already is). Returns an unsubscribe. */
export function onStageReady(fn: () => void): () => void {
  if (stageReady) {
    fn();
    return () => undefined;
  }
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}
