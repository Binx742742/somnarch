/** Shared cul-de-sac layout numbers. The ground shader interpolates these so paint and props agree. */

import { BLOCKS, type Block } from "./level";

export const ROAD = {
  bulbIn: 3.9,
  bulbOut: 8.45,
  walkOut: 9.65,
  spokeHalf: 2.42,
  walkExtra: 1.15,
  driveHalf: 1.45,
  driveReach: 7.2,
  dirtHalf: 1.55,
};

type Strip = { axis: 0 | 1; fixed: number; half: number; min: number; max: number };

/** axis 0: runs along X, `fixed` is Z. axis 1: runs along Z, `fixed` is X. */
export const STRIPS: Strip[] = [
  { axis: 0, fixed: -5.5, half: ROAD.spokeHalf, min: -64, max: 66 },
  { axis: 1, fixed: 0, half: ROAD.spokeHalf, min: 2.4, max: 38 },
  { axis: 1, fixed: -4.15, half: 2.2, min: -16.2, max: -2.6 },
  { axis: 0, fixed: -12.35, half: 1.85, min: -8.4, max: 9.4 },
  { axis: 0, fixed: -30, half: 2.15, min: -44, max: 40 },
  { axis: 1, fixed: -34, half: 2.15, min: -40, max: 24 },
  { axis: 1, fixed: 40, half: 2.15, min: -38, max: 26 },
  { axis: 0, fixed: 36, half: 2.15, min: -28, max: 30 },
  { axis: 1, fixed: 2, half: 2.05, min: -42, max: -26 },
  { axis: 1, fixed: -54, half: 2.05, min: -32, max: 28 },
  { axis: 1, fixed: 56, half: 2.05, min: -40, max: 16 },
];

export const DIRT: Strip[] = [
  { axis: 1, fixed: -10, half: ROAD.dirtHalf, min: 6.4, max: 21.1 },
  { axis: 0, fixed: 21.05, half: ROAD.dirtHalf, min: -28.2, max: -10 },
  { axis: 1, fixed: -27.15, half: ROAD.dirtHalf, min: 15.2, max: 21.1 },
  { axis: 1, fixed: 8, half: ROAD.dirtHalf, min: 38, max: 54 },
];

export type Surface = "island" | "pad" | "asphalt" | "walk" | "drive" | "dirt" | "lawn";

export type Front = {
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  depth: number;
  width: number;
};

export function orient(b: Block): Front {
  const ax = Math.abs(b.x);
  const az = Math.abs(b.z);
  let nx = 0;
  let nz = 0;
  if (ax >= az) nx = b.x >= 0 ? -1 : 1;
  else nz = b.z >= 0 ? -1 : 1;
  return {
    nx,
    nz,
    tx: -nz,
    tz: nx,
    depth: nx !== 0 ? b.w : b.d,
    width: nx !== 0 ? b.d : b.w,
  };
}

function onStrip(x: number, z: number, strips: Strip[], widen = 0): boolean {
  for (const s of strips) {
    const lat = s.axis === 0 ? z - s.fixed : x - s.fixed;
    const lon = s.axis === 0 ? x : z;
    if (Math.abs(lat) <= s.half + widen && lon >= s.min && lon <= s.max) return true;
  }
  return false;
}

function onPad(x: number, z: number): boolean {
  for (const b of BLOCKS) {
    if (Math.abs(x - b.x) <= b.w * 0.5 + 0.35 && Math.abs(z - b.z) <= b.d * 0.5 + 0.35) return true;
  }
  return false;
}

function onDrive(x: number, z: number): boolean {
  for (const b of BLOCKS) {
    const f = orient(b);
    const hd = f.depth * 0.5;
    const fx = b.x + f.nx * hd;
    const fz = b.z + f.nz * hd;
    const dx = x - fx;
    const dz = z - fz;
    const along = dx * f.nx + dz * f.nz;
    const side = dx * f.tx + dz * f.tz;
    if (along > 0.2 && along < ROAD.driveReach && Math.abs(side) < ROAD.driveHalf) return true;
  }
  return false;
}

export function surfaceAt(x: number, z: number): Surface {
  const r = Math.hypot(x, z);
  if (onPad(x, z)) return "pad";
  if (r <= ROAD.bulbIn) return "island";
  if (r <= ROAD.bulbOut || onStrip(x, z, STRIPS)) return "asphalt";
  if (r <= ROAD.walkOut || onStrip(x, z, STRIPS, ROAD.walkExtra)) return "walk";
  if (onDrive(x, z)) return "drive";
  if (onStrip(x, z, DIRT)) return "dirt";
  return "lawn";
}

export function driveFronts(): Array<{ x: number; z: number; nx: number; nz: number }> {
  return BLOCKS.map((b) => {
    const f = orient(b);
    const hd = f.depth * 0.5;
    return { x: b.x + f.nx * hd, z: b.z + f.nz * hd, nx: f.nx, nz: f.nz };
  });
}
