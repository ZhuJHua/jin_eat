import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getState, sanitizePersisted } from '@/state/store';

describe('settings.motionSensitivity', () => {
  it("defaults to 'mid'", () => {
    expect(DEFAULT_SETTINGS.motionSensitivity).toBe('mid');
  });

  it("v1 saves without the field load as 'mid' and keep their other settings", () => {
    const p = sanitizePersisted({ settings: { sound: false, lowMotion: 'on' } });
    expect(p.settings.motionSensitivity).toBe('mid');
    expect(p.settings.sound).toBe(false);
    expect(p.settings.lowMotion).toBe('on');
  });

  it('keeps valid values and replaces junk', () => {
    for (const v of ['low', 'mid', 'high'] as const) {
      expect(sanitizePersisted({ settings: { motionSensitivity: v } }).settings.motionSensitivity).toBe(v);
    }
    for (const v of ['turbo', 3, null, 'HIGH']) {
      expect(sanitizePersisted({ settings: { motionSensitivity: v } }).settings.motionSensitivity).toBe('mid');
    }
  });

  it('updateSettings applies immediately (sensors read it per event)', () => {
    getState().updateSettings({ motionSensitivity: 'low' });
    expect(getState().settings.motionSensitivity).toBe('low');
    getState().updateSettings({ motionSensitivity: 'mid' });
  });
});
