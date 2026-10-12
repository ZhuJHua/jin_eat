/**
 * Rapier collision groups, encoded the same way as `interactionGroups()` from
 * @react-three/rapier: upper 16 bits = memberships, lower 16 bits = filter. Computed by hand so this
 * file stays free of any rapier import.
 *
 * | Group     | Collides with |
 * |-----------|---------------|
 * | TUBE = 0  | STICK         |
 * | STICK = 1 | TUBE, STICK   |
 * | ALTAR = 2 | HERO          |
 * | HERO = 3  | ALTAR         |
 */

const bit = (...groups: number[]): number => groups.reduce((m, g) => m | (1 << g), 0);
const pack = (memberships: number, filter: number): number => ((memberships & 0xffff) << 16) | (filter & 0xffff);

export const GROUP_INDEX = { TUBE: 0, STICK: 1, ALTAR: 2, HERO: 3 } as const;

export const G: { TUBE: number; STICK: number; ALTAR: number; HERO: number } = {
  TUBE: pack(bit(GROUP_INDEX.TUBE), bit(GROUP_INDEX.STICK)),
  STICK: pack(bit(GROUP_INDEX.STICK), bit(GROUP_INDEX.TUBE, GROUP_INDEX.STICK)),
  ALTAR: pack(bit(GROUP_INDEX.ALTAR), bit(GROUP_INDEX.HERO)),
  HERO: pack(bit(GROUP_INDEX.HERO), bit(GROUP_INDEX.ALTAR)),
};
