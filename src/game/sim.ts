import {
  BLOCKS,
  CAR_SPOTS,
  DREAMER_SPAWNS,
  LAMPS,
  LOOT_SPOTS,
  MONSTER_SPAWN,
  PATROL,
  SHORTCUTS,
  TELLS,
  WARD_SPOTS,
  doorSpots,
  lineBlocked,
  moveCircle,
  outside,
  setLatchedDoors,
  spotClear,
} from "./level";

export type Role = "dreamer" | "somnarch";
export type ItemKind = "bandage" | "adrenaline" | "clock";
export type PickupKind = "fragment" | "phone" | ItemKind;

export type Input = {
  ix: number;
  iz: number;
  camYaw: number;
  sprint: boolean;
  atk: boolean;
  interactHeld: boolean;
  usePulse: boolean;
  ablPulse: boolean;
  dashPulse: boolean;
  /** R: tether (lucid dreamer) or stitch (Somnarch). Veil is Q before lucidity. */
  kitPulse: boolean;
};

export type Actor = {
  id: string;
  name: string;
  role: Role;
  bot: boolean;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  spd: number;
  hp: number;
  stamina: number;
  fragments: number;
  lucid: boolean;
  downed: boolean;
  dead: boolean;
  attackCd: number;
  abilityCd: number;
  dashCd: number;
  tetherCd: number;
  dodgeT: number;
  stun: number;
  iframes: number;
  /** 0 none, 1 wake, 2 revive, 3 kindle, 4 snuff, 5 latch, 6 break, 7 shortcut, 8 crank, 9 listen */
  channel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  channelT: number;
  channelTarget: string;
  items: ItemKind[];
  buffT: number;
  senseT: number;
  swing: number;
  downT: number;
  patrolI: number;
  stuckT: number;
  sideT: number;
  sideSign: number;
  botTap: number;
  hearT: number;
  /** Dreamer stealth pool. Panic breathing when it bottoms out. */
  nerve: number;
  veilT: number;
  markT: number;
  kitCd: number;
  huntX: number;
  huntZ: number;
  huntT: number;
  /** Dreamer dread. High fear is loud and spends stamina regen. */
  fear: number;
  /** Somnarch watch. A full stalk makes the next cleave heavier. */
  stalk: number;
  /** Car-crank speed. */
  burstT: number;
  snareCd: number;
  sawLight: boolean;
  usedReset: boolean;
  /** Whisper ids this dreamer has heard. */
  heard: string[];
  /** Somnarch heavy-cut windup. Pays off at 0 after it has been set. */
  commitT: number;
};

export type Snare = { id: string; x: number; z: number };
export type Car = { id: string; x: number; z: number; cd: number };

export type Pickup = {
  id: string;
  kind: PickupKind;
  x: number;
  z: number;
  taken: boolean;
};

export type Ward = {
  id: string;
  name: string;
  x: number;
  z: number;
  lit: boolean;
};

export type Door = {
  id: string;
  x: number;
  z: number;
  latched: boolean;
  hits: number;
  /** Seconds until the latch can rattle again. */
  rattle: number;
};

export type Match = {
  seed: number;
  time: number;
  actors: Actor[];
  pickups: Pickup[];
  wards: Ward[];
  doors: Door[];
  snares: Snare[];
  cars: Car[];
  phones: number;
  taughtLatch: boolean;
  phase: "play" | "win" | "lose";
  log: string[];
  banner: string;
  bannerT: number;
};

export type SimEvent =
  | { type: "hit"; victim: string; amount: number }
  | { type: "swing"; who: string }
  | { type: "pick"; who: string; kind: PickupKind }
  | { type: "lucid"; who: string }
  | { type: "down"; who: string }
  | { type: "death"; who: string }
  | { type: "stun" }
  | { type: "veil" }
  | { type: "ward" }
  | { type: "snuff" }
  | { type: "stitch" }
  | { type: "door"; broken: boolean }
  | { type: "listen" }
  | { type: "commit" }
  | { type: "win" }
  | { type: "lose" };

export type HumanSpec = { id: string; name: string; role: Role };

const BOT_DREAMERS = ["Vesper", "Ione", "Calder", "Bramble"];
const WAKE_NEED = 4;
const WAKE_TIME = 2.2;
const REVIVE_TIME = 1.9;
const WARD_TIME = 3.35;
const SNUFF_TIME = 2.45;
const LATCH_TIME = 1.15;
const BREAK_TIME = 2.1;
const DOOR_HITS = 3;
const DOOR_R = 1.62;
const OPEN_TIME = 150;
const LISTEN_R = 1.75;
const LISTEN_TIME = 0.95;
const COMMIT_TIME = 0.75;
const HOP_R = 1.7;
const ALTAR_R = 3.35;
const WARD_R = 2.15;
const TETHER_R = 4.7;
const TETHER_CD = 7.2;
const DREAMER_HP = 100;
const MONSTER_HP = 980;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function blankActor(partial: Pick<Actor, "id" | "name" | "role" | "bot" | "x" | "z">): Actor {
  const monster = partial.role === "somnarch";
  return {
    ...partial,
    yaw: monster ? Math.PI : 0,
    vx: 0,
    vz: 0,
    spd: 0,
    hp: monster ? MONSTER_HP : DREAMER_HP,
    stamina: 100,
    fragments: 0,
    lucid: false,
    downed: false,
    dead: false,
    attackCd: 0,
    abilityCd: monster ? 4 : 2,
    dashCd: 0.4,
    tetherCd: 1,
    dodgeT: 0,
    stun: 0,
    iframes: 0,
    channel: 0,
    channelT: 0,
    channelTarget: "",
    items: [],
    buffT: 0,
    senseT: 0,
    swing: 0,
    downT: 0,
    patrolI: 0,
    stuckT: 0,
    sideT: 0,
    sideSign: 1,
    botTap: 0,
    hearT: 0,
    nerve: 100,
    veilT: 0,
    markT: 0,
    kitCd: monster ? 2.5 : 1,
    huntX: 0,
    huntZ: 0,
    huntT: 0,
    fear: 0,
    stalk: 0,
    burstT: 0,
    snareCd: 0,
    sawLight: false,
    usedReset: false,
    heard: [],
    commitT: 0,
  };
}

export function createMatch(seed: number, humans: HumanSpec[]): Match {
  const rnd = mulberry32(seed || 1);
  const dreamers = humans.filter((h) => h.role === "dreamer").slice(0, 4);
  const monsterHuman = humans.find((h) => h.role === "somnarch") ?? null;
  while (dreamers.length < 4) {
    const name = BOT_DREAMERS[dreamers.length] ?? `Sleeper ${dreamers.length + 1}`;
    dreamers.push({ id: `bot-d${dreamers.length}`, name, role: "dreamer" });
  }
  const actors: Actor[] = dreamers.map((h, i) => {
    const spawn = DREAMER_SPAWNS[i] ?? DREAMER_SPAWNS[0]!;
    return blankActor({
      id: h.id,
      name: h.name,
      role: "dreamer",
      bot: h.id.startsWith("bot-"),
      x: spawn[0],
      z: spawn[1],
    });
  });
  actors.push(
    blankActor({
      id: monsterHuman?.id ?? "bot-mon",
      name: "The Somnarch",
      role: "somnarch",
      bot: !monsterHuman,
      x: MONSTER_SPAWN[0],
      z: MONSTER_SPAWN[1],
    }),
  );

  const spots = shuffle(
    LOOT_SPOTS.filter(([x, z]) => spotClear(x, z)),
    rnd,
  );
  const plan: PickupKind[] = [
    "fragment",
    "fragment",
    "fragment",
    "fragment",
    "fragment",
    "fragment",
    "fragment",
    "fragment",
    "bandage",
    "bandage",
    "bandage",
    "bandage",
    "adrenaline",
    "adrenaline",
    "adrenaline",
    "clock",
    "clock",
    "fragment",
    "fragment",
    "bandage",
    "bandage",
    "adrenaline",
    "clock",
    "phone",
    "phone",
    "phone",
  ];
  const pickups: Pickup[] = [];
  for (let i = 0; i < plan.length && i < spots.length; i++) {
    const spot = spots[i]!;
    pickups.push({
      id: `loot-${i}`,
      kind: plan[i]!,
      x: spot[0],
      z: spot[1],
      taken: false,
    });
  }

  return {
    seed,
    time: 0,
    actors,
    pickups,
    wards: WARD_SPOTS.map((w) => ({ ...w, lit: false })),
    doors: doorSpots().map((d) => ({ ...d, latched: false, hits: 0, rattle: 0 })),
    snares: [],
    cars: CAR_SPOTS.filter((c) => spotClear(c.x, c.z)).map((c) => ({ ...c, cd: 0 })),
    phones: 0,
    taughtLatch: false,
    phase: "play",
    log: ["The far yards are quiet. Learn the porches before he crosses town."],
    banner: "Find a porch light. Keys, then the hearths. The butcher is still out.",
    bannerT: 5.5,
  };
}

export function livingDreamers(m: Match): Actor[] {
  return m.actors.filter((a) => a.role === "dreamer" && !a.dead);
}

export function allLivingLucid(m: Match): boolean {
  const live = livingDreamers(m);
  return live.length > 0 && live.every((a) => a.lucid);
}

export function monsterOf(m: Match): Actor | undefined {
  return m.actors.find((a) => a.role === "somnarch");
}

function clockLabel(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function say(m: Match, text: string): void {
  m.log.unshift(text);
  if (m.log.length > 6) m.log.length = 6;
  m.banner = text;
  m.bannerT = 3.4;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function radiusOf(a: Actor): number {
  return a.role === "somnarch" ? 0.72 : 0.44;
}

function decay(a: Actor, dt: number): void {
  a.attackCd = Math.max(0, a.attackCd - dt);
  a.abilityCd = Math.max(0, a.abilityCd - dt);
  a.dashCd = Math.max(0, a.dashCd - dt);
  a.tetherCd = Math.max(0, a.tetherCd - dt);
  a.dodgeT = Math.max(0, a.dodgeT - dt);
  a.stun = Math.max(0, a.stun - dt);
  a.iframes = Math.max(0, a.iframes - dt);
  a.buffT = Math.max(0, a.buffT - dt);
  a.senseT = Math.max(0, a.senseT - dt);
  a.swing = Math.max(0, a.swing - dt * 3.1);
  a.botTap = Math.max(0, a.botTap - dt);
  a.hearT = Math.max(0, a.hearT - dt);
  a.veilT = Math.max(0, a.veilT - dt);
  a.markT = Math.max(0, a.markT - dt);
  a.kitCd = Math.max(0, a.kitCd - dt);
  a.huntT = Math.max(0, a.huntT - dt);
  a.burstT = Math.max(0, (a.burstT || 0) - dt);
  a.snareCd = Math.max(0, (a.snareCd || 0) - dt);
  if (a.role === "dreamer" && !a.dead && !a.downed) {
    const sprinting = a.spd > 6.2 && a.dodgeT <= 0;
    a.nerve = Math.max(0, Math.min(100, a.nerve + (sprinting ? -10 : 11) * dt));
    if (a.nerve < 12 && a.veilT <= 0) a.hearT = Math.max(a.hearT, 0.2);
  }
  if (a.sideT > 0) a.sideT = Math.max(0, a.sideT - dt);
}

/** Camera-relative stick/keys → world direction on the shared yaw basis. */
export function cameraToWorld(ix: number, iz: number, camYaw: number): { x: number; z: number } {
  const mag = Math.hypot(ix, iz);
  if (mag < 0.001) return { x: 0, z: 0 };
  const nx = ix / mag;
  const nz = iz / mag;
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  return { x: nx * rx + nz * fx, z: nx * rz + nz * fz };
}

export function yawForDirection(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

function approachYaw(current: number, target: number, rate: number, dt: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const max = rate * dt;
  return current + Math.max(-max, Math.min(max, d));
}

function locomotion(
  a: Actor,
  wx: number,
  wz: number,
  dt: number,
  sprint: boolean,
  leash = false,
): void {
  const monster = a.role === "somnarch";
  let moving = Math.hypot(wx, wz) > 0.05;
  if (a.dead || a.downed || a.stun > 0 || a.channel !== 0) {
    moving = false;
    wx = 0;
    wz = 0;
  }
  if (a.dodgeT > 0) {
    wx = -Math.sin(a.yaw);
    wz = -Math.cos(a.yaw);
    moving = true;
    a.veilT = 0;
  } else if (moving) {
    const len = Math.hypot(wx, wz) || 1;
    wx /= len;
    wz /= len;
    if (a.sideT > 0) {
      const s = a.sideSign;
      const ox = wx;
      wx = wx * 0.55 - wz * s * 0.85;
      wz = ozMix(ox, wz, s);
    }
  }

  let top = monster ? 4.25 : 4.3;
  const stalking = monster && a.stalk > 28 && !sprint && a.dodgeT <= 0 && !leash;
  if (leash) top = 3.05;
  else if (stalking) top = 2.4;
  if (!leash && sprint && !stalking && (monster || a.stamina > 1) && a.dodgeT <= 0) top *= monster ? 1.72 : 1.56;
  if (!monster && a.burstT > 0) top *= 1.9;
  if (a.buffT > 0) top *= 1.16;
  if (a.lucid) top *= 1.05;
  if (a.dodgeT > 0) top = monster ? 12.4 : 11.2;

  const target = moving ? top : 0;
  a.spd += (target - a.spd) * (1 - Math.exp(-12 * dt));
  if (sprint && moving && a.dodgeT <= 0) a.veilT = 0;
  if (!monster && sprint && moving && a.dodgeT <= 0 && a.spd > 1) {
    a.stamina = Math.max(0, a.stamina - 24 * dt);
    if (a.veilT <= 0) a.hearT = 0.35;
  } else if (!monster) {
    const calm = 1 - Math.min(0.7, a.fear / 140);
    a.stamina = Math.min(100, a.stamina + 15 * dt * calm);
  } else {
    a.stamina = 100;
  }

  const stepX = wx * a.spd * dt;
  const stepZ = wz * a.spd * dt;
  const beforeX = a.x;
  const beforeZ = a.z;
  const next = moveCircle(a.x, a.z, stepX, stepZ, radiusOf(a));
  a.x = next.x;
  a.z = next.z;
  a.vx = (a.x - beforeX) / dt;
  a.vz = (a.z - beforeZ) / dt;

  const moved = Math.hypot(a.vx, a.vz);
  if (moving && a.dodgeT <= 0 && moved > 0.4) {
    a.yaw = approachYaw(a.yaw, yawForDirection(wx, wz), 11, dt);
    a.stuckT = moved < 0.8 ? a.stuckT + dt : 0;
    if (a.stuckT > 0.45 && a.sideT <= 0) {
      a.sideSign = slideSign(a);
      a.sideT = 1.15;
      a.stuckT = 0;
    }
  } else if (!moving) {
    a.stuckT = 0;
  }
}

function ozMix(ox: number, wz: number, s: number): number {
  return ox * s * 0.85 + wz * 0.55;
}

/** Keep sliding along the same side of the nearest house instead of reversing every bump. */
function slideSign(a: Actor): number {
  let bestX = 0;
  let bestZ = 0;
  let bestD = 10;
  for (const b of BLOCKS) {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < bestD) {
      bestD = d;
      bestX = b.x;
      bestZ = b.z;
    }
  }
  if (bestD >= 10) return a.sideSign || 1;
  const fx = Math.abs(a.vx) + Math.abs(a.vz) > 0.2 ? a.vx : -Math.sin(a.yaw);
  const fz = Math.abs(a.vx) + Math.abs(a.vz) > 0.2 ? a.vz : -Math.cos(a.yaw);
  const cross = fx * (a.z - bestZ) - fz * (a.x - bestX);
  return cross >= 0 ? 1 : -1;
}

function separate(m: Match): void {
  const list = m.actors.filter((a) => !a.dead);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 0.0001;
      const need = radiusOf(a) + radiusOf(b) * 0.85;
      if (d < need) {
        const push = ((need - d) * 0.5) / d;
        const ax = a.x - dx * push;
        const az = a.z - dz * push;
        const bx = b.x + dx * push;
        const bz = b.z + dz * push;
        if (!moveBlocked(ax, az, a)) {
          a.x = ax;
          a.z = az;
        }
        if (!moveBlocked(bx, bz, b)) {
          b.x = bx;
          b.z = bz;
        }
      }
    }
  }
}

function moveBlocked(x: number, z: number, a: Actor): boolean {
  return outside(x, z, radiusOf(a)) || blockedSoft(x, z, a);
}

function blockedSoft(x: number, z: number, a: Actor): boolean {
  const next = moveCircle(a.x, a.z, x - a.x, z - a.z, radiusOf(a));
  return Math.hypot(next.x - x, next.z - z) > 0.08;
}

function inArc(ax: number, az: number, yaw: number, tx: number, tz: number, range: number, arc: number): boolean {
  const dx = tx - ax;
  const dz = tz - az;
  const d = Math.hypot(dx, dz);
  if (d > range || d < 0.001) return d <= range && d > 0.001;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dot = (dx * fx + dz * fz) / d;
  return dot > Math.cos(arc * 0.5);
}

function hurtDreamer(m: Match, a: Actor, amount: number, events: SimEvent[]): void {
  if (a.dead || a.iframes > 0 || a.role !== "dreamer") return;
  if (a.downed) {
    killDreamer(m, a, events);
    return;
  }
  a.hp -= amount;
  a.iframes = 0.45;
  a.channel = 0;
  a.channelT = 0;
  events.push({ type: "hit", victim: a.id, amount });
  if (a.hp <= 0) {
    a.hp = 0;
    a.downed = true;
    a.downT = m.phones >= 2 ? 56 : 42;
    a.spd = 0;
    say(m, `${a.name} is bleeding out in the dream.`);
    events.push({ type: "down", who: a.id });
  }
}

function killDreamer(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.dead) return;
  a.dead = true;
  a.downed = false;
  a.hp = 0;
  a.channel = 0;
  say(m, `The Somnarch stitched ${a.name} under.`);
  events.push({ type: "death", who: a.id });
  const live = livingDreamers(m);
  if (live.length === 0 && m.phase === "play") {
    m.phase = "lose";
    say(m, `The cul-de-sac keeps every soul. ${clockLabel(m.time)}.`);
    events.push({ type: "lose" });
  }
}

function hearthsOpen(m: Match): boolean {
  return m.wards.length > 0 && m.wards.every((w) => w.lit);
}

function damageMonster(m: Match, amount: number, events: SimEvent[]): void {
  const mon = monsterOf(m);
  if (!mon || mon.dead || m.phase !== "play") return;
  if (mon.iframes > 0) return;
  const lucidStrike = allLivingLucid(m);
  const ready = lucidStrike && hearthsOpen(m);
  const dealt = lucidStrike ? amount * (ready ? 1.7 : 1.2) : amount * 0.35;
  mon.hp -= dealt;
  mon.iframes = 0.12;
  events.push({ type: "hit", victim: mon.id, amount: dealt });
  if (mon.hp <= 0) {
    if (ready) {
      mon.hp = 0;
      mon.dead = true;
      m.phase = "win";
      say(m, `The Somnarch unravels. Awake at ${clockLabel(m.time)}.`);
      events.push({ type: "win" });
    } else {
      mon.hp = 64;
      say(m, lucidStrike ? "The hearths are still dark. It will not stay dead." : "It will not die while a dreamer still sleeps.");
    }
  }
}

function tryPickup(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.role !== "dreamer" || a.dead || a.downed) return;
  for (const p of m.pickups) {
    if (p.taken) continue;
    if (dist(a, p) > 1.45) continue;
    if (p.kind === "fragment") {
      if (a.fragments >= WAKE_NEED || a.lucid) continue;
      p.taken = true;
      a.fragments += 1;
      say(m, `${a.name} latched a key (${a.fragments}/${WAKE_NEED}).`);
      events.push({ type: "pick", who: a.id, kind: p.kind });
    } else if (p.kind === "phone") {
      p.taken = true;
      m.phones += 1;
      say(m, `${a.name} found a phone piece (${m.phones}/3).`);
      events.push({ type: "pick", who: a.id, kind: p.kind });
    } else if (a.items.length < 3) {
      p.taken = true;
      a.items.push(p.kind);
      events.push({ type: "pick", who: a.id, kind: p.kind });
    }
  }
}

function becomeLucid(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.lucid || a.dead || a.role !== "dreamer") return;
  a.lucid = true;
  a.fragments = WAKE_NEED;
  a.channel = 0;
  a.channelT = 0;
  a.downed = false;
  a.hp = Math.max(a.hp, 70);
  say(m, `${a.name} is Lucid. The dream answers.`);
  events.push({ type: "lucid", who: a.id });
  if (allLivingLucid(m)) {
    say(m, "Every living dreamer is awake. Unmake the Somnarch.");
  }
}

function useItem(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.dead || a.downed || a.items.length === 0 || a.role !== "dreamer") return;
  const it = a.items.shift()!;
  if (it === "bandage") {
    a.hp = Math.min(DREAMER_HP, a.hp + 48);
    say(m, `${a.name} bound a wound.`);
  } else if (it === "adrenaline") {
    a.stamina = Math.min(100, a.stamina + 70);
    a.buffT = Math.max(a.buffT, 4.2);
  } else {
    const mon = monsterOf(m);
    if (mon && dist(a, mon) < 16) {
      mon.stun = Math.max(mon.stun, 2.55);
      mon.channel = 0;
      events.push({ type: "stun" });
      say(m, `${a.name} cracked an alarm in the dream.`);
    } else {
      say(m, "The alarm rings, and something turns to listen.");
      if (mon) mon.hearT = 2;
    }
  }
}

function nearestDowned(m: Match, a: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = 2.35;
  for (const o of m.actors) {
    if (o === a || !o.downed || o.dead) continue;
    const d = dist(a, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function nearestSleeper(m: Match, a: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = TETHER_R;
  for (const o of m.actors) {
    if (o === a || o.role !== "dreamer" || o.dead || o.lucid) continue;
    const d = dist(a, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function tether(m: Match, a: Actor, events: SimEvent[]): void {
  if (!a.lucid || a.tetherCd > 0 || a.dead || a.downed) return;
  const ally = nearestSleeper(m, a);
  if (!ally) return;
  a.tetherCd = TETHER_CD;
  if (ally.fragments >= WAKE_NEED || ally.downed) {
    if (ally.downed) {
      ally.downed = false;
      ally.hp = 55;
      ally.iframes = 1.2;
      ally.downT = 0;
    }
    becomeLucid(m, ally, events);
    say(m, `${a.name} pulled ${ally.name} awake.`);
  } else {
    ally.fragments += 1;
    say(m, `${a.name} tethered a latch-key to ${ally.name} (${ally.fragments}/${WAKE_NEED}).`);
  }
}

function nearestDoor(m: Match, a: Actor, latched: boolean): Door | null {
  let best: Door | null = null;
  let bestD = DOOR_R;
  for (const door of m.doors) {
    if (door.latched !== latched) continue;
    const d = Math.hypot(a.x - door.x, a.z - door.z);
    if (d < bestD) {
      bestD = d;
      best = door;
    }
  }
  return best;
}

function syncDoors(m: Match): void {
  setLatchedDoors(m.doors.filter((d) => d.latched).map((d) => d.id));
}

function breakDoor(m: Match, a: Actor, events: SimEvent[]): void {
  const door = nearestDoor(m, a, true);
  if (!door) return;
  if (!inArc(a.x, a.z, a.yaw, door.x, door.z, DOOR_R + 0.2, 1.4)) return;
  door.hits += 1;
  if (door.hits >= DOOR_HITS) {
    door.latched = false;
    door.hits = 0;
    syncDoors(m);
    say(m, `The Somnarch broke the ${door.id} latch.`);
    events.push({ type: "door", broken: true });
  } else {
    events.push({ type: "door", broken: false });
  }
}

function nearestWard(m: Match, a: Actor, lit: boolean): Ward | null {
  let best: Ward | null = null;
  let bestD = WARD_R;
  for (const w of m.wards) {
    if (w.lit !== lit) continue;
    const d = Math.hypot(a.x - w.x, a.z - w.z);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function nearestShortcut(a: Actor): { sc: (typeof SHORTCUTS)[number]; fromA: boolean } | null {
  let best: { sc: (typeof SHORTCUTS)[number]; fromA: boolean } | null = null;
  let bestD = HOP_R;
  for (const sc of SHORTCUTS) {
    if (a.role === "somnarch" && sc.kind !== "cellar") continue;
    const da = Math.hypot(a.x - sc.ax, a.z - sc.az);
    const db = Math.hypot(a.x - sc.bx, a.z - sc.bz);
    const d = Math.min(da, db);
    if (d < bestD) {
      bestD = d;
      best = { sc, fromA: da <= db };
    }
  }
  return best;
}

function hopSeconds(a: Actor, kind: "fence" | "sewer" | "cellar"): number {
  if (a.role === "somnarch") return 2.4;
  if (kind === "fence") return 0.5;
  return 0.8;
}

function runShortcut(m: Match, a: Actor, hop: { sc: (typeof SHORTCUTS)[number]; fromA: boolean }, dt: number): void {
  const key = `${hop.sc.id}:${hop.fromA ? "a" : "b"}`;
  if (a.channel !== 7 || a.channelTarget !== key) {
    a.channel = 7;
    a.channelTarget = key;
    a.channelT = 0;
  }
  a.channelT += dt;
  if (a.channelT < hopSeconds(a, hop.sc.kind)) return;
  const dest = hop.fromA ? { x: hop.sc.bx, z: hop.sc.bz } : { x: hop.sc.ax, z: hop.sc.az };
  a.x = dest.x;
  a.z = dest.z;
  a.vx = 0;
  a.vz = 0;
  a.iframes = Math.max(a.iframes, 0.6);
  a.hearT = Math.max(a.hearT, 1.05);
  a.usedReset = true;
  a.channel = 0;
  a.channelT = 0;
  const verb = hop.sc.kind === "fence" ? "vaulted a fence" : hop.sc.kind === "sewer" ? "slipped a drain" : "took the cellar";
  say(m, `${a.name} ${verb}.`);
}

function nearestCar(m: Match, a: Actor): Car | null {
  if (a.role !== "dreamer") return null;
  let best: Car | null = null;
  let bestD = HOP_R;
  for (const car of m.cars) {
    if (car.cd > 0) continue;
    const d = Math.hypot(a.x - car.x, a.z - car.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function tickInteract(m: Match, a: Actor, held: boolean, dt: number, events: SimEvent[]): void {
  if (!held || a.dead || a.stun > 0 || a.downed) {
    a.channel = 0;
    a.channelT = 0;
    return;
  }
  if (a.role === "somnarch") {
    const cellar = nearestShortcut(a);
    if (cellar) {
      runShortcut(m, a, cellar, dt);
      return;
    }
    const door = nearestDoor(m, a, true);
    if (door) {
      if (a.channel !== 6 || a.channelTarget !== door.id) {
        a.channel = 6;
        a.channelTarget = door.id;
        a.channelT = 0;
      }
      a.channelT += dt;
      if (a.channelT >= BREAK_TIME) {
        door.latched = false;
        door.hits = 0;
        a.channel = 0;
        a.channelT = 0;
        syncDoors(m);
        say(m, `The Somnarch forced the ${door.id} door.`);
        events.push({ type: "door", broken: true });
      }
      return;
    }
    const ward = nearestWard(m, a, true);
    if (ward) {
      if (a.channel !== 4 || a.channelTarget !== ward.id) {
        a.channel = 4;
        a.channelTarget = ward.id;
        a.channelT = 0;
      }
      a.channelT += dt;
      if (a.channelT >= SNUFF_TIME) {
        ward.lit = false;
        a.channel = 0;
        a.channelT = 0;
        say(m, `The Somnarch smothered the ${ward.name}.`);
        events.push({ type: "snuff" });
      }
      return;
    }
    a.channel = 0;
    a.channelT = 0;
    if (a.snareCd <= 0 && m.snares.length < 2) {
      m.snares.push({ id: `snare-${m.snares.length}-${Math.floor(m.time * 10)}`, x: a.x, z: a.z });
      a.snareCd = 16;
      say(m, "The Somnarch strung a thread across the yard.");
    }
    return;
  }
  const downed = nearestDowned(m, a);
  if (downed && !a.downed) {
    if (a.channel !== 2 || a.channelTarget !== downed.id) {
      a.channel = 2;
      a.channelTarget = downed.id;
      a.channelT = 0;
    }
    a.channelT += dt;
    if (a.channelT >= REVIVE_TIME) {
      downed.downed = false;
      downed.hp = 58;
      downed.iframes = 1.35;
      downed.downT = 0;
      a.channel = 0;
      a.channelT = 0;
      say(m, `${a.name} dragged ${downed.name} back to their feet.`);
    }
    return;
  }
  const hop = nearestShortcut(a);
  if (hop) {
    runShortcut(m, a, hop, dt);
    return;
  }
  const car = nearestCar(m, a);
  if (car) {
    if (a.channel !== 8 || a.channelTarget !== car.id) {
      a.channel = 8;
      a.channelTarget = car.id;
      a.channelT = 0;
    }
    a.channelT += dt;
    if (a.channelT >= 1.15) {
      car.cd = 42;
      a.burstT = 3.4;
      a.hearT = Math.max(a.hearT, 1.6);
      a.usedReset = true;
      a.channel = 0;
      a.channelT = 0;
      say(m, `${a.name} cranked a car and tore down the street.`);
    }
    return;
  }
  const telling =
    a.channel === 9 ? TELLS.find((t) => t.id === a.channelTarget && !(a.heard ?? []).includes(t.id) && Math.hypot(a.x - t.x, a.z - t.z) < 3.2) : undefined;
  const tell = telling ?? nearestTell(a);
  if (tell) {
    if (a.channel !== 9 || a.channelTarget !== tell.id) {
      a.channel = 9;
      a.channelTarget = tell.id;
      a.channelT = 0;
    }
    a.channelT += dt;
    if (a.channelT >= LISTEN_TIME) {
      if (!a.heard.includes(tell.id)) a.heard.push(tell.id);
      a.channel = 0;
      a.channelT = 0;
      say(m, tell.line);
      events.push({ type: "listen" });
    }
    return;
  }
  const threat = monsterOf(m);
  const openDoor = nearestDoor(m, a, false);
  if (openDoor && threat && !threat.dead && dist(a, threat) < 16) {
    if (a.channel !== 5 || a.channelTarget !== openDoor.id) {
      a.channel = 5;
      a.channelTarget = openDoor.id;
      a.channelT = 0;
    }
    a.channelT += dt;
    if (a.channelT >= LATCH_TIME) {
      openDoor.latched = true;
      openDoor.hits = 0;
      a.channel = 0;
      a.channelT = 0;
      syncDoors(m);
      say(m, `${a.name} latched the ${openDoor.id} door.`);
      m.taughtLatch = true;
      events.push({ type: "door", broken: false });
    }
    return;
  }
  const shutDoor = nearestDoor(m, a, true);
  if (shutDoor) {
    if (shutDoor.rattle <= 0) {
      shutDoor.rattle = 0.52;
      events.push({ type: "door", broken: false });
    }
    a.channel = 0;
    a.channelT = 0;
    return;
  }
  if (a.lucid) {
    const ward = nearestWard(m, a, false);
    if (ward) {
      if (a.channel !== 3 || a.channelTarget !== ward.id) {
        a.channel = 3;
        a.channelTarget = ward.id;
        a.channelT = 0;
      }
      a.channelT += dt;
      a.hearT = Math.max(a.hearT, 0.4);
      if (a.channelT >= WARD_TIME) {
        ward.lit = true;
        a.channel = 0;
        a.channelT = 0;
        const mon = monsterOf(m);
        if (mon && !mon.dead) {
          mon.huntX = ward.x;
          mon.huntZ = ward.z;
          mon.huntT = 9;
          mon.buffT = Math.max(mon.buffT, 5);
          mon.hearT = 2;
        }
        say(m, `${a.name} kindled the ${ward.name}.`);
        events.push({ type: "ward" });
        if (hearthsOpen(m) && allLivingLucid(m)) {
          say(m, "Every hearth burns. The Somnarch can be unmade.");
        }
      }
      return;
    }
  }
  const altarR = a.channel === 1 ? ALTAR_R + 1.1 : ALTAR_R;
  if (!a.lucid && !a.downed && a.fragments >= WAKE_NEED && Math.hypot(a.x, a.z) <= altarR) {
    if (a.channel !== 1) {
      a.channel = 1;
      a.channelT = 0;
      a.channelTarget = "altar";
    }
    a.channelT += dt;
    if (a.channelT >= WAKE_TIME) becomeLucid(m, a, events);
    return;
  }
  a.channel = 0;
  a.channelT = 0;
}

function nearestTell(a: Actor): (typeof TELLS)[number] | null {
  if (a.role !== "dreamer") return null;
  const heard = a.heard ?? [];
  let best: (typeof TELLS)[number] | null = null;
  let bestD = LISTEN_R;
  for (const tell of TELLS) {
    if (heard.includes(tell.id)) continue;
    const d = Math.hypot(a.x - tell.x, a.z - tell.z);
    if (d < bestD) {
      bestD = d;
      best = tell;
    }
  }
  return best;
}

/** Heavy cut: telegraph, then the hit. Returns true when this frame is spent winding up or paying off. */
function tickCommit(m: Match, a: Actor, dt: number, events: SimEvent[]): boolean {
  if (a.role !== "somnarch" || !a.commitT || a.commitT <= 0) return false;
  a.commitT -= dt;
  a.vx = 0;
  a.vz = 0;
  a.spd = 0;
  a.swing = Math.max(a.swing, 0.45);
  if (a.commitT > 0) return true;
  a.commitT = 0;
  a.swing = 1;
  a.attackCd = 0.96;
  a.stalk = 12;
  let hit = false;
  for (const o of m.actors) {
    if (o.role !== "dreamer" || o.dead || o.downed) continue;
    if (o.dodgeT > 0 || o.iframes > 0.05) continue;
    if (m.time < OPEN_TIME && dist(a, o) > 2.2) continue;
    if (!inArc(a.x, a.z, a.yaw, o.x, o.z, 2.25, 1.15)) continue;
    hurtDreamer(m, o, 52, events);
    hit = true;
  }
  if (!hit) say(m, "The heavy cut finds only air.");
  events.push({ type: "swing", who: a.id });
  return true;
}

function strike(m: Match, a: Actor, aimYaw: number, events: SimEvent[]): void {
  if (a.attackCd > 0 || a.dead || a.stun > 0 || a.downed) return;
  if (a.commitT > 0) return;
  a.swing = 1;
  a.veilT = 0;
  a.yaw = approachYaw(a.yaw, aimYaw, 20, 1 / 60);
  if (a.role === "somnarch") {
    let heavy = false;
    if (a.stalk >= 80) {
      for (const o of m.actors) {
        if (o.role !== "dreamer" || o.dead || o.downed) continue;
        if (m.time < OPEN_TIME && dist(a, o) > 2.2) continue;
        if (inArc(a.x, a.z, a.yaw, o.x, o.z, 2.25, 1.15)) heavy = true;
      }
    }
    if (heavy) {
      a.commitT = COMMIT_TIME;
      a.swing = 0.4;
      events.push({ type: "commit" });
      return;
    }
    events.push({ type: "swing", who: a.id });
    a.attackCd = 0.96;
    let hitSomeone = false;
    for (const o of m.actors) {
      if (o.role !== "dreamer" || o.dead) continue;
      const reach = o.downed ? 2.35 : 2.25;
      if (o.downed ? dist(a, o) <= reach : inArc(a.x, a.z, a.yaw, o.x, o.z, reach, 1.15)) {
        if (m.time < OPEN_TIME && dist(a, o) > 2.2) continue;
        const heavy = a.stalk >= 80 && !o.downed;
        hurtDreamer(m, o, o.downed ? 999 : heavy ? 52 : 28, events);
        if (heavy) a.stalk = 12;
        hitSomeone = true;
      }
    }
    if (!hitSomeone) breakDoor(m, a, events);
  } else if (a.lucid) {
    events.push({ type: "swing", who: a.id });
    a.attackCd = 0.9;
    const mon = monsterOf(m);
    if (mon && !mon.dead && inArc(a.x, a.z, a.yaw, mon.x, mon.z, 3.15, 1.25)) {
      damageMonster(m, 16, events);
    }
  } else {
    events.push({ type: "swing", who: a.id });
    a.attackCd = 1.15;
    const mon = monsterOf(m);
    if (mon && !mon.dead && inArc(a.x, a.z, a.yaw, mon.x, mon.z, 2.25, 1.1)) {
      mon.stun = Math.max(mon.stun, 0.28);
      mon.iframes = Math.max(mon.iframes, 0.55);
      events.push({ type: "stun" });
    }
  }
}

function tryDash(a: Actor): void {
  if (a.dashCd > 0 || a.dead || a.downed || a.stun > 0) return;
  if (a.role === "dreamer" && a.stamina < 18) return;
  a.dodgeT = a.role === "somnarch" ? 0.34 : 0.26;
  a.dashCd = a.role === "somnarch" ? 3.6 : 3.15;
  if (a.role === "dreamer") {
    a.stamina = Math.max(0, a.stamina - 22);
    a.iframes = Math.max(a.iframes, 0.26);
  }
}

function tryAbility(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.abilityCd > 0 || a.dead || a.downed || a.stun > 0) return;
  if (a.role === "somnarch") {
    a.senseT = 4.5;
    a.abilityCd = 16;
    let nearest: Actor | null = null;
    let best = 48;
    for (const o of m.actors) {
      if (o.role !== "dreamer" || o.dead) continue;
      const d = dist(a, o);
      if (d < best) {
        best = d;
        nearest = o;
      }
    }
    if (nearest && best < 28) nearest.markT = 4;
    say(m, nearest ? `The Somnarch marks ${nearest.name}.` : "The Somnarch searches the dream.");
    return;
  }
  if (a.lucid) {
    a.senseT = 5.5;
    a.abilityCd = 15;
    a.hearT = 1.35;
    const mon = monsterOf(m);
    if (mon && !mon.dead && dist(a, mon) < 6.8) {
      mon.stun = Math.max(mon.stun, 0.9);
      damageMonster(m, 11, events);
      events.push({ type: "stun" });
      say(m, `${a.name} pulses the dream in its face.`);
    } else {
      say(m, `${a.name} sends a lucid pulse.`);
    }
    return;
  }
  if (a.nerve < 34) return;
  a.nerve -= 34;
  a.veilT = 3.5;
  a.hearT = 0;
  a.abilityCd = 13;
  events.push({ type: "veil" });
}

function tryKit(m: Match, a: Actor, events: SimEvent[]): void {
  if (a.kitCd > 0 || a.dead || a.downed || a.stun > 0) return;
  if (a.role === "somnarch") {
    a.kitCd = 12;
    a.swing = 1;
    let caught = false;
    for (const o of m.actors) {
      if (o.role !== "dreamer" || o.dead || o.downed) continue;
      if (!inArc(a.x, a.z, a.yaw, o.x, o.z, 7.4, 1.05)) continue;
      if (o.dodgeT > 0 || o.iframes > 0.2) continue;
      o.stun = Math.max(o.stun, 0.72);
      o.veilT = 0;
      o.channel = 0;
      const pull = moveCircle(o.x, o.z, (a.x - o.x) * 0.18, (a.z - o.z) * 0.18, radiusOf(o));
      o.x = pull.x;
      o.z = pull.z;
      caught = true;
    }
    if (caught) {
      events.push({ type: "stitch" });
      say(m, "The Somnarch throws a stitch.");
    }
    return;
  }
  if (!a.lucid) return;
  if (a.tetherCd > 0) return;
  const before = a.tetherCd;
  tether(m, a, events);
  if (a.tetherCd !== before) a.kitCd = 0.35;
}

function tickHuman(m: Match, a: Actor, inp: Input | undefined, dt: number, events: SimEvent[]): void {
  const input = inp ?? {
    ix: 0,
    iz: 0,
    camYaw: a.yaw,
    sprint: false,
    atk: false,
    interactHeld: false,
    usePulse: false,
    ablPulse: false,
    dashPulse: false,
    kitPulse: false,
  };
  if (a.downed) {
    a.downT -= dt;
    a.spd = 0;
    a.vx = 0;
    a.vz = 0;
    a.channel = 0;
    if (a.downT <= 0) killDreamer(m, a, events);
    return;
  }
  const world = cameraToWorld(input.ix, input.iz, input.camYaw);
  if (!a.dead && Math.hypot(input.ix, input.iz) < 0.2 && a.dodgeT <= 0 && a.stun <= 0 && a.channel === 0) {
    a.yaw = approachYaw(a.yaw, input.camYaw, 8, dt);
  }
  locomotion(a, world.x, world.z, dt, input.sprint && a.stamina > 1, a.role === "somnarch" && m.time < OPEN_TIME);
  if (input.dashPulse) tryDash(a);
  if (input.usePulse) useItem(m, a, events);
  if (input.ablPulse) tryAbility(m, a, events);
  if (input.kitPulse) tryKit(m, a, events);
  if (input.atk) {
    a.veilT = 0;
    strike(m, a, input.camYaw, events);
  }
  tickInteract(m, a, input.interactHeld && Math.hypot(a.vx, a.vz) < 3.2, dt, events);
  tryPickup(m, a, events);
  input.usePulse = false;
  input.ablPulse = false;
  input.dashPulse = false;
  input.kitPulse = false;
}

function tickBot(m: Match, a: Actor, dt: number, events: SimEvent[]): void {
  if (a.downed) {
    a.downT -= dt;
    a.vx = 0;
    a.vz = 0;
    a.spd = 0;
    if (a.downT <= 0) killDreamer(m, a, events);
    return;
  }
  if (a.role === "somnarch") botMonster(m, a, dt, events);
  else botDreamer(m, a, dt, events);
  tryPickup(m, a, events);
}

function botMonster(m: Match, a: Actor, dt: number, events: SimEvent[]): void {
  if (m.time < OPEN_TIME) {
    const p = PATROL[a.patrolI % PATROL.length]!;
    const gx = p[0] - a.x;
    const gz = p[1] - a.z;
    if (Math.hypot(gx, gz) < 1.6) a.patrolI += 1;
    locomotion(a, gx, gz, dt, false, true);
    return;
  }
  let best: Actor | null = null;
  let bestScore = 8;
  for (const o of m.actors) {
    if (o.role !== "dreamer" || o.dead) continue;
    const d = dist(a, o);
    const los = d < 16 && !lineBlocked(a.x, a.z, o.x, o.z);
    const veiled = o.veilT > 0 && d > 3.4 && a.senseT <= 0 && o.markT <= 0;
    const noisy = !veiled && (Math.hypot(o.vx, o.vz) > 6.2 || o.hearT > 0);
    let score = 0;
    if (a.senseT > 0 || o.markT > 0) score = 80 - d;
    else if (veiled) score = d < 3.4 ? 70 - d : 0;
    else if (los && d < 16) score = 100 - d;
    else if (noisy && d < 18) score = 64 - d;
    else if (d < 7.5) score = 40 - d;
    if (o.downed) score += 24;
    if (!o.lucid) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  let wx = 0;
  let wz = 0;
  let snuffing = false;
  let forcing = false;
  const chase = best && (dist(a, best) < 18 || a.huntT <= 0);
  if (best && chase) {
    wx = best.x - a.x;
    wz = best.z - a.z;
    const d = dist(a, best);
    if (d < (best.downed ? 2.3 : 2.15)) strike(m, a, yawForDirection(wx, wz), events);
    if (d > 3.1 && d < 7.2 && a.kitCd <= 0 && a.botTap <= 0 && !best.downed) {
      a.yaw = yawForDirection(wx, wz);
      tryKit(m, a, events);
      a.botTap = 1.1;
    }
    if (d > 4.5 && d < 14 && a.dashCd <= 0 && a.botTap <= 0) {
      tryDash(a);
      a.botTap = 1.2;
    }
    if (d > 5 && d < 12 && a.snareCd <= 0 && m.snares.length < 2 && a.botTap <= 0) {
      m.snares.push({ id: `snare-b-${Math.floor(m.time * 10)}`, x: a.x, z: a.z });
      a.snareCd = 16;
      a.botTap = 2.2;
    }
  } else if (a.huntT > 0) {
    wx = a.huntX - a.x;
    wz = a.huntZ - a.z;
    const hearth = nearestWard(m, a, true);
    if (hearth && dist(a, { x: hearth.x, z: hearth.z }) < WARD_R && (!best || dist(a, best) > 8)) {
      tickInteract(m, a, true, dt, events);
      snuffing = true;
    }
  } else {
    const door = nearestDoor(m, a, true);
    if (door && dist(a, door) < 14) {
      wx = door.x - a.x;
      wz = door.z - a.z;
      if (dist(a, door) < DOOR_R + 0.2) {
        tickInteract(m, a, true, dt, events);
        forcing = true;
        if (a.attackCd <= 0) strike(m, a, yawForDirection(wx, wz), events);
      }
    } else {
      const p = PATROL[a.patrolI % PATROL.length]!;
      wx = p[0] - a.x;
      wz = p[1] - a.z;
      if (Math.hypot(wx, wz) < 1.6) a.patrolI += 1;
      if (a.abilityCd <= 0 && m.time > 6 && a.botTap <= 0) {
        tryAbility(m, a, events);
        a.botTap = 2;
      }
    }
  }
  if (!snuffing && !forcing && (a.channel === 4 || a.channel === 6)) {
    a.channel = 0;
    a.channelT = 0;
  }
  const rushing = !!(best && dist(a, best) < 8);
  locomotion(a, wx, wz, dt, rushing, false);
}

function botDreamer(m: Match, a: Actor, dt: number, events: SimEvent[]): void {
  const mon = monsterOf(m);
  const md = mon && !mon.dead ? dist(a, mon) : 999;
  const los = mon ? md < 16 && !lineBlocked(a.x, a.z, mon.x, mon.z) : false;
  const hunted = !!mon && (mon.senseT > 0 || a.markT > 0 || a.hearT > 0);
  const danger = mon && !mon.dead && mon.stun <= 0 && (md < 8.5 || (los && md < 12 && hunted));
  let wx = 0;
  let wz = 0;
  let interact = false;
  let sprint = false;

  if (danger && mon && md < 12) {
    wx = a.x - mon.x;
    wz = a.z - mon.z;
    sprint = true;
    let escape: { x: number; z: number } | null = null;
    let escapeGain = 0;
    for (const sc of SHORTCUTS) {
      const mouths = [
        [
          { x: sc.ax, z: sc.az },
          { x: sc.bx, z: sc.bz },
        ],
        [
          { x: sc.bx, z: sc.bz },
          { x: sc.ax, z: sc.az },
        ],
      ] as const;
      for (const [here, dest] of mouths) {
        if (dist(a, here) > 14) continue;
        const gain = dist(mon, dest) - md;
        if (gain < 6 || gain < escapeGain) continue;
        escapeGain = gain;
        escape = here;
      }
    }
    const car = nearestCar(m, a);
    if (escape) {
      wx = escape.x - a.x;
      wz = escape.z - a.z;
      sprint = dist(a, escape) > 1.6;
      if (dist(a, escape) <= HOP_R) interact = true;
    } else if (car && dist(a, car) < 9 && dist(mon, car) + 3 < md) {
      wx = car.x - a.x;
      wz = car.z - a.z;
      sprint = true;
      if (dist(a, car) <= HOP_R) interact = true;
    } else {
      const refuge = nearestDoor(m, a, false);
      if (refuge && md < 16 && dist(a, refuge) < 10 && dist(mon, refuge) > dist(a, refuge)) {
        wx = refuge.x - a.x;
        wz = refuge.z - a.z;
        sprint = dist(a, refuge) > 1.8;
        if (dist(a, refuge) <= DOOR_R) interact = true;
      }
    }
    if (!a.lucid && a.abilityCd <= 0 && a.veilT <= 0 && a.nerve >= 34 && md < 9) tryAbility(m, a, events);
    if (md < 2.8 && a.dashCd <= 0) tryDash(a);
    if (md < 3.3 && a.lucid) strike(m, a, yawForDirection(mon.x - a.x, mon.z - a.z), events);
    else if (md < 2.3 && !a.lucid) strike(m, a, yawForDirection(mon.x - a.x, mon.z - a.z), events);
    const clock = a.items.indexOf("clock");
    if (clock >= 0 && md < 7 && a.botTap <= 0) {
      a.items.splice(clock, 1);
      mon.stun = Math.max(mon.stun, 2.55);
      events.push({ type: "stun" });
      say(m, `${a.name} cracked an alarm in the dream.`);
      a.botTap = 1;
    }
  } else if (a.lucid) {
    const sleeper = nearestSleeper(m, a);
    const hearth = nearestWard(m, a, false) ?? m.wards.find((w) => !w.lit) ?? null;
    if (sleeper && dist(a, sleeper) < 22) {
      wx = sleeper.x - a.x;
      wz = sleeper.z - a.z;
      if (dist(a, sleeper) <= TETHER_R && a.tetherCd <= 0 && a.botTap <= 0) {
        tether(m, a, events);
        a.botTap = 0.4;
      }
    } else if (hearth) {
      wx = hearth.x - a.x;
      wz = hearth.z - a.z;
      if (Math.hypot(wx, wz) <= WARD_R) interact = true;
    } else if (mon && !mon.dead) {
      wx = mon.x - a.x;
      wz = mon.z - a.z;
      sprint = md > 6;
      if (md < 3.2) strike(m, a, yawForDirection(wx, wz), events);
    }
  } else if (a.fragments < WAKE_NEED) {
    const frag = nearestFragment(m, a);
    if (frag) {
      wx = frag.x - a.x;
      wz = frag.z - a.z;
    } else {
      const lucid = m.actors.find((o) => o.lucid && !o.dead && o.id !== a.id);
      if (lucid) {
        wx = lucid.x - a.x;
        wz = lucid.z - a.z;
      }
    }
  } else {
    wx = -a.x;
    wz = -a.z;
    if (Math.hypot(a.x, a.z) <= ALTAR_R) interact = true;
  }

  const ally = nearestDowned(m, a);
  if (ally && (!danger || md > 9)) {
    wx = ally.x - a.x;
    wz = ally.z - a.z;
    if (dist(a, ally) < 2.3) interact = true;
  }

  if (a.hp < 52 && a.items.includes("bandage") && !danger) {
    const i = a.items.indexOf("bandage");
    if (i >= 0) {
      a.items.splice(i, 1);
      a.hp = Math.min(DREAMER_HP, a.hp + 48);
    }
  }
  if (a.stamina < 30 && sprint && a.items.includes("adrenaline")) {
    const i = a.items.indexOf("adrenaline");
    if (i >= 0) {
      a.items.splice(i, 1);
      a.stamina = 100;
      a.buffT = 4;
    }
  }

  locomotion(a, wx, wz, dt, sprint);
  tickInteract(m, a, interact, dt, events);
  if (a.lucid && a.abilityCd <= 0 && danger && mon && (lineBlocked(a.x, a.z, mon.x, mon.z) || md > 14)) {
    tryAbility(m, a, events);
  }
}

function nearestFragment(m: Match, a: Actor): Pickup | null {
  const rivals = m.actors.filter(
    (o) => o !== a && o.role === "dreamer" && !o.dead && !o.lucid && o.fragments < WAKE_NEED,
  );
  let best: Pickup | null = null;
  let bestD = 1e9;
  for (const p of m.pickups) {
    if (p.taken || p.kind !== "fragment") continue;
    const d = dist(a, p);
    const claimed = rivals.some((r) => dist(r, p) + 0.4 < d);
    if (claimed) continue;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return best;
  for (const p of m.pickups) {
    if (p.taken || p.kind !== "fragment") continue;
    const d = dist(a, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function tickSnares(m: Match): void {
  if (m.snares.length === 0) return;
  for (const a of m.actors) {
    if (a.role !== "dreamer" || a.dead || a.downed) continue;
    const i = m.snares.findIndex((s) => Math.hypot(a.x - s.x, a.z - s.z) < 0.95);
    if (i < 0) continue;
    m.snares.splice(i, 1);
    a.stun = Math.max(a.stun, 1.35);
    a.markT = Math.max(a.markT, 3);
    a.hearT = Math.max(a.hearT, 0.45);
    say(m, `${a.name} caught a thread.`);
  }
}

function tickMood(m: Match, a: Actor, dt: number): void {
  if (a.dead) return;
  if (a.role === "dreamer") {
    const mon = monsterOf(m);
    let threat = 0;
    if (mon && !mon.dead && a.veilT <= 0) {
      const d = dist(a, mon);
      const see = d < 14 && !lineBlocked(a.x, a.z, mon.x, mon.z);
      if (see) threat = Math.max(threat, 1 - d / 14);
      if (d < 6.5) threat = Math.max(threat, 0.72);
      if (a.markT > 0) threat = Math.max(threat, 0.45);
    }
    const pull = a.lucid ? 1.8 : 1.15;
    a.fear += (threat * 100 - a.fear) * (1 - Math.exp(-pull * dt));
    if (a.fear > 74 && a.veilT <= 0) a.hearT = Math.max(a.hearT, 0.22);
    return;
  }
  let watch = false;
  for (const o of m.actors) {
    if (o.role !== "dreamer" || o.dead || o.veilT > 0.2) continue;
    const d = dist(a, o);
    if (d > 2.2 && d < 18 && !lineBlocked(a.x, a.z, o.x, o.z)) watch = true;
  }
  if (watch && a.spd < 2.4) a.stalk = Math.min(100, a.stalk + 24 * dt);
  else a.stalk = Math.max(0, a.stalk - (a.spd > 6 ? 16 : 7) * dt);
}

export function step(m: Match, inputs: Map<string, Input>, dt: number): SimEvent[] {
  if (m.phase !== "play") return [];
  const events: SimEvent[] = [];
  for (const door of m.doors) door.rattle = Math.max(0, (door.rattle || 0) - dt);
  for (const car of m.cars) car.cd = Math.max(0, car.cd - dt);
  syncDoors(m);
  m.time += dt;
  m.bannerT = Math.max(0, m.bannerT - dt);
  for (const a of m.actors) {
    if (a.dead && a.role === "somnarch") continue;
    decay(a, dt);
    if (a.dead) continue;
    if (tickCommit(m, a, dt, events)) continue;
    if (a.bot) tickBot(m, a, dt, events);
    else tickHuman(m, a, inputs.get(a.id), dt, events);
    tickMood(m, a, dt);
    if (a.role === "dreamer" && !a.sawLight) {
      for (const [x, z] of LAMPS) {
        if (Math.hypot(a.x - x, a.z - z) < 3.5) a.sawLight = true;
      }
    }
    if (m.phase !== "play") break;
  }
  if (m.phase === "play") {
    tickSnares(m);
    separate(m);
  }
  return events;
}

export function objectiveFor(m: Match, id: string): string {
  const me = m.actors.find((a) => a.id === id);
  if (!me) return "";
  if (m.phase === "win") return "The cul-de-sac is awake.";
  if (m.phase === "lose") return "The dream kept everyone.";
  const lit = m.wards.filter((w) => w.lit).length;
  const hearthLine = `Hearths ${lit}/${m.wards.length}.`;
  if (me.role === "somnarch") {
    const left = livingDreamers(m).length;
    if (m.time < OPEN_TIME) return "They are still learning the streets.";
    return left > 0 ? `${left} still breathe. Snuff any hearth that catches.` : "The neighborhood is yours.";
  }
  if (me.dead) return "You were stitched under. The others still dream.";
  if (me.downed) return "You are bleeding out. Call for a tether.";
  if (m.time < OPEN_TIME && !me.lucid) return "He is still in the far yards. Listen at a pale mote, then find the keys.";
  if (!me.lucid) {
    if (me.fragments >= WAKE_NEED) return `Hold wake at the clock altar. ${hearthLine}`;
    return `Latch-keys ${me.fragments}/${WAKE_NEED}. Q veils. Wake, then kindle the hearths.`;
  }
  if (!hearthsOpen(m)) return `Lucid. Kindle a dark hearth. ${hearthLine} R tethers.`;
  if (!allLivingLucid(m)) return "Hearths burn. Tether the sleepers, then cut it apart.";
  return "Everyone living is awake and the hearths burn. Unmake the Somnarch.";
}

export function promptFor(m: Match, id: string): string {
  const me = m.actors.find((a) => a.id === id);
  if (!me || me.dead || m.phase !== "play") return "";
  if (me.downed) return "Bleeding out";
  if (me.channel === 1) return "Waking";
  if (me.channel === 2) return "Reviving";
  if (me.channel === 5) return "Latching the door";
  if (me.channel === 6) return "Forcing the latch";
  if (me.channel === 7) return "Slipping through";
  if (me.channel === 8) return "Cranking";
  if (me.channel === 9) return "Listening";
  const winding = monsterOf(m);
  if (me.role === "dreamer" && winding && winding.commitT > 0 && dist(me, winding) < 16) return "Dodge the cut";
  const hop = nearestShortcut(me);
  if (hop) {
    if (hop.sc.kind === "fence") return "Vault";
    if (hop.sc.kind === "sewer") return "Drain";
    return "Cellar";
  }
  const car = nearestCar(m, me);
  if (car) return "Crank";
  if (me.role === "dreamer" && nearestTell(me)) return "Hold to listen";
  if (me.role === "somnarch") {
    const down = m.actors.find((a) => a.downed && dist(me, a) < 2.4);
    if (down) return "Strike to finish";
    const latched = nearestDoor(m, me, true);
    if (latched) return "Hold to force the latch";
    const litWard = nearestWard(m, me, true);
    if (litWard) return `Hold to snuff ${litWard.name}`;
    if (me.stalk >= 80) return "Stalk ready — the next cleave is heavy";
    if (me.kitCd <= 0 && m.actors.some((a) => a.role === "dreamer" && !a.dead && dist(me, a) < 12)) return "R stitch";
    return "";
  }
  const down = nearestDowned(m, me);
  if (down) return `Hold to revive ${down.name}`;
  const shut = nearestDoor(m, me, true);
  if (shut) return "Latched";
  const threat = monsterOf(m);
  const openDoor = nearestDoor(m, me, false);
  if (openDoor && threat && !threat.dead && dist(me, threat) < 16) return "Hold to latch the door";
  if (me.lucid) {
    const dark = nearestWard(m, me, false);
    if (dark) return `Hold to kindle ${dark.name}`;
    const sleeper = nearestSleeper(m, me);
    if (sleeper && me.tetherCd <= 0) return `R tether ${sleeper.name}`;
  }
  if (!me.lucid && me.fragments >= WAKE_NEED && Math.hypot(me.x, me.z) <= ALTAR_R + 0.4) {
    return "Hold to wake";
  }
  if (!me.lucid && me.abilityCd <= 0 && me.nerve >= 34) return "Q veil";
  return "";
}

export type CheckRow = { label: string; done: boolean };

export function checklistFor(m: Match, id: string): CheckRow[] {
  const me = m.actors.find((a) => a.id === id);
  if (!me) return [];
  if (me.role === "somnarch") {
    const rows: CheckRow[] = m.actors
      .filter((a) => a.role === "dreamer")
      .map((a) => ({ label: a.name, done: a.dead }));
    for (const w of m.wards) {
      if (w.lit) rows.push({ label: `Snuff ${w.name}`, done: false });
    }
    if (m.phones >= 3) rows.push({ label: "The line is open", done: false });
    return rows;
  }
  const rows: CheckRow[] = [
    { label: "Find a porch light", done: me.sawLight },
    { label: `Whispers ${Math.min(me.heard?.length ?? 0, TELLS.length)}/${TELLS.length}`, done: (me.heard?.length ?? 0) >= TELLS.length },
    { label: "Learn a way out", done: me.usedReset },
    { label: "Latch a door", done: m.taughtLatch },
    { label: `Latch-keys ${Math.min(me.fragments, WAKE_NEED)}/${WAKE_NEED}`, done: me.lucid || me.fragments >= WAKE_NEED },
    { label: "Wake at the altar", done: me.lucid },
    { label: `Phone line ${Math.min(m.phones, 3)}/3`, done: m.phones >= 3 },
  ];
  for (const w of m.wards) rows.push({ label: w.name, done: w.lit });
  return rows;
}

/** Door under the interact prompt, if the padlock should sit on it. */
export function promptDoor(m: Match, id: string): Door | null {
  const me = m.actors.find((a) => a.id === id);
  if (!me || me.dead || me.downed || m.phase !== "play") return null;
  if (me.role === "somnarch") return nearestDoor(m, me, true);
  const shut = nearestDoor(m, me, true);
  if (shut) return shut;
  const threat = monsterOf(m);
  const door = nearestDoor(m, me, false);
  if (door && threat && !threat.dead && dist(me, threat) < 16) return door;
  return null;
}

export const RULES = {
  WAKE_NEED,
  WAKE_TIME,
  REVIVE_TIME,
  WARD_TIME,
  SNUFF_TIME,
  LATCH_TIME,
  BREAK_TIME,
  LISTEN_TIME,
  HOP_TIME: 0.8,
  CRANK_TIME: 1.15,
  CELLAR_SLOW: 2.4,
  DREAMER_HP,
  MONSTER_HP,
  ALTAR_R,
};

export function monsterVisibleTo(viewer: Actor, mon: Actor): boolean {
  if (viewer.role === "somnarch") return true;
  if (viewer.dead) return false;
  if (viewer.senseT > 0) return true;
  const d = dist(viewer, mon);
  if (d < 3.6) return true;
  if (d < 16 && !lineBlocked(viewer.x, viewer.z, mon.x, mon.z)) return true;
  return false;
}

export function dreamerVisibleToMonster(mon: Actor, dreamer: Actor): boolean {
  if (dreamer.dead) return false;
  if (dreamer.markT > 0 || mon.senseT > 0) return true;
  const d = dist(mon, dreamer);
  if (dreamer.veilT > 0 && d > 3.4) return false;
  if (d < 9) return true;
  if ((Math.hypot(dreamer.vx, dreamer.vz) > 6.2 || dreamer.hearT > 0) && d < 20) return true;
  if (d < 26 && !lineBlocked(mon.x, mon.z, dreamer.x, dreamer.z)) return true;
  return false;
}
