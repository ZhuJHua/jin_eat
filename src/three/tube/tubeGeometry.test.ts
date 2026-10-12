import { describe, expect, it } from 'vitest';
import { CFG } from '@/config';
import { TUBE_DIMS } from './tubeGeometry';

describe('tube geometry', () => {
  it('TUBE_DIMS agrees with CFG.tube (rendered tube matches the draw timeline and physics)', () => {
    expect(TUBE_DIMS).toMatchObject({ rimY: CFG.tube.rimY, innerR: CFG.tube.innerR, floorY: CFG.tube.floorY });
  });
});
