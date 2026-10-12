/**
 * UI-only cross-component hints that do not belong in the persisted store:
 * - which settings section to scroll to when a drawer opens (e.g. 「共签」 → team section);
 * - the inline poster in index.html (hidden once the stage is ready or a full-screen UI covers it);
 * - optional renderer stats for the ?debug=1 HUD (the 3D stage may write them every frame).
 */

export type SettingsSection = 'team' | 'motion' | null;

let section: SettingsSection = null;

export function setSettingsSection(s: SettingsSection): void {
  section = s;
}

/** Read and clear the pending section. */
export function takeSettingsSection(): SettingsSection {
  const s = section;
  section = null;
  return s;
}

let posterHidden = false;

/** Fade out the inline CSS poster (idempotent). */
export function hidePoster(): void {
  if (posterHidden || typeof document === 'undefined') return;
  posterHidden = true;
  const el = document.getElementById('poster');
  if (!el) return;
  el.classList.add('is-hidden');
  el.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => el.remove(), 900);
}

/** Renderer stats shown by DebugHud. The Stage may assign `gl.info.render.{calls,triangles}` here. */
export const debugStats: { calls: number; triangles: number; textures: number; geometries: number } = {
  calls: -1,
  triangles: -1,
  textures: -1,
  geometries: -1,
};
