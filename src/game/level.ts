/** Dream cul-de-sac: axis-aligned shells the simulation and the renderer share. */

export type Block = {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
};

export const BOUNDARY = 36.5;

export const BLOCKS: Block[] = [
  { kind: "boiler", x: 0, z: 23, w: 14, d: 9, h: 7.2 },
  { kind: "chapel", x: 20, z: 14, w: 8, d: 9, h: 9 },
  { kind: "nursery", x: -19, z: 13, w: 8, d: 7, h: 5.2 },
  { kind: "manor", x: 21, z: -6, w: 9, d: 8, h: 6.4 },
  { kind: "diner", x: -21, z: -5, w: 10, d: 6.5, h: 4 },
  { kind: "school", x: 6, z: -21, w: 12, d: 7.5, h: 5.4 },
  { kind: "station", x: -12, z: -20, w: 7, d: 9, h: 3.5 },
  { kind: "cottage", x: -30, z: 18, w: 5.5, d: 5.5, h: 4.2 },
];

export const LAMPS: Array<[number, number]> = [
  [-10, 0],
  [10, 2],
  [0, -12],
  [-16, -12],
  [14, 6],
];

/** Hand-authored loot lawns. Filtered at match start so none sit inside a house. */
export const LOOT_SPOTS: Array<[number, number]> = [
  [-8, 4],
  [8, 5],
  [0, -8],
  [-6, -12],
  [12, -12],
  [-14, -2],
  [13, -16],
  [-28, 6],
  [28, -2],
  [28, 8],
  [-8, 16],
  [8, 18],
  [-24, -14],
  [16, -8],
  [-4, 10],
  [4, -16],
  [-16, 6],
  [24, 4],
  [-10, -18],
  [0, 12],
  [18, -16],
  [-26, -6],
  [10, 10],
  [-18, -16],
];

export const DREAMER_SPAWNS: Array<[number, number]> = [
  [0, 6.5],
  [-12, 2],
  [12, -2],
  [-4, -13],
];

export const MONSTER_SPAWN: [number, number] = [0, 14];

export const PATROL: Array<[number, number]> = [
  [0, 12],
  [14, 6],
  [16, -14],
  [0, -14],
  [-16, -8],
  [-14, 8],
  [-6, 16],
];

export function hitsBlock(x: number, z: number, radius: number): boolean {
  for (const b of BLOCKS) {
    const hx = b.w * 0.5 + radius;
    const hz = b.d * 0.5 + radius;
    if (Math.abs(x - b.x) <= hx && Math.abs(z - b.z) <= hz) return true;
  }
  return false;
}

export function outside(x: number, z: number, radius = 0): boolean {
  return Math.hypot(x, z) > BOUNDARY - radius;
}

export function lineBlocked(x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.65));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsBlock(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.12)) return true;
  }
  return false;
}

export function spotClear(x: number, z: number): boolean {
  const h = Math.hypot(x, z);
  return h > 4.2 && h < 32 && !hitsBlock(x, z, 1.05) && !outside(x, z, 1.2);
}

/** Slide against house walls, then keep the body inside the dream. */
export function moveCircle(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): { x: number; z: number } {
  let nx = x + dx;
  let nz = z;
  if (hitsBlock(nx, nz, radius) || outside(nx, nz, radius)) nx = x;
  let nx2 = nx;
  let nz2 = z + dz;
  if (hitsBlock(nx2, nz2, radius) || outside(nx2, nz2, radius)) nz2 = z;
  const h = Math.hypot(nx2, nz2);
  const limit = BOUNDARY - radius;
  if (h > limit && h > 0.0001) {
    nx2 *= limit / h;
    nz2 *= limit / h;
  }
  return { x: nx2, z: nz2 };
}
