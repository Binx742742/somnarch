/** Lamps and parked cars the neighborhood already draws. Wear targets use this same list. */

import { BLOCKS, BOUNDARY, LAMPS, groundY, hitsBlock } from "./level";
import { orient, surfaceAt } from "./roads";

export const CAR_PAINTS = [0x6e3030, 0xd8d0c2, 0x243028, 0x8a6238, 0x3a4048] as const;

const LAMP_SPOTS: Array<[number, number]> = [
  ...LAMPS,
  [0, 12.4],
  [-9.2, -5.5],
  [9.4, -5.5],
  [-4.15, -14.2],
  [-16, 20.2],
  [3.2, 6.5],
];

export type ParkedCar = { x: number; z: number; yaw: number; paint: number };

export function streetLamps(): Array<[number, number]> {
  return LAMP_SPOTS.filter(([x, z]) => !hitsBlock(x, z, 0.5) && Math.hypot(x, z) <= BOUNDARY - 2);
}

/** Same poses `buildCars` used to invent inline, so a worn car matches the one in the street. */
export function parkedCars(): ParkedCar[] {
  const out: ParkedCar[] = [];
  for (const block of BLOCKS) {
    if (block.kind === "boiler" || block.kind === "chapel" || block.kind === "tower" || block.kind === "mausoleum") continue;
    const face = orient(block);
    const hd = face.depth * 0.5;
    const side = face.width * 0.22;
    const dist = 3.1;
    const x = block.x + face.nx * (hd + dist) + face.tx * side;
    const z = block.z + face.nz * (hd + dist) + face.tz * side;
    if (hitsBlock(x, z, 0.8) || Math.hypot(x, z) > BOUNDARY - 2 || groundY(x, z) > 0.35) continue;
    if (surfaceAt(x, z) === "island") continue;
    out.push({
      x,
      z,
      yaw: Math.atan2(face.nx, face.nz),
      paint: CAR_PAINTS[out.length % CAR_PAINTS.length]!,
    });
  }
  return out;
}
