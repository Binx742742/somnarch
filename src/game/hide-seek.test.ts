import assert from "node:assert/strict";
import test from "node:test";
import { MONSTER_SPAWN } from "./level.ts";
import { parkedCars, streetLamps } from "./street-props.ts";
import {
  createMatch,
  dreamerVisibleToMonster,
  monsterOf,
  monsterVisibleTo,
  objectiveFor,
  promptFor,
  seedStreetSnares,
  step,
  type Actor,
  type Input,
  type Match,
} from "./sim.ts";

function still(held = false, atk = false): Input {
  return {
    ix: 0,
    iz: 0,
    camYaw: 0,
    sprint: false,
    atk,
    interactHeld: held,
    usePulse: false,
    ablPulse: false,
    dashPulse: false,
    kitPulse: false,
    dropPulse: false,
    hidePulse: false,
  };
}

function hold(match: Match, id: string, frames: number, held = true, atk = false): void {
  const inputs = new Map<string, Input>([[id, still(held, atk)]]);
  for (let i = 0; i < frames; i++) step(match, inputs, 1 / 60);
}

function standOn(actor: Actor, x: number, z: number): void {
  actor.x = x;
  actor.z = z;
  actor.vx = 0;
  actor.vz = 0;
  actor.channel = 0;
  actor.channelT = 0;
}

test("a hider does not spawn with a snare, and crafts one from the wire", () => {
  const match = createMatch(7, [{ id: "ash", name: "Ash", role: "dreamer" }]);
  const ash = match.actors.find((a) => a.id === "ash");
  assert.ok(ash);
  const iron = match.pickups.find((p) => p.id === "loot-f1" && p.kind === "iron");
  assert.ok(iron);
  assert.equal(ash.wire, false);
  assert.equal(match.snares.length, 0);
  assert.ok(Math.hypot(ash.x - iron.x, ash.z - iron.z) > 2);
  assert.equal(objectiveFor(match, ash.id), "Find the wire, then craft a snare.");
  assert.equal(promptFor(match, ash.id), "Find the wire");
  assert.equal(match.banner, "Find the wire, then craft a snare.");
  assert.doesNotMatch(objectiveFor(match, ash.id), /latch|bell|porch/i);

  hold(match, "ash", 90, true);
  assert.equal(ash.wire, false);
  assert.equal(ash.setSnare, false);
  assert.equal(match.snares.length, 0);
  assert.equal(iron.taken, false);

  standOn(ash, iron.x, iron.z);
  assert.equal(promptFor(match, ash.id), "Hold E to take the wire");
  let took = "";
  for (let i = 0; i < 50; i++) {
    step(match, new Map([["ash", still(true)]]), 1 / 60);
    if (ash.wire && !took) took = match.banner;
  }
  assert.equal(took, "The wire is taken.");
  assert.equal(iron.taken, true);
  assert.equal(ash.setSnare, false);
  assert.equal(match.snares.length, 0);
  assert.equal(objectiveFor(match, ash.id), "The wire is taken.");
  assert.equal(promptFor(match, ash.id), "Release, then hold E to craft");

  step(match, new Map([["ash", still(false)]]), 1 / 60);
  assert.equal(promptFor(match, ash.id), "Hold E to craft a snare");
  let set = "";
  for (let i = 0; i < 90; i++) {
    step(match, new Map([["ash", still(true)]]), 1 / 60);
    if (ash.setSnare && !set) set = match.banner;
  }
  assert.equal(set, "The snare is set.");
  assert.equal(objectiveFor(match, ash.id), "The snare is set.");
  assert.equal(ash.wire, false);
  assert.equal(match.snares.length, 1);
  const snare = match.snares[0]!;
  assert.ok(Math.hypot(snare.x - ash.x, snare.z - ash.z) < 1.2);
});

test("a remembered snare does not kill the seeker at spawn, even while disguised", () => {
  const hidden = createMatch(3, [{ id: "ash", name: "Ash", role: "dreamer" }]);
  const ash = hidden.actors.find((a) => a.id === "ash")!;
  const iron = hidden.pickups.find((p) => p.id === "loot-f1")!;
  standOn(ash, iron.x, iron.z);
  hold(hidden, "ash", 50, true);
  step(hidden, new Map([["ash", still(false)]]), 1 / 60);
  hold(hidden, "ash", 90, true);
  const saved = hidden.snares.map((s) => ({ x: s.x, z: s.z }));
  assert.equal(saved.length, 1);

  const seek = createMatch(3, [{ id: "ash", name: "Ash", role: "somnarch" }]);
  seedStreetSnares(seek, saved);
  seedStreetSnares(seek, [{ x: MONSTER_SPAWN[0], z: MONSTER_SPAWN[1] }]);
  assert.equal(seek.snares.length, 1);
  const seeker = monsterOf(seek)!;
  assert.ok(Math.hypot(seeker.x - seek.snares[0]!.x, seeker.z - seek.snares[0]!.z) > 18);
  hold(seek, "ash", 30, false);
  assert.equal(seeker.snared, false);
  assert.doesNotMatch(objectiveFor(seek, seeker.id), /latch|bell|porch|stitch/i);

  seeker.disguise = "streetlamp";
  seeker.x = seek.snares[0]!.x;
  seeker.z = seek.snares[0]!.z;
  step(seek, new Map([["ash", still()]]), 1 / 60);
  assert.equal(seeker.snared, true);
  assert.equal(seeker.downed, true);
  assert.equal(seek.banner, "The snare takes the seeker.");
  assert.equal(objectiveFor(seek, seeker.id), "The snare takes the seeker.");
  assert.equal(promptFor(seek, seeker.id), "The snare takes the seeker.");
});

test("an exposed hider can be found and a hiding one is not revealed by the seeker", () => {
  const match = createMatch(11, [{ id: "ash", name: "Ash", role: "somnarch" }]);
  const seeker = monsterOf(match)!;
  const exposed = match.actors.find((a) => a.role === "dreamer" && !a.hiding);
  const hidden = match.actors.filter((a) => a.role === "dreamer" && a.hiding);
  assert.ok(exposed);
  assert.ok(hidden.length >= 1);
  const gap = Math.hypot(seeker.x - exposed.x, seeker.z - exposed.z);
  assert.ok(gap > 8.2, `exposed hider started too close: ${gap}`);

  hold(match, "ash", 20, false);
  assert.equal(exposed.found, false);
  assert.equal(match.actors.some((a) => a.found), false);
  assert.equal(dreamerVisibleToMonster(seeker, hidden[0]!), false);

  seeker.x = hidden[0]!.x + 6;
  seeker.z = hidden[0]!.z;
  seeker.senseT = 5;
  hidden[0]!.markT = 5;
  hold(match, "ash", 10, false);
  assert.equal(hidden[0]!.found, false);
  assert.equal(dreamerVisibleToMonster(seeker, hidden[0]!), false);
  assert.notEqual(match.banner, "The hider is found.");

  seeker.x = exposed.x + 3;
  seeker.z = exposed.z;
  seeker.senseT = 0;
  step(match, new Map([["ash", still()]]), 1 / 60);
  assert.equal(exposed.found, true);
  assert.equal(match.banner, "The hider is found.");
  assert.equal(objectiveFor(match, seeker.id), "The hider is found.");
  assert.equal(hidden[0]!.found, false);
});

test("the seeker wears loot, a lamp, and a car, then kills a close hider from the disguise", () => {
  const match = createMatch(5, [{ id: "ash", name: "Ash", role: "somnarch" }]);
  const seeker = monsterOf(match)!;
  const wire = match.pickups.find((p) => p.id === "loot-f1" && p.kind === "iron");
  assert.ok(wire);
  const lamp = streetLamps().find(([x, z]) => Math.hypot(x + 82, z - 20) < 0.2);
  assert.ok(lamp);
  const parked = parkedCars();
  assert.ok(parked.length > 1);
  const carIndex = parked.findIndex((car, i) => {
    const lampD = Math.min(...streetLamps().map(([x, z]) => Math.hypot(car.x - x, car.z - z)));
    return lampD > 0.4 && i !== 0;
  });
  assert.ok(carIndex > 0);
  const car = parked[carIndex]!;

  const guise = (): string => seeker.disguise;
  standOn(seeker, wire.x, wire.z);
  let wore = "";
  for (let i = 0; i < 45; i++) {
    step(match, new Map([["ash", still(true)]]), 1 / 60);
    if (guise() === "iron" && !wore) wore = match.banner;
  }
  assert.equal(guise(), "iron");
  assert.equal(wore, "The seeker wears the wire.");
  assert.equal(wire.taken, false);

  standOn(seeker, lamp[0], lamp[1]);
  let lampLine = "";
  for (let i = 0; i < 45; i++) {
    step(match, new Map([["ash", still(true)]]), 1 / 60);
    if (guise() === "streetlamp" && !lampLine) lampLine = match.banner;
  }
  assert.equal(guise(), "streetlamp");
  assert.equal(lampLine, "The seeker wears the street lamp.");

  for (const p of match.pickups) {
    if (Math.hypot(p.x - car.x, p.z - car.z) < 3) p.taken = true;
  }
  standOn(seeker, car.x, car.z);
  let carLine = "";
  for (let i = 0; i < 45; i++) {
    step(match, new Map([["ash", still(true)]]), 1 / 60);
    if (guise() === `car:${carIndex}` && !carLine) carLine = match.banner;
  }
  assert.equal(guise(), `car:${carIndex}`);
  assert.equal(carLine, "The seeker wears the car.");

  const victim = match.actors.find((a) => a.role === "dreamer" && a.hiding) ?? match.actors.find((a) => a.role === "dreamer");
  assert.ok(victim);
  for (const other of match.actors) {
    if (other.role === "dreamer" && other !== victim) other.dead = true;
  }
  victim.hiding = true;
  victim.dead = false;
  victim.x = seeker.x + 1.2;
  victim.z = seeker.z;
  const watcher = victim;
  assert.equal(monsterVisibleTo(watcher, seeker), false);
  step(match, new Map([["ash", still(false)]]), 1 / 60);
  assert.equal(victim.dead, false);
  assert.equal(guise(), `car:${carIndex}`);

  step(match, new Map([["ash", still(false, true)]]), 1 / 60);
  assert.equal(match.banner, "The hider is killed.");
  assert.equal(objectiveFor(match, seeker.id), "The hider is killed.");
  assert.equal(promptFor(match, seeker.id), "The hider is killed.");
  assert.equal(victim.dead, true);
  assert.equal(victim.found, false);
  assert.equal(guise(), "");
  assert.equal(seeker.didKill, true);
});
