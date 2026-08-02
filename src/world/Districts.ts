/**
 * Five district rulesets and the map that decides which one owns a given
 * patch of ground. Districts exist to change how swinging feels, not to look
 * different — each one is a distinct rhythm problem.
 */

export type DistrictId = 'brownstones' | 'canyons' | 'bridge' | 'construction' | 'park';

export interface DistrictRules {
  id: DistrictId;
  name: string;
  /** Building height range in metres. */
  height: [number, number];
  /** Footprint edge length range in metres. */
  footprint: [number, number];
  /** Cells are this wide; smaller means a denser grid and faster rhythm. */
  cell: number;
  /** Facade texture-array layers this district draws from. */
  facades: number[];
  /** Roof texture-array layers. */
  roofs: number[];
  /** Per-instance tints, kept desaturated enough that the toon bands read. */
  tints: number[];
  /** Chance a given lot is left empty, creating avenues and yards. */
  gapChance: number;
}

export const PLAYFIELD = 1200;
export const HALF = PLAYFIELD / 2;

export const DISTRICTS: Record<DistrictId, DistrictRules> = {
  brownstones: {
    id: 'brownstones',
    name: 'The Brownstones',
    height: [12, 30],
    footprint: [14, 22],
    cell: 46,
    facades: [0, 3, 5],
    roofs: [6, 7],
    tints: [0xc98a72, 0xb4705d, 0xd9a888, 0xa9705f, 0xc59a84],
    gapChance: 0.14,
  },
  canyons: {
    id: 'canyons',
    name: 'The Canyons',
    height: [62, 165],
    // Smaller footprints than the 46m cell pitch, so towers stand apart and
    // there are real gaps to swing down instead of a solid wall of geometry.
    footprint: [22, 36],
    cell: 78,
    facades: [1, 2, 4],
    roofs: [8, 6],
    tints: [0x8fa6c4, 0x7f96b8, 0xa2b4cc, 0x6f8fae, 0x9fb0c0],
    gapChance: 0.2,
  },
  bridge: {
    id: 'bridge',
    name: 'The Bridge',
    height: [0, 0],
    footprint: [0, 0],
    cell: 60,
    facades: [2],
    roofs: [8],
    tints: [0xbf4a3a],
    gapChance: 1,
  },
  construction: {
    id: 'construction',
    name: 'The Frames',
    height: [34, 92],
    footprint: [22, 34],
    cell: 58,
    facades: [1, 4],
    roofs: [6],
    tints: [0xd0a34a, 0xb8903f, 0x9aa0a4],
    gapChance: 0.3,
  },
  park: {
    id: 'park',
    name: 'The Park',
    height: [0, 0],
    footprint: [0, 0],
    cell: 60,
    facades: [3],
    roofs: [7],
    tints: [0x4f8f4a],
    gapChance: 1,
  },
};

/**
 * River trench. Narrow: a 138m canal running the full length of the map read
 * as an aqueduct and turned a tenth of the playfield into a fall hazard with
 * nothing to grab.
 */
export const RIVER = { xMin: 214, xMax: 300, waterY: -7 };
/** Where the suspension bridge crosses. */
export const BRIDGE = {
  z: 10,
  towerX: [RIVER.xMin + 8, RIVER.xMax - 8],
  towerHeight: 128,
  deckY: 34,
  /** How far the approach spans reach past each bank. */
  approach: 36,
  /** Half-width of the corridor kept clear of buildings. */
  halfZ: 26,
};
export const PARK = { x: -330, z: 316, rx: 160, rz: 128 };
export const SITE = { x: -348, z: -330, half: 118 };
/**
 * Downtown. Large on purpose: this is the only district with the vertical
 * density a continuous swing needs, and a run that leaves it should be a
 * choice, not the default.
 */
export const CANYON = { x: -40, z: -20, r: 386 };

/** True inside the bridge deck corridor, where nothing may be built. */
export function inBridgeCorridor(x: number, z: number): boolean {
  return (
    Math.abs(z - BRIDGE.z) < BRIDGE.halfZ &&
    x > RIVER.xMin - BRIDGE.approach - 10 &&
    x < RIVER.xMax + BRIDGE.approach + 10
  );
}

/**
 * Which district owns a world position. Order is the priority order — the
 * river cuts through downtown rather than being pushed around it, which is
 * what gives the canyons their best sightlines.
 */
export function districtAt(x: number, z: number): DistrictId {
  if (x >= RIVER.xMin && x <= RIVER.xMax) return 'bridge';
  const px = (x - PARK.x) / PARK.rx;
  const pz = (z - PARK.z) / PARK.rz;
  if (px * px + pz * pz < 1) return 'park';
  if (Math.abs(x - SITE.x) < SITE.half && Math.abs(z - SITE.z) < SITE.half) return 'construction';
  const dx = x - CANYON.x;
  const dz = z - CANYON.z;
  if (dx * dx + dz * dz < CANYON.r * CANYON.r) return 'canyons';
  return 'brownstones';
}

/** 0 at a district's edge, 1 well inside it — used to taper heights. */
export function districtWeight(x: number, z: number, id: DistrictId): number {
  if (id === 'canyons') {
    const d = Math.hypot(x - CANYON.x, z - CANYON.z);
    return 1 - Math.min(1, Math.max(0, (d - CANYON.r * 0.3) / (CANYON.r * 0.7)));
  }
  return 1;
}
