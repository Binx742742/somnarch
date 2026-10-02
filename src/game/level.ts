/** Dream neighborhood: axis-aligned shells the simulation and the renderer share. */

export type Block = {
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Walkable room: walls with a street-facing door instead of a solid footprint. */
  interior?: boolean;
};

export const BOUNDARY = 74;

/** Overlook north-east of the mill. Characters and the hill mesh share this profile. */
export const HILL = { x: 8, z: 56, r: 7.2, h: 3.8 };

export const BLOCKS: Block[] = [
  { kind: "boiler", x: 0, z: 23, w: 14, d: 9, h: 7.2 },
  { kind: "chapel", x: 20, z: 14, w: 8, d: 9, h: 9, interior: true },
  { kind: "nursery", x: -19, z: 13, w: 8, d: 7, h: 5.2 },
  { kind: "manor", x: 21, z: -6, w: 9, d: 8, h: 6.4 },
  { kind: "diner", x: -21, z: -5, w: 10, d: 6.5, h: 4, interior: true },
  { kind: "school", x: 6, z: -21, w: 12, d: 7.5, h: 5.4, interior: true },
  { kind: "station", x: -12, z: -20, w: 7, d: 9, h: 3.5 },
  { kind: "cottage", x: -30, z: 18, w: 5.5, d: 5.5, h: 4.2 },
  { kind: "bungalow", x: 48, z: -16, w: 8, d: 7, h: 5 },
  { kind: "garage", x: 46, z: 8, w: 8, d: 6, h: 4.2 },
  { kind: "library", x: 36, z: 30, w: 10, d: 8, h: 6.6 },
  { kind: "greenhouse", x: -48, z: -14, w: 10, d: 6, h: 3.6 },
  { kind: "funeral", x: -46, z: 10, w: 9, d: 8, h: 5.6, interior: true },
  { kind: "lodge", x: -36, z: -34, w: 8, d: 7, h: 5.2 },
  { kind: "mill", x: 14, z: 46, w: 12, d: 8, h: 6.2 },
  { kind: "tower", x: 8, z: 56, w: 4.2, d: 4.2, h: 2.2 },
  { kind: "mausoleum", x: 2, z: -48, w: 8, d: 10, h: 5.2, interior: true },
  { kind: "shed", x: 24, z: -38, w: 6, d: 5, h: 3.4 },
  { kind: "barn", x: -16, z: 44, w: 12, d: 9, h: 5.6, interior: true },
  { kind: "cabin", x: 52, z: 18, w: 6.5, d: 6, h: 4.4 },
  { kind: "rectory", x: 46, z: -26, w: 7, d: 7, h: 5.1 },
  { kind: "shelter", x: -6, z: -38, w: 8, d: 5, h: 3.2, interior: true },
  { kind: "radio", x: 64, z: 4, w: 9, d: 8, h: 5.4, interior: true },
  { kind: "orchard", x: -62, z: -24, w: 8, d: 7, h: 4.6, interior: true },
  { kind: "twin", x: -63, z: 22, w: 7, d: 6.5, h: 5 },
  { kind: "pump", x: 64, z: -18, w: 7, d: 6, h: 4.2 },
];

export const LAMPS: Array<[number, number]> = [
  [-10, 0],
  [10, 2],
  [0, -12],
  [-16, -12],
  [14, 6],
  [32, -6],
  [-34, -6],
  [2, -32],
  [14, 36],
  [-16, 34],
  [40, 16],
  [-40, 4],
  [54, 4],
  [-54, -8],
  [54, -20],
];

/** Hearths a lucid dreamer must kindle. Placed in open floor or just outside a door. */
export const WARD_SPOTS: Array<{ id: string; name: string; x: number; z: number }> = [
  { id: "chapel", name: "Chapel hearth", x: 20, z: 14 },
  { id: "grave", name: "Mausoleum hearth", x: 2, z: -48 },
  { id: "mill", name: "Mill hearth", x: 14, z: 40 },
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
  [34, -8],
  [40, 2],
  [44, -24],
  [28, -28],
  [-40, -6],
  [-32, 4],
  [-40, -24],
  [-28, -28],
  [8, -32],
  [-14, -30],
  [22, 24],
  [26, 36],
  [-8, 32],
  [-28, 30],
  [48, 8],
  [-52, -4],
  [8, -46],
  [-8, -46],
  [36, 18],
  [-22, 28],
  [18, 34],
  [56, 12],
  [54, -22],
  [-54, -16],
  [-54, 16],
  [48, -36],
];

export const DREAMER_SPAWNS: Array<[number, number]> = [
  [-56, 10],
  [-48, -30],
  [12, -56],
  [56, 26],
];

/** Far yard, so the open minutes are for learning the streets. */
export const MONSTER_SPAWN: [number, number] = [58, 36];

export type Shortcut = {
  id: string;
  kind: "fence" | "sewer" | "cellar";
  ax: number;
  az: number;
  bx: number;
  bz: number;
};

/** Two mouths. Dreamers slip across; only cellars let the butcher follow, and slowly. */
export const SHORTCUTS: Shortcut[] = [
  { id: "west-fence", kind: "fence", ax: -42, az: 16, bx: -22, bz: 36 },
  { id: "east-fence", kind: "fence", ax: 44, az: 20, bx: 36, bz: -32 },
  { id: "south-drain", kind: "sewer", ax: 8, az: -42, bx: -36, bz: -18 },
  { id: "east-drain", kind: "sewer", ax: 54, az: -10, bx: 28, bz: 8 },
  { id: "school-barn", kind: "cellar", ax: 6, az: -21, bx: -16, bz: 44 },
  { id: "shelter-diner", kind: "cellar", ax: -6, az: -38, bx: -21, bz: -5 },
  { id: "grave-chapel", kind: "cellar", ax: 2, az: -48, bx: 20, bz: 14 },
];

export const CAR_SPOTS: Array<{ id: string; x: number; z: number }> = [
  { id: "cul-car", x: 14, z: -6 },
  { id: "west-car", x: -14, z: 6 },
  { id: "south-car", x: 32, z: -30 },
  { id: "east-car", x: 40, z: -6 },
];

export const PATROL: Array<[number, number]> = [
  [0, 12],
  [14, 6],
  [40, -6],
  [32, 22],
  [14, 38],
  [0, -30],
  [2, -42],
  [-34, -20],
  [-40, 2],
  [-16, 34],
  [-6, 16],
  [58, 4],
  [-56, -12],
];

const WALL = 0.72;
const DOOR = 0.92;

const latchedDoors = new Set<string>();

/** Interior doors the simulation can latch. Ids match block.kind. */
export function setLatchedDoors(ids: readonly string[]): void {
  latchedDoors.clear();
  for (const id of ids) latchedDoors.add(id);
}

export type DoorSpot = { id: string; x: number; z: number };

export function doorSpots(): DoorSpot[] {
  const spots: DoorSpot[] = [];
  for (const b of BLOCKS) {
    if (!b.interior) continue;
    const f = front(b);
    const hd = f.nx !== 0 ? b.w * 0.5 : b.d * 0.5;
    spots.push({ id: b.kind, x: b.x + f.nx * (hd - 0.15), z: b.z + f.nz * (hd - 0.15) });
  }
  return spots;
}

/** Hinge pose for the street door. Local +X runs along the door; yaw 0 is closed. */
export type DoorPose = { id: string; x: number; z: number; yaw: number };

export function doorPoses(): DoorPose[] {
  const half = 0.78;
  const poses: DoorPose[] = [];
  for (const b of BLOCKS) {
    if (!b.interior) continue;
    const f = front(b);
    const hd = f.nx !== 0 ? b.w * 0.5 : b.d * 0.5;
    const cx = b.x + f.nx * (hd - 0.08);
    const cz = b.z + f.nz * (hd - 0.08);
    poses.push({
      id: b.kind,
      x: cx - f.tx * half,
      z: cz - f.tz * half,
      yaw: Math.atan2(-f.tz, f.tx),
    });
  }
  return poses;
}

function front(b: Block): { nx: number; nz: number; tx: number; tz: number } {
  const ax = Math.abs(b.x);
  const az = Math.abs(b.z);
  let nx = 0;
  let nz = 0;
  if (ax >= az) nx = b.x >= 0 ? -1 : 1;
  else nz = b.z >= 0 ? -1 : 1;
  return { nx, nz, tx: -nz, tz: nx };
}

function hitsShell(b: Block, x: number, z: number, radius: number): boolean {
  const hx = b.w * 0.5;
  const hz = b.d * 0.5;
  const ax = Math.abs(x - b.x);
  const az = Math.abs(z - b.z);
  if (ax > hx + radius || az > hz + radius) return false;
  const ix = hx - WALL;
  const iz = hz - WALL;
  if (ax < ix - radius && az < iz - radius) return false;
  const f = front(b);
  const along = (x - b.x) * f.tx + (z - b.z) * f.tz;
  const depth = (x - b.x) * f.nx + (z - b.z) * f.nz;
  const hd = f.nx !== 0 ? hx : hz;
  if (Math.abs(along) < DOOR && depth > hd - WALL - radius && depth < hd + radius) {
    return latchedDoors.has(b.kind);
  }
  return true;
}

export function hitsBlock(x: number, z: number, radius: number): boolean {
  for (const b of BLOCKS) {
    if (b.interior) {
      if (hitsShell(b, x, z, radius)) return true;
    } else if (Math.abs(x - b.x) <= b.w * 0.5 + radius && Math.abs(z - b.z) <= b.d * 0.5 + radius) {
      return true;
    }
  }
  return false;
}

export function outside(x: number, z: number, radius = 0): boolean {
  return Math.hypot(x, z) > BOUNDARY - radius;
}

/** Height of the walkable overlook. Zero everywhere else. */
export function groundY(x: number, z: number): number {
  const d = Math.hypot(x - HILL.x, z - HILL.z);
  if (d >= HILL.r) return 0;
  const t = 1 - d / HILL.r;
  return t * t * HILL.h;
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
  return h > 4.2 && h < BOUNDARY - 4 && !hitsBlock(x, z, 1.05) && !outside(x, z, 1.2);
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
