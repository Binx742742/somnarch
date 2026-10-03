import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { DreamAudio } from "./audio";
import { BOUNDARY, BLOCKS, CAR_SPOTS, SHORTCUTS, TELLS, doorSpots, groundY, moveCircle, setLatchedDoors } from "./level";
import { DreamRenderer, type RenderView } from "./renderer";
import {
  RULES,
  cameraToWorld,
  checklistFor,
  createMatch,
  dreamerVisibleToMonster,
  isWeapon,
  itemLabel,
  monsterOf,
  monsterVisibleTo,
  objectiveFor,
  promptDoor,
  promptFor,
  step,
  weaponLabel,
  yawForDirection,
  type Actor,
  type HumanSpec,
  type Input,
  type Match,
  type Role,
} from "./sim";

export type Member = {
  id: string;
  name: string;
  want: Role;
  state: string;
  seated: boolean;
};

export type Screen =
  | { kind: "menu" }
  | { kind: "lobby"; code: string; host: boolean; members: Member[]; note: string }
  | { kind: "play"; pause: boolean }
  | { kind: "end"; result: "win" | "lose"; line: string; canRestart: boolean };

export type HudNodes = {
  root: HTMLDivElement | null;
  objective: HTMLElement | null;
  prompt: HTMLElement | null;
  hp: HTMLElement | null;
  stam: HTMLElement | null;
  keys: HTMLElement | null;
  channel: HTMLElement | null;
  channelFill: HTMLElement | null;
  banner: HTMLElement | null;
  log: HTMLElement | null;
  items: HTMLElement | null;
  cds: HTMLElement | null;
  monsterWrap: HTMLElement | null;
  monsterFill: HTMLElement | null;
  map: HTMLCanvasElement | null;
  names: HTMLElement | null;
  role: HTMLElement | null;
  clock: HTMLElement | null;
  checklist: HTMLElement | null;
  journal: HTMLElement | null;
  mood: HTMLElement | null;
  moodLabel: HTMLElement | null;
  lock: HTMLElement | null;
  hearts: HTMLElement | null;
};

type NetMsg =
  | { k: "want"; role: Role; name: string }
  | { k: "lobby"; hostId: string; members: Member[] }
  | { k: "begin"; seed: number }
  | { k: "snap"; state: SnapState }
  | { k: "input"; input: Input };

type SnapState = {
  time: number;
  phase: Match["phase"];
  log: string[];
  banner: string;
  bannerT: number;
  actors: Actor[];
  pickups: Match["pickups"];
  wards?: Match["wards"];
  doors?: Match["doors"];
  snares?: Match["snares"];
  cars?: Match["cars"];
  phones?: number;
  taughtLatch?: boolean;
};

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "Space",
  "KeyE",
  "KeyQ",
  "KeyF",
  "KeyR",
  "KeyG",
]);

function makeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function emptyInput(yaw = 0): Input {
  return {
    ix: 0,
    iz: 0,
    camYaw: yaw,
    sprint: false,
    atk: false,
    interactHeld: false,
    usePulse: false,
    ablPulse: false,
    dashPulse: false,
    kitPulse: false,
    dropPulse: false,
  };
}

function isRole(v: unknown): v is Role {
  return v === "dreamer" || v === "somnarch";
}

function asMsg(data: unknown): NetMsg | null {
  if (!data || typeof data !== "object" || !("k" in data)) return null;
  return data as NetMsg;
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
    };
  }
}

export class DreamSession {
  readonly selfId = makeId();
  private readonly canvas: HTMLCanvasElement;
  private readonly audio = new DreamAudio();
  private readonly renderer: DreamRenderer;
  private readonly keys = new Set<string>();
  private injected: Set<string> | null = null;
  private readonly onScreen: (screen: Screen) => void;
  private readonly hud: HudNodes;
  private room: P2PRoom | null = null;
  private peers: PeerInfo[] = [];
  private wants = new Map<string, Role>();
  private names = new Map<string, string>();
  private remotes = new Map<string, { input: Input; at: number }>();
  private match: Match | null = null;
  private mode: "menu" | "solo" | "host" | "client" = "menu";
  private pause = false;
  private ended = false;
  private lastRole: Role = "dreamer";
  private playerName = "Ash";
  private want: Role = "dreamer";
  private code = "";
  private hostId = "";
  private isHost = false;
  private camYaw = 0.4;
  private camPitch = 0.62;
  private snapCam = false;
  private impulse = 0;
  private hurt = 0;
  private foot = 0;
  private snapAcc = 0;
  private sendAcc = 0;
  private lookDx = 0;
  private lookDy = 0;
  private mouse = false;
  private prevDown = { use: false, abl: false, dash: false, kit: false, drop: false };
  private localInput = emptyInput();
  private readonly touch = {
    ix: 0,
    iz: 0,
    sprint: false,
    atk: false,
    interact: false,
    use: false,
    abl: false,
    dash: false,
    kit: false,
    drop: false,
  };
  private reduced = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private labelPool: HTMLDivElement[] = [];

  constructor(canvas: HTMLCanvasElement, hud: HudNodes, onScreen: (screen: Screen) => void) {
    this.canvas = canvas;
    this.hud = hud;
    this.onScreen = onScreen;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new DreamRenderer(canvas);
    this.bind();
    window.__controlsTest = {
      getYaw: () => this.me()?.yaw ?? 0,
      getSpeed: () => {
        const me = this.me();
        return me ? Math.hypot(me.vx, me.vz) : 0;
      },
      setKeys: (codes) => {
        this.injected = codes.length ? new Set(codes) : null;
      },
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  startSolo(role: Role, name: string): void {
    this.audio.unlock();
    this.closeRoom();
    this.playerName = name || "Ash";
    this.lastRole = role;
    this.mode = "solo";
    this.pause = false;
    this.ended = false;
    this.bootMatch(createMatch((Math.random() * 1e9) >>> 0, [{ id: this.selfId, name: this.playerName, role }]));
  }

  hostCircle(code: string, name: string): void {
    this.audio.unlock();
    this.playerName = name || "Ash";
    this.code = code;
    this.isHost = true;
    this.hostId = this.selfId;
    this.want = "dreamer";
    this.wants.set(this.selfId, this.want);
    this.names.set(this.selfId, this.playerName);
    this.openRoom();
    this.pushScreenLobby("Opening the circle…");
  }

  joinCircle(code: string, name: string): void {
    this.audio.unlock();
    this.playerName = name || "Ash";
    this.code = code;
    this.isHost = false;
    this.hostId = "";
    this.want = "dreamer";
    this.wants.set(this.selfId, this.want);
    this.names.set(this.selfId, this.playerName);
    this.openRoom();
    this.pushScreenLobby("Looking for the circle…");
  }

  setWant(role: Role): void {
    this.want = role;
    this.wants.set(this.selfId, role);
    this.room?.send({ k: "want", role, name: this.playerName });
    if (this.isHost) this.pushScreenLobby("");
  }

  begin(): void {
    if (!this.isHost && this.mode !== "solo") return;
    const roster = this.roster();
    const seed = (Math.random() * 1e9) >>> 0;
    this.room?.send({ k: "begin", seed });
    this.mode = this.room ? "host" : "solo";
    this.bootMatch(createMatch(seed, roster));
  }

  again(): void {
    if (this.mode === "client") return;
    if (this.mode === "host") this.begin();
    else this.startSolo(this.lastRole, this.playerName);
  }

  leave(): void {
    this.closeRoom();
    this.match = null;
    this.mode = "menu";
    this.pause = false;
    this.ended = false;
    this.renderer.setDolls(true);
    document.exitPointerLock?.();
    this.onScreen({ kind: "menu" });
  }

  togglePause(): void {
    if (this.mode !== "solo" || !this.match || this.match.phase !== "play") return;
    this.pause = !this.pause;
    if (this.pause) document.exitPointerLock?.();
    this.onScreen({ kind: "play", pause: this.pause });
  }

  setMuted(muted: boolean): void {
    if (!muted) this.audio.unlock();
    this.audio.setMuted(muted);
  }

  setStick(ix: number, iz: number): void {
    this.touch.ix = ix;
    this.touch.iz = iz;
  }

  addLook(dx: number, dy: number): void {
    this.lookDx += dx;
    this.lookDy += dy;
  }

  setTouchFlag(key: "sprint" | "atk" | "interact" | "use" | "abl" | "dash" | "kit" | "drop", down: boolean): void {
    this.touch[key] = down;
  }

  layout(): void {
    this.renderer.resize();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.closeRoom();
    this.unbind();
    this.renderer.dispose();
    if (window.__controlsTest) delete window.__controlsTest;
  }

  private bootMatch(match: Match): void {
    this.match = match;
    this.ended = false;
    this.pause = false;
    this.camYaw = 0;
    this.camPitch = 0.72;
    this.snapCam = true;
    this.renderer.setDolls(false);
    const me = this.me();
    if (me) this.camYaw = me.yaw;
    this.onScreen({ kind: "play", pause: false });
  }

  private me(): Actor | null {
    return this.match?.actors.find((a) => a.id === this.selfId) ?? null;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.readLook();
    this.buildLocalInput();
    if (this.match && this.match.phase === "play" && !(this.pause && this.mode === "solo")) {
      if (this.mode === "client") this.predict(dt);
      else {
        this.acc += dt;
        let guard = 0;
        const inputs = this.inputMap();
        while (this.acc >= 1 / 60 && guard < 5 && this.match.phase === "play") {
          this.acc -= 1 / 60;
          guard += 1;
          const events = step(this.match, inputs, 1 / 60);
          this.playEvents(events);
        }
      }
    } else {
      this.acc = 0;
    }
    this.netTick(dt);
    this.finishPhase();
    this.audio.heart = this.tension();
    this.audio.update(dt);
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    this.paint(dt);
    const view = this.makeView();
    this.renderer.render(dt, view);
    view.snap = false;
    this.snapCam = false;
  };

  private readLook(): void {
    this.camYaw -= this.lookDx;
    this.camPitch = Math.max(0.28, Math.min(1.08, this.camPitch + this.lookDy));
    this.lookDx = 0;
    this.lookDy = 0;
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const lx = pad.axes[2] ?? 0;
      const ly = pad.axes[3] ?? 0;
      const mag = Math.hypot(lx, ly);
      if (mag > 0.18) {
        const s = (mag - 0.18) / 0.82 / mag;
        this.camYaw -= lx * s * 2.2 * (1 / 60);
        this.camPitch = Math.max(0.28, Math.min(1.08, this.camPitch + ly * s * 1.5 * (1 / 60)));
      }
    }
  }

  private down(code: string): boolean {
    return this.injected ? this.injected.has(code) : this.keys.has(code);
  }

  private buildLocalInput(): void {
    let ix = (this.down("KeyD") || this.down("ArrowRight") ? 1 : 0) - (this.down("KeyA") || this.down("ArrowLeft") ? 1 : 0);
    let iz = (this.down("KeyW") || this.down("ArrowUp") ? 1 : 0) - (this.down("KeyS") || this.down("ArrowDown") ? 1 : 0);
    const pads = navigator.getGamepads?.() ?? [];
    let padSprint = false;
    let padAtk = false;
    let padInteract = false;
    let padUse = false;
    let padAbl = false;
    let padDash = false;
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const dz = radial(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), 0.18);
      ix += dz.x;
      iz += dz.y;
      padSprint = pad.buttons[4]?.pressed || pad.buttons[10]?.pressed || false;
      padAtk = (pad.buttons[7]?.value ?? 0) > 0.45 || !!pad.buttons[5]?.pressed;
      padInteract = !!pad.buttons[0]?.pressed;
      padUse = !!pad.buttons[2]?.pressed;
      padAbl = !!pad.buttons[3]?.pressed;
      padDash = !!pad.buttons[1]?.pressed;
    }
    ix += this.touch.ix;
    iz += this.touch.iz;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) {
      ix /= mag;
      iz /= mag;
    }
    const useDown = this.down("KeyF") || this.touch.use || padUse;
    const ablDown = this.down("KeyQ") || this.touch.abl || padAbl;
    const dashDown = this.down("Space") || this.touch.dash || padDash;
    const kitDown = this.down("KeyR") || this.touch.kit;
    const dropDown = this.down("KeyG") || this.touch.drop;
    const input = this.localInput;
    input.ix = ix;
    input.iz = iz;
    input.camYaw = this.camYaw;
    input.sprint = this.down("ShiftLeft") || this.down("ShiftRight") || this.touch.sprint || padSprint;
    input.atk = this.mouse || this.touch.atk || padAtk;
    input.interactHeld = this.down("KeyE") || this.touch.interact || padInteract;
    input.usePulse = useDown && !this.prevDown.use;
    input.ablPulse = ablDown && !this.prevDown.abl;
    input.dashPulse = dashDown && !this.prevDown.dash;
    input.kitPulse = kitDown && !this.prevDown.kit;
    input.dropPulse = dropDown && !this.prevDown.drop;
    this.prevDown = { use: useDown, abl: ablDown, dash: dashDown, kit: kitDown, drop: dropDown };
  }

  private inputMap(): Map<string, Input> {
    const map = new Map<string, Input>();
    map.set(this.selfId, this.localInput);
    const now = performance.now();
    for (const [id, rec] of this.remotes) {
      if (now - rec.at < 450) map.set(id, rec.input);
    }
    return map;
  }

  private predict(dt: number): void {
    const me = this.me();
    if (!me || me.dead || me.downed || me.stun > 0) return;
    const world = cameraToWorld(this.localInput.ix, this.localInput.iz, this.camYaw);
    const len = Math.hypot(world.x, world.z);
    if (len < 0.01) {
      me.vx = 0;
      me.vz = 0;
      me.yaw = approach(me.yaw, this.camYaw, 8, dt);
      return;
    }
    const sprint = this.localInput.sprint ? 1.56 : 1;
    const speed = (me.role === "somnarch" ? 5.55 : 4.45) * sprint;
    if (this.match) setLatchedDoors(this.match.doors.filter((d) => d.latched).map((d) => d.id));
    const ox = me.x;
    const oz = me.z;
    const next = moveCircle(
      me.x,
      me.z,
      (world.x / len) * speed * dt,
      (world.z / len) * speed * dt,
      me.role === "somnarch" ? 0.72 : 0.44,
    );
    me.x = next.x;
    me.z = next.z;
    me.vx = (me.x - ox) / dt;
    me.vz = (me.z - oz) / dt;
    me.yaw = approach(me.yaw, yawForDirection(world.x, world.z), 11, dt);
  }

  private playEvents(events: ReturnType<typeof step>): void {
    for (const e of events) {
      if (e.type === "hit" && e.victim === this.selfId) {
        this.hurt = 1;
        if (!this.reduced) this.impulse = Math.max(this.impulse, 0.22);
        this.audio.hit();
      } else if (e.type === "hit") this.audio.hit();
      else if (e.type === "swing" && e.who === this.selfId) this.audio.swing();
      else if (e.type === "pick" && e.who === this.selfId) this.audio.pick();
      else if (e.type === "lucid" && e.who === this.selfId) this.audio.lucid();
      else if (e.type === "lucid") this.audio.lucid();
      else if (e.type === "down") this.audio.down();
      else if (e.type === "death") this.audio.death();
      else if (e.type === "stun") this.audio.stun();
      else if (e.type === "veil") this.audio.veil();
      else if (e.type === "ward") this.audio.ward();
      else if (e.type === "snuff") this.audio.snuff();
      else if (e.type === "stitch") this.audio.stitch();
      else if (e.type === "door") this.audio.door(e.broken);
      else if (e.type === "listen") this.audio.listen();
      else if (e.type === "commit") this.audio.commit();
    }
  }

  private finishPhase(): void {
    if (!this.match || this.ended || this.match.phase === "play") return;
    this.ended = true;
    document.exitPointerLock?.();
    if (this.match.phase === "win") this.audio.win();
    else this.audio.lose();
    this.onScreen({
      kind: "end",
      result: this.match.phase,
      line: this.match.banner,
      canRestart: this.mode !== "client",
    });
  }

  private tension(): number {
    const me = this.me();
    const mon = this.match ? monsterOf(this.match) : undefined;
    if (!me || !mon || mon.dead || me.dead || me.role === "somnarch") {
      if (me?.role === "somnarch" && this.match) {
        let near = 0;
        for (const a of this.match.actors) {
          if (a.role !== "dreamer" || a.dead) continue;
          near = Math.max(near, 1 - Math.hypot(me.x - a.x, me.z - a.z) / 16);
        }
        return near;
      }
      return 0;
    }
    const near = Math.max(0, Math.min(1, 1 - Math.hypot(me.x - mon.x, me.z - mon.z) / 18));
    return Math.max(near, Math.min(1, me.fear / 120));
  }

  private makeView(): RenderView {
    const me = this.me();
    const hidden = new Set<string>();
    if (this.match && me) {
      const mon = monsterOf(this.match);
      if (me.role === "dreamer" && mon && !monsterVisibleTo(me, mon)) hidden.add(mon.id);
      if (me.role === "somnarch") {
        for (const a of this.match.actors) {
          if (a.role === "dreamer" && !dreamerVisibleToMonster(me, a)) hidden.add(a.id);
        }
      }
    }
    const playing = this.mode !== "menu" && !!this.match;
    return {
      mode: !playing ? "menu" : this.match && this.match.phase !== "play" ? "end" : "play",
      camYaw: this.camYaw,
      camPitch: this.camPitch,
      targetX: me?.x ?? 0,
      targetZ: me?.z ?? 0,
      snap: this.snapCam,
      actors: playing && this.match ? this.match.actors : [],
      pickups: playing && this.match ? this.match.pickups : [],
      viewerId: this.selfId,
      viewerRole: me?.role ?? null,
      hidden,
      shake: this.impulse,
      wards: this.match?.wards ?? [],
      doors: this.match?.doors ?? [],
      focusDoor: this.match && me ? (promptDoor(this.match, me.id)?.id ?? null) : null,
      snares: this.match?.snares ?? [],
    };
  }

  private paint(dt: number): void {
    this.impulse = 0;
    const root = this.hud.root;
    if (root) {
      root.style.setProperty("--hurt", this.hurt.toFixed(3));
      root.style.setProperty("--near", this.tension().toFixed(3));
    }
    const me = this.me();
    const playing = !!this.match && this.mode !== "menu";
    if (!playing || !me || !this.match) return;
    const speed = Math.hypot(me.vx, me.vz);
    if (speed > 2.4 && !me.dead && !me.downed) {
      this.foot += dt;
      if (this.foot > 0.42) {
        this.foot = 0;
        this.audio.foot();
      }
    }
    setText(this.hud.objective, objectiveFor(this.match, me.id));
    setText(this.hud.prompt, promptFor(this.match, me.id));
    setText(this.hud.role, roleLabel(me));
    setText(this.hud.clock, clockText(this.match.time));
    paintChecklist(this.hud.checklist, checklistFor(this.match, me.id));
    paintJournal(this.hud.journal, me.heard ?? []);
    const quiet = me.role === "somnarch" ? me.spd < 2.8 && me.stalk > 18 : me.fear < 22;
    const fade = quiet ? "0.32" : "1";
    for (const el of [this.hud.checklist, this.hud.objective, this.hud.clock, this.hud.map, this.hud.cds]) {
      if (el) el.style.opacity = fade;
    }
    const mood = me.role === "somnarch" ? me.stalk / 100 : me.fear / 100;
    if (this.hud.mood) this.hud.mood.style.transform = `scaleX(${Math.max(0, Math.min(1, mood))})`;
    setText(this.hud.moodLabel, me.role === "somnarch" ? "Stalk" : "Fear");
    this.placeLock(me);
    const hpMax = me.role === "somnarch" ? RULES.MONSTER_HP : RULES.DREAMER_HP;
    if (this.hud.hp) this.hud.hp.style.transform = `scaleX(${Math.max(0, me.hp / hpMax)})`;
    if (this.hud.stam) this.hud.stam.style.transform = `scaleX(${me.stamina / 100})`;
    setText(
      this.hud.keys,
      me.role === "somnarch"
        ? "Bone and needle"
        : me.lucid
          ? `Lucid · nerve ${Math.round(me.nerve)}`
          : `Latch-keys ${me.fragments}/${RULES.WAKE_NEED} · nerve ${Math.round(me.nerve)}`,
    );
    const channelMax =
      me.channel === 2
        ? RULES.REVIVE_TIME
        : me.channel === 3
          ? RULES.WARD_TIME
          : me.channel === 4
            ? RULES.SNUFF_TIME
            : me.channel === 5
              ? RULES.LATCH_TIME
              : me.channel === 6
                ? RULES.BREAK_TIME
                : me.channel === 7
                  ? me.role === "somnarch"
                    ? RULES.CELLAR_SLOW
                    : RULES.HOP_TIME
                  : me.channel === 8
                    ? RULES.CRANK_TIME
                    : me.channel === 9
                      ? RULES.LISTEN_TIME
                      : RULES.WAKE_TIME;
    if (this.hud.channel) this.hud.channel.hidden = me.channel === 0;
    if (this.hud.channelFill) this.hud.channelFill.style.transform = `scaleX(${Math.min(1, me.channelT / channelMax)})`;
    if (this.hud.banner) {
      this.hud.banner.hidden = this.match.bannerT <= 0;
      if (this.match.bannerT > 0) this.hud.banner.textContent = this.match.banner;
    }
    if (this.hud.log) {
      this.hud.log.replaceChildren(
        ...this.match.log.map((line) => {
          const p = document.createElement("p");
          p.textContent = line;
          return p;
        }),
      );
    }
    const pocket = me.items.map(itemLabel);
    if (me.role === "dreamer" && me.weapon) pocket.push(weaponLabel(me.weapon));
    if (me.guard > 0) pocket.push("Ward up");
    if (me.hasteT > 0) pocket.push("Running");
    setText(this.hud.items, pocket.length ? pocket.join(" · ") : "Empty pockets");
    const ready: string[] = [];
    if (me.abilityCd <= 0.05) {
      if (me.role === "somnarch") ready.push("Q sense");
      else if (me.lucid) ready.push("Q pulse");
      else if (me.nerve >= 34) ready.push("Q veil");
    }
    if (me.dashCd <= 0.05) ready.push("Space");
    if (me.role === "somnarch" && me.kitCd <= 0.05) ready.push("R stitch");
    if (me.role === "dreamer" && me.lucid && me.tetherCd <= 0.05) ready.push("R tether");
    if (me.items.length > 0) ready.push(`F ${itemLabel(me.items[0]!)}`);
    setText(this.hud.cds, ready.join("\n"));
    const mon = monsterOf(this.match);
    const showMon = !!mon && me.role === "dreamer" && (me.lucid || (me.senseT > 0 && !mon.dead));
    if (this.hud.monsterWrap) this.hud.monsterWrap.hidden = !showMon;
    if (this.hud.monsterFill && mon) this.hud.monsterFill.style.transform = `scaleX(${Math.max(0, mon.hp / RULES.MONSTER_HP)})`;
    paintHearts(this.hud.hearts, me.hp, hpMax);
    this.drawMap(me);
    this.drawNames(me);
  }

  private placeLock(me: Actor): void {
    const lock = this.hud.lock;
    if (!lock || !this.match) return;
    const door = promptDoor(this.match, me.id);
    if (!door) {
      lock.hidden = true;
      return;
    }
    lock.classList.toggle("is-shut", door.latched);
    const host = this.hud.root?.getBoundingClientRect();
    if (!host) return;
    const p = this.renderer.project(door.x, groundY(door.x, door.z) + 1.45, door.z, host.width, host.height);
    lock.hidden = !p.visible;
    lock.style.left = `${p.x}px`;
    lock.style.top = `${p.y}px`;
  }

  private drawMap(me: Actor): void {
    const canvas = this.hud.map;
    if (!canvas || !this.match) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "rgba(7,6,10,0.72)";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    const X = (x: number) => s / 2 + (x / BOUNDARY) * (s * 0.42);
    const Y = (z: number) => s / 2 + (z / BOUNDARY) * (s * 0.42);
    ctx.strokeStyle = "rgba(228,211,176,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(228,211,176,0.9)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", s / 2, 16);
    ctx.fillStyle = "rgba(196,69,54,0.9)";
    for (const b of BLOCKS) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(240,230,216,0.18)";
      ctx.fillRect(X(b.x - b.w / 2), Y(b.z - b.d / 2), (b.w / BOUNDARY) * s * 0.42, (b.d / BOUNDARY) * s * 0.42);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(228,211,176,0.7)";
    for (const sc of SHORTCUTS) {
      ctx.fillRect(X(sc.ax) - 1.2, Y(sc.az) - 1.2, 2.4, 2.4);
      ctx.fillRect(X(sc.bx) - 1.2, Y(sc.bz) - 1.2, 2.4, 2.4);
    }
    for (const door of this.match.doors) {
      ctx.fillStyle = door.latched ? "#c44536" : "rgba(228,211,176,0.85)";
      ctx.fillRect(X(door.x) - 1.5, Y(door.z) - 1.5, 3, 3);
    }
    if (me.role === "dreamer") {
      ctx.fillStyle = "#e4d3b0";
      ctx.beginPath();
      ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2);
      ctx.fill();
      for (const w of this.match.wards) {
        ctx.fillStyle = w.lit ? "#c44536" : "#e4d3b0";
        ctx.fillRect(X(w.x) - 2, Y(w.z) - 2, 4, 4);
      }
      for (const p of this.match.pickups) {
        if (p.taken) continue;
        if (p.kind === "fragment" || p.kind === "phone") {
          ctx.fillStyle = p.kind === "phone" ? "#c44536" : "#e4d3b0";
          ctx.fillRect(X(p.x) - 1.5, Y(p.z) - 1.5, 3, 3);
        } else if (isWeapon(p.kind)) {
          ctx.fillStyle = "#d8c4a8";
          ctx.fillRect(X(p.x) - 2, Y(p.z) - 2, 4, 4);
        } else if (p.kind === "mend" || p.kind === "haste" || p.kind === "hush" || p.kind === "ward") {
          ctx.fillStyle = "#8fd0c6";
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.z), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    for (const a of this.match.actors) {
      if (a.dead) continue;
      if (a.id !== me.id) {
        const mon = monsterOf(this.match);
        if (a.role === "somnarch" && mon && !monsterVisibleTo(me, mon) && me.role === "dreamer") continue;
        if (me.role === "somnarch" && a.role === "dreamer" && !dreamerVisibleToMonster(me, a)) continue;
      }
      ctx.fillStyle = a.role === "somnarch" ? "#c44536" : a.lucid ? "#e4d3b0" : "#f0e6d8";
      ctx.beginPath();
      ctx.arc(X(a.x), Y(a.z), a.id === me.id ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (a.id === me.id) {
        const fx = -Math.sin(me.yaw);
        const fz = -Math.cos(me.yaw);
        ctx.strokeStyle = "#e4d3b0";
        ctx.beginPath();
        ctx.moveTo(X(a.x), Y(a.z));
        ctx.lineTo(X(a.x) + fx * 7, Y(a.z) + fz * 7);
        ctx.stroke();
      }
    }
  }

  private drawNames(me: Actor): void {
    const layer = this.hud.names;
    if (!layer || !this.match) return;
    const rect = layer.getBoundingClientRect();
    const actors = this.match.actors.filter((a) => a.id !== me.id && !a.dead);
    while (this.labelPool.length < actors.length) {
      const el = document.createElement("div");
      el.className = "dream-name";
      layer.appendChild(el);
      this.labelPool.push(el);
    }
    const hidden = this.makeHidden();
    actors.forEach((a, i) => {
      const el = this.labelPool[i]!;
      if (hidden.has(a.id)) {
        el.style.display = "none";
        return;
      }
      const p = this.renderer.project(
        a.x,
        groundY(a.x, a.z) + (a.downed ? 1.1 : a.role === "somnarch" ? 2.9 : 2.15),
        a.z,
        rect.width,
        rect.height,
      );
      if (!p.visible || p.x < -40 || p.y < -40 || p.x > rect.width + 40 || p.y > rect.height + 40) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.textContent = a.role === "somnarch" ? "Somnarch" : a.lucid ? `${a.name} · Lucid` : a.name;
    });
    for (let i = actors.length; i < this.labelPool.length; i++) this.labelPool[i]!.style.display = "none";
  }

  private makeHidden(): Set<string> {
    return this.makeView().hidden;
  }

  private netTick(dt: number): void {
    if (!this.room || !this.match || this.match.phase === "lose" && this.ended) {
      /* still send while win banner is up so peers see the end */
    }
    if (this.mode === "client" && this.match) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / 20) {
        this.sendAcc = 0;
        this.room?.broadcast({ k: "input", input: { ...this.localInput, items: undefined } });
        this.localInput.usePulse = false;
        this.localInput.ablPulse = false;
        this.localInput.dashPulse = false;
        this.localInput.kitPulse = false;
        this.localInput.dropPulse = false;
      }
    }
    if (this.mode === "host" && this.match) {
      this.snapAcc += dt;
      if (this.snapAcc >= 1 / 12) {
        this.snapAcc = 0;
        this.room?.broadcast({ k: "snap", state: snapOf(this.match) });
      }
    }
  }

  private roster(): HumanSpec[] {
    const members = this.memberList().filter((m) => m.seated);
    const specs: HumanSpec[] = members.map((m) => ({
      id: m.id,
      name: m.name || "Dreamer",
      role: "dreamer",
    }));
    const claim = members.find((m) => (this.wants.get(m.id) ?? "dreamer") === "somnarch");
    if (claim) {
      const row = specs.find((s) => s.id === claim.id);
      if (row) row.role = "somnarch";
    }
    const dreamers = specs.filter((s) => s.role === "dreamer");
    if (dreamers.length === specs.length && specs.length >= 5) {
      const host = specs.find((s) => s.id === this.selfId) ?? specs[0];
      if (host) host.role = "somnarch";
    }
    return specs;
  }

  private memberList(): Member[] {
    const ids = [this.selfId, ...this.peers.map((p) => p.id).filter((id) => id !== this.selfId)];
    return ids.map((id, index) => {
      const peer = this.peers.find((p) => p.id === id);
      return {
        id,
        name: id === this.selfId ? this.playerName : this.names.get(id) || peer?.name || "Dreamer",
        want: this.wants.get(id) ?? "dreamer",
        state: id === this.selfId ? "you" : peer ? linkLabel(peer.connectionState) : "linking",
        seated: index < 5,
      };
    });
  }

  private pushScreenLobby(note: string): void {
    this.onScreen({
      kind: "lobby",
      code: this.code,
      host: this.isHost,
      members: this.memberList(),
      note,
    });
  }

  private openRoom(): void {
    this.closeRoom();
    this.room = new P2PRoom({
      room: `somn-${this.code}`,
      selfId: this.selfId,
      name: this.playerName,
      onPeersChanged: (peers) => {
        this.peers = peers;
        if (this.match && (this.mode === "host" || this.isHost)) {
          const live = new Set(peers.map((p) => p.id));
          for (const actor of this.match.actors) {
            if (!actor.bot && actor.id !== this.selfId && !live.has(actor.id)) actor.bot = true;
          }
        }
        this.room?.send({ k: "want", role: this.want, name: this.playerName });
        if (this.isHost && this.mode !== "solo") this.pushScreenLobby(peers.length ? "" : "Waiting for souls…");
      },
      onMessage: (from, data) => this.onNet(from, data),
    });
    void this.room.join();
  }

  private onNet(from: string, data: unknown): void {
    const msg = asMsg(data);
    if (!msg) return;
    if (msg.k === "want" && isRole(msg.role)) {
      this.wants.set(from, msg.role);
      if (msg.name) this.names.set(from, msg.name.slice(0, 16));
      if (this.isHost) this.pushScreenLobby("");
      return;
    }
    if (msg.k === "lobby" && this.mode !== "solo") {
      this.hostId = msg.hostId;
      this.isHost = msg.hostId === this.selfId;
      for (const m of msg.members) {
        this.wants.set(m.id, m.want);
        this.names.set(m.id, m.name);
      }
      if (!this.match) {
        this.onScreen({
          kind: "lobby",
          code: this.code,
          host: this.isHost,
          members: msg.members,
          note: "",
        });
      }
      return;
    }
    if (msg.k === "begin") {
      this.ended = false;
      this.pause = false;
      this.mode = this.isHost ? "host" : "client";
      if (!this.isHost) {
        this.match = null;
        this.renderer.setDolls(false);
        this.onScreen({ kind: "play", pause: false });
      }
      return;
    }
    if (msg.k === "input" && this.mode === "host" && msg.input) {
      this.remotes.set(from, { input: { ...emptyInput(), ...msg.input }, at: performance.now() });
      return;
    }
    if (msg.k === "snap" && this.mode === "client" && msg.state) {
      this.absorb(msg.state);
    }
  }

  private absorb(state: SnapState): void {
    const prev = this.me();
    this.match = {
      seed: 0,
      time: state.time,
      phase: state.phase,
      log: state.log ?? [],
      banner: state.banner ?? "",
      bannerT: state.bannerT ?? 0,
      actors: state.actors,
      pickups: state.pickups,
      wards: state.wards ?? [],
      doors: (state.doors ?? doorSpots().map((d) => ({ ...d, latched: false, hits: 0, rattle: 0 }))).map((d) => ({
        ...d,
        rattle: d.rattle ?? 0,
      })),
      snares: state.snares ?? [],
      cars: state.cars ?? CAR_SPOTS.map((c) => ({ ...c, cd: 0 })),
      phones: state.phones ?? 0,
      taughtLatch: state.taughtLatch ?? false,
    };
    setLatchedDoors(this.match.doors.filter((d) => d.latched).map((d) => d.id));
    const me = this.me();
    if (prev && me && !me.dead) {
      const err = Math.hypot(prev.x - me.x, prev.z - me.z);
      if (err < 3) {
        me.x = me.x * 0.35 + prev.x * 0.65;
        me.z = me.z * 0.35 + prev.z * 0.65;
        me.yaw = prev.yaw;
        me.vx = prev.vx;
        me.vz = prev.vz;
      }
    }
    if (!prev && me) {
      this.camYaw = me.yaw;
      this.snapCam = true;
    }
  }

  private closeRoom(): void {
    this.room?.close();
    this.room = null;
    this.peers = [];
    this.remotes.clear();
  }

  private bind(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("click", this.onCanvasClick);
    window.addEventListener("resize", this.onResize);
  }

  private unbind(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onCanvasClick);
    window.removeEventListener("resize", this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (typing) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Escape" && this.mode === "solo") this.togglePause();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouse = false;
  };

  private onVis = (): void => {
    if (document.visibilityState === "visible") this.audio.resume();
    else this.keys.clear();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.camYaw -= e.movementX * 0.0022;
    this.camPitch = Math.max(0.28, Math.min(1.08, this.camPitch + e.movementY * 0.0018));
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && document.pointerLockElement === this.canvas) this.mouse = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouse = false;
  };

  private onCanvasClick = (): void => {
    if (this.mode === "menu" || this.pause || this.ended) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    this.canvas.requestPointerLock();
  };

  private onResize = (): void => {
    this.renderer.resize();
  };
}

function approach(current: number, target: number, rate: number, dt: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const max = rate * dt;
  return current + Math.max(-max, Math.min(max, d));
}

function radial(x: number, y: number, dz: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function roleLabel(a: Actor): string {
  if (a.dead) return "Stitched under";
  if (a.downed) return "Bleeding out";
  if (a.role === "somnarch") return "The Somnarch";
  if (a.lucid) return "Lucid";
  return "Dreamer";
}

function linkLabel(state: string): string {
  if (state === "connected") return "linked";
  if (state === "failed") return "blocked";
  return "linking";
}

function snapOf(m: Match): SnapState {
  return {
    time: m.time,
    phase: m.phase,
    log: m.log,
    banner: m.banner,
    bannerT: m.bannerT,
    actors: m.actors.map((a) => ({ ...a, items: a.items.slice(), heard: (a.heard ?? []).slice() })),
    pickups: m.pickups.map((p) => ({ ...p })),
    wards: m.wards.map((w) => ({ ...w })),
    doors: m.doors.map((d) => ({ ...d })),
    snares: m.snares.map((s) => ({ ...s })),
    cars: m.cars.map((c) => ({ ...c })),
    phones: m.phones,
    taughtLatch: m.taughtLatch,
  };
}

function clockText(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function paintHearts(el: HTMLElement | null, hp: number, max: number): void {
  if (!el || max <= 0) return;
  const filled = Math.max(0, Math.min(5, Math.round((hp / max) * 5)));
  const sig = String(filled);
  if (el.dataset.sig === sig && el.childElementCount === 5) return;
  el.dataset.sig = sig;
  el.replaceChildren(
    ...Array.from({ length: 5 }, (_, i) => {
      const heart = document.createElement("span");
      heart.className = i < filled ? "heart is-on" : "heart";
      heart.innerHTML =
        '<svg viewBox="0 0 20 18" width="14" height="12" aria-hidden="true"><path fill="currentColor" d="M10 16.2 2.4 8.6A4.2 4.2 0 0 1 10 4.2 4.2 4.2 0 0 1 17.6 8.6Z"/></svg>';
      return heart;
    }),
  );
}

function paintJournal(el: HTMLElement | null, heard: string[]): void {
  if (!el) return;
  const sig = heard.join("|");
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.replaceChildren(
    ...heard.map((id) => {
      const tell = TELLS.find((t) => t.id === id);
      const p = document.createElement("p");
      p.className = "whisper-line";
      p.textContent = tell?.title ?? id;
      return p;
    }),
  );
}

function paintChecklist(el: HTMLElement | null, rows: { label: string; done: boolean }[]): void {
  if (!el) return;
  const sig = rows.map((r) => `${r.done ? "1" : "0"}${r.label}`).join("|");
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.classList.remove("hunt-pulse");
  void el.offsetWidth;
  el.classList.add("hunt-pulse");
  el.replaceChildren(
    ...rows.map((row) => {
      const line = document.createElement("div");
      line.className = row.done ? "hunt-row is-done" : "hunt-row";
      const box = document.createElement("span");
      box.className = "hunt-box";
      const label = document.createElement("span");
      label.textContent = row.label;
      line.append(box, label);
      return line;
    }),
  );
}
