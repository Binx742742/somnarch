import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { makeFigure, makeLoot, type Figure } from "./figures";
import { groundY, hitsBlock } from "./level";
import { buildSuburb, type SuburbHandle } from "./suburb";
import type { Actor, Pickup, Role, WeaponKind } from "./sim";

function syncHeld(fig: Figure, weapon: WeaponKind | null | undefined): void {
  const prev = fig.group.getObjectByName("held-arm");
  if (!weapon) {
    if (prev) fig.group.remove(prev);
    return;
  }
  if (prev && prev.userData.kind === weapon) return;
  if (prev) fig.group.remove(prev);
  const prop = makeLoot(weapon, true);
  prop.name = "held-arm";
  prop.userData.kind = weapon;
  prop.scale.setScalar(0.8);
  prop.position.set(-0.28, 1.05, 0.2);
  prop.rotation.set(0.5, 0.2, 0.7);
  fig.group.add(prop);
}

export type RenderView = {
  mode: "menu" | "play" | "end";
  camYaw: number;
  camPitch: number;
  targetX: number;
  targetZ: number;
  snap: boolean;
  actors: Actor[];
  pickups: Pickup[];
  viewerId: string;
  viewerRole: Role | null;
  hidden: Set<string>;
  shake: number;
  wards: Array<{ id: string; lit: boolean }>;
  doors: Array<{ id: string; latched: boolean }>;
  focusDoor: string | null;
  snares: Array<{ id: string; x: number; z: number }>;
  marks?: { guide: { x: number; z: number } | null; here: { x: number; z: number } | null };
  bell?: { x: number; z: number; ring: number } | null;
  ambush?: { kind: "gate" | "porch"; x: number; z: number } | null;
};

const COATS = [0x7a3a32, 0x3e4c56, 0x8a7d68, 0x3c3348];

const GradeShader = {
  name: "SomnarchGrade",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGamma: { value: 1.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGamma;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float aberr = 0.0016 * r2;
      float cr = texture2D(tDiffuse, vUv + c * aberr).r;
      float cg = texture2D(tDiffuse, vUv).g;
      float cb = texture2D(tDiffuse, vUv - c * aberr).b;
      vec3 col = vec3(cr, cg, cb);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float shadow = 1.0 - smoothstep(0.02, 0.35, luma);
      col = mix(col, col * vec3(0.55, 0.48, 0.5), shadow * 0.45);
      float high = smoothstep(0.42, 1.15, luma);
      col += vec3(0.05, 0.028, 0.008) * high;
      float vig = smoothstep(0.58, 0.16, r2);
      col *= mix(0.78, 1.0, vig);
      float n = fract(sin(dot(vUv * vec2(210.0, 93.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.02;
      float mote = fract(sin(dot(vUv * vec2(40.0, 17.0) + uTime * 0.15, vec2(41.2, 19.7))) * 12543.1);
      col += vec3(0.045, 0.032, 0.018) * smoothstep(0.992, 1.0, mote);
      float g = max(uGamma, 0.45);
      col = pow(max(col, 0.0), vec3(1.0 / g));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class DreamRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.08, 260);
  private readonly composer: EffectComposer | null;
  private readonly grade: ShaderPass | null;
  private readonly actorRoot = new THREE.Group();
  private readonly pickupRoot = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private readonly loots = new Map<string, THREE.Object3D>();
  private readonly suburb: SuburbHandle;
  private readonly ash: THREE.BufferGeometry;
  private readonly monsterLight: THREE.PointLight;
  private readonly high: boolean;
  private moon: THREE.DirectionalLight | null = null;
  private orbit = 0.4;
  private time = 0;
  private shake = 0;
  private readonly snareRoot = new THREE.Group();
  private readonly snareMeshes: THREE.Mesh[] = [];
  private readonly look = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();
  private readonly guide: THREE.Mesh;
  private readonly here: THREE.Mesh;
  private readonly bell: THREE.Group;
  private gamma = 1.35;
  private readonly baseExposure: number;
  private readonly baseFog: number;

  constructor(canvas: HTMLCanvasElement) {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.high = !coarse && window.innerWidth >= 900;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.high,
      powerPreference: "high-performance",
      alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.baseExposure = this.high ? 0.94 : 1.05;
    renderer.toneMappingExposure = this.baseExposure;
    renderer.setClearColor(0x07060c, 1);
    renderer.shadowMap.enabled = this.high;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.scene.background = new THREE.Color(0x07060c);
    this.baseFog = this.high ? 0.0072 : 0.0094;
    this.scene.fog = new THREE.FogExp2(0x1a222c, this.baseFog);

    this.buildLights();
    this.suburb = buildSuburb(this.scene, renderer, this.high);
    this.ash = this.buildAsh();
    this.scene.add(this.actorRoot);
    this.scene.add(this.pickupRoot);
    this.scene.add(this.snareRoot);
    this.guide = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.22, 6.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xe4d3b0, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.here = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.045, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0xffb46a }),
    );
    this.here.rotation.x = Math.PI / 2;
    this.bell = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.7 }),
    );
    post.position.y = 1.1;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffb46a, emissive: 0xffb46a, emissiveIntensity: 0.8, roughness: 0.35 }),
    );
    head.position.y = 2.6;
    head.scale.setScalar(1.8);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.42, 18, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb46a, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    shaft.position.y = 9;
    const pad = new THREE.Mesh(
      new THREE.TorusGeometry(3.4, 0.08, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xffb46a, transparent: true, opacity: 0.9 }),
    );
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.15;
    this.bell.add(post, head, shaft, pad);
    this.scene.add(this.guide, this.here, this.bell);
    this.buildShowcase();

    this.monsterLight = new THREE.PointLight(0xff3b2a, 0, 11, 2);
    this.scene.add(this.monsterLight);

    if (this.high) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(320, 180), 0.58, 0.46, 0.74);
      composer.addPass(bloomPass);
      const grade = new ShaderPass(GradeShader);
      this.grade = grade;
      composer.addPass(grade);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } else {
      this.composer = null;
      this.grade = null;
    }
    this.setGamma(1.5);
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 800 ? 1 : this.high ? 1.25 : 1.1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
  }

  render(dt: number, view: RenderView): void {
    this.time += dt;
    this.orbit += dt * (view.mode === "menu" ? 0.1 : 0.035);
    this.shake = Math.max(0, this.shake * Math.exp(-3.5 * dt) + view.shake);
    this.placeCamera(dt, view);
    this.suburb.windowMat.uniforms.uTime!.value = this.time;
    if (this.grade) this.grade.uniforms.uTime!.value = this.time;
    for (const hand of this.suburb.clockHands) hand.rotation.z += dt * (hand.userData.fast ? 1.15 : 0.22);
    this.suburb.altarLight.intensity = 18 + Math.sin(this.orbit * 2.4) * 3.5;
    const porch = view.ambush?.kind === "porch" ? view.ambush : null;
    this.suburb.lampLights.forEach((light, i) => {
      let intensity = (this.high ? 28 : 14) * (0.88 + Math.sin(this.time * 1.7 + i * 1.3) * 0.1);
      if (porch && Math.hypot(light.position.x - porch.x, light.position.z - porch.z) < 3.2) intensity *= 0.08;
      light.intensity = intensity;
    });
    this.syncMarks(view);
    this.driftAsh(dt);
    this.followMoon(view);
    this.syncActors(dt, view);
    this.syncPickups(view);
    this.syncWards(view);
    this.syncDoors(view);
    this.syncSnares(view);
    this.suburb.porchLights.forEach((light, i) => {
      light.intensity = 12 * (0.84 + Math.sin(this.time * 2.2 + i * 1.7) * 0.16);
    });
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; visible: boolean } {
    this.proj.set(x, y, z);
    this.proj.project(this.camera);
    return {
      x: (this.proj.x * 0.5 + 0.5) * width,
      y: (-this.proj.y * 0.5 + 0.5) * height,
      visible: this.proj.z < 1 && this.proj.z > -1,
    };
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    for (const tex of this.suburb.textures) tex.dispose();
    this.suburb.environment?.dispose();
    this.ash.dispose();
  }

  setGamma(value: number): void {
    this.gamma = Math.max(0.75, Math.min(1.7, value));
    this.renderer.toneMappingExposure = this.baseExposure * (0.7 + this.gamma * 0.5);
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) fog.density = this.baseFog / (0.8 + this.gamma * 0.28);
    if (this.grade?.uniforms.uGamma) this.grade.uniforms.uGamma.value = this.gamma;
  }

  setDolls(visible: boolean): void {
    const list = this.scene.userData.showcase as THREE.Object3D[] | undefined;
    if (!list) return;
    for (const obj of list) obj.visible = visible;
  }

  private placeCamera(dt: number, view: RenderView): void {
    let yaw = view.camYaw;
    let pitch = THREE.MathUtils.clamp(view.camPitch, 0.28, 1.08);
    let tx = view.targetX;
    let tz = view.targetZ;
    const play = view.mode === "play";
    const slasher = view.viewerRole === "somnarch";
    let dist = slasher ? 3.28 : 3.62;
    let shoulder = slasher ? 1.08 : 0.84;
    if (!play) {
      yaw = this.orbit;
      pitch = view.mode === "end" ? 0.86 : 0.58;
      dist = view.mode === "end" ? 34 : 32;
      shoulder = 0;
      tx = 0;
      tz = 2;
    }
    const fov = play ? 50 : 46;
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const gy = groundY(tx, tz);
    const horiz = dist * Math.cos(pitch);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    let cx = tx - fx * horiz + rx * shoulder;
    let cz = tz - fz * horiz + rz * shoulder;
    const cy = Math.max(0.7, (play ? 1.62 : 1.45) + dist * Math.sin(pitch)) + gy;
    if (play) {
      const clamped = pullIn(tx, tz, cx, cz);
      cx = clamped.x;
      cz = clamped.z;
    }
    if (view.snap) {
      this.camera.position.set(cx, cy, cz);
    } else {
      const k = 1 - Math.exp(-7 * dt);
      this.camera.position.x += (cx - this.camera.position.x) * k;
      this.camera.position.y += (cy - this.camera.position.y) * k;
      this.camera.position.z += (cz - this.camera.position.z) * k;
    }
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    const lookAhead = play ? 1.65 : 0;
    this.look.set(tx + fx * lookAhead, (slasher ? 1.48 : 1.32) + gy, tz + fz * lookAhead);
    this.camera.lookAt(this.look);
  }

  private syncActors(dt: number, view: RenderView): void {
    const seen = new Set<string>();
    let mon: Actor | undefined;
    for (const actor of view.actors) {
      seen.add(actor.id);
      let fig = this.figures.get(actor.id);
      if (!fig) {
        const coat = actor.role === "somnarch" ? 0x3a2826 : COATS[this.figures.size % COATS.length]!;
        fig = makeFigure(coat, actor.role === "somnarch", this.figures.size);
        this.actorRoot.add(fig.group);
        this.figures.set(actor.id, fig);
      }
      const local = actor.id === view.viewerId;
      const g = fig.group;
      if (local || !fig.born) {
        g.position.x = actor.x;
        g.position.z = actor.z;
        g.rotation.y = actor.yaw + Math.PI;
        fig.born = true;
      } else {
        const k = 1 - Math.exp(-10 * dt);
        g.position.x += (actor.x - g.position.x) * k;
        g.position.z += (actor.z - g.position.z) * k;
        const targetYaw = actor.yaw + Math.PI;
        const dy = Math.atan2(Math.sin(targetYaw - g.rotation.y), Math.cos(targetYaw - g.rotation.y));
        g.rotation.y += dy * k;
      }
      const moving = Math.hypot(actor.vx, actor.vz);
      const bob = actor.dead || actor.downed ? 0 : Math.sin(this.time * 8 + fig.seed) * Math.min(0.045, moving * 0.006);
      const lift = groundY(g.position.x, g.position.z);
      const y = lift + (actor.dead ? -1.7 : actor.downed ? -0.7 : bob);
      g.position.y += (y - g.position.y) * (1 - Math.exp(-6 * dt));
      g.rotation.z = actor.downed ? 1.15 : 0;
      g.visible = !(actor.dead && g.position.y < -1.45) && !view.hidden.has(actor.id);
      fig.ring.visible = !actor.dead && (actor.lucid || (actor.markT > 0 && view.viewerRole === "somnarch"));
      const stride = actor.dead || actor.downed ? 0 : Math.min(1, moving * 0.14);
      const phase = this.time * (fig.monster ? 6.2 : 9.2) + fig.seed;
      const amp = fig.monster ? 0.42 : 0.62;
      fig.legL.rotation.x = Math.sin(phase) * amp * stride;
      fig.legR.rotation.x = Math.sin(phase + Math.PI) * amp * stride;
      fig.offArm.rotation.x = -0.2 + Math.sin(phase) * 0.45 * stride;
      const strideArm = Math.sin(phase + Math.PI) * 0.2 * stride * (1 - actor.swing);
      fig.arm.rotation.x = fig.monster
        ? 1.42 - actor.swing * 2.15 + strideArm
        : -0.22 - actor.swing * 1.55 + strideArm;
      const ghost = actor.veilT > 0 && local;
      fig.coat.transparent = ghost;
      fig.coat.opacity = ghost ? 0.42 : 1;
      fig.coat.depthWrite = !ghost;
      fig.coat.emissiveIntensity = ghost ? 0.85 : actor.lucid ? 0.5 : fig.monster ? 0.42 : 0.12;
      if (actor.swing > 0.65) fig.coat.emissive.setHex(0xffe1c4);
      else fig.coat.emissive.setHex(fig.monster ? 0x120606 : actor.lucid ? 0x5a4630 : 0x14080c);
      if (fig.monster && actor.swing <= 0.65) fig.coat.emissiveIntensity = 0.08;
      if (!fig.monster) fig.eyes.color.setHex(actor.lucid ? 0xe4d3b0 : 0x1a1214);
      syncHeld(fig, actor.role === "dreamer" ? actor.weapon : null);
      if (actor.role === "somnarch") {
        mon = actor;
        this.monsterLight.position.set(actor.x, 1.8, actor.z);
      }
    }
    for (const [id, fig] of this.figures) {
      if (!seen.has(id)) {
        this.actorRoot.remove(fig.group);
        this.figures.delete(id);
      }
    }
    const showMon = !!mon && !view.hidden.has(mon.id) && view.mode === "play";
    this.monsterLight.intensity = showMon ? 4.5 : 0;
  }

  private syncPickups(view: RenderView): void {
    const seen = new Set<string>();
    const show = view.mode === "play";
    for (const p of view.pickups) {
      seen.add(p.id);
      let mesh = this.loots.get(p.id);
      if (!mesh || mesh.userData.kind !== p.kind) {
        if (mesh) this.pickupRoot.remove(mesh);
        mesh = makeLoot(p.kind);
        mesh.userData.kind = p.kind;
        this.pickupRoot.add(mesh);
        this.loots.set(p.id, mesh);
      }
      mesh.position.set(p.x, groundY(p.x, p.z), p.z);
      mesh.visible = show && !p.taken;
      mesh.rotation.y += 0.01;
    }
    for (const [id, mesh] of this.loots) {
      if (!seen.has(id)) {
        this.pickupRoot.remove(mesh);
        this.loots.delete(id);
      }
    }
  }

  private driftAsh(dt: number): void {
    const attr = this.ash.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) {
      const y = arr[i] ?? 0;
      arr[i] = y - dt * 0.38;
      if ((arr[i] ?? 0) < 0) arr[i] = 7 + Math.random() * 8;
    }
    attr.needsUpdate = true;
    const pts = this.scene.getObjectByName("ash");
    if (pts) {
      pts.position.x = this.camera.position.x;
      pts.position.z = this.camera.position.z;
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x6a7898, 0x1a0c10, this.high ? 0.22 : 0.48));
    this.scene.add(new THREE.AmbientLight(0x120c12, this.high ? 0.06 : 0.2));
    const moon = new THREE.DirectionalLight(0xb7c8ee, this.high ? 1.28 : 1.7);
    this.moon = moon;
    moon.position.set(28, 48, -18);
    moon.target.position.set(0, 0, 0);
    this.scene.add(moon.target);
    this.scene.add(moon);
    if (this.high) {
      moon.castShadow = true;
      moon.shadow.mapSize.set(1024, 1024);
      moon.shadow.camera.near = 8;
      moon.shadow.camera.far = 130;
      moon.shadow.camera.left = -48;
      moon.shadow.camera.right = 48;
      moon.shadow.camera.top = 48;
      moon.shadow.camera.bottom = -48;
      moon.shadow.bias = -0.0002;
      moon.shadow.normalBias = 0.035;
    }
    const fill = new THREE.DirectionalLight(0xffb090, this.high ? 0.16 : 0.28);
    fill.position.set(-22, 12, 16);
    this.scene.add(fill);
  }

  private buildAsh(): THREE.BufferGeometry {
    const n = this.high ? 520 : 180;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 28;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xe7d7c0,
        size: 0.07,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    pts.name = "ash";
    pts.frustumCulled = false;
    this.scene.add(pts);
    return geo;
  }

  private followMoon(view: RenderView): void {
    if (!this.moon || view.mode !== "play") return;
    const y = groundY(view.targetX, view.targetZ);
    this.moon.target.position.set(view.targetX, y, view.targetZ);
    this.moon.position.set(view.targetX + 28, y + 48, view.targetZ - 18);
  }

  private syncDoors(view: RenderView): void {
    for (const door of this.suburb.doors) {
      const latched = view.doors.some((d) => d.id === door.id && d.latched);
      const closed = view.mode !== "play" || latched;
      const base = door.pivot.userData.yaw as number;
      const target = base - (closed ? 0 : 1.22);
      door.pivot.rotation.y += (target - door.pivot.rotation.y) * 0.28;
      door.latch.visible = closed;
      door.bar.visible = latched;
      const pulse = latched ? 1 + Math.sin(this.time * 7) * 0.16 : 1;
      door.latch.scale.setScalar(pulse);
      const iron = door.latch.material;
      if (iron instanceof THREE.MeshStandardMaterial) {
        iron.emissive.setHex(latched ? 0xff2418 : 0x000000);
        iron.emissiveIntensity = latched ? 2.2 : 0;
      }
      const approached = view.focusDoor === door.id;
      door.rim.visible = approached;
      door.rimMat.color.setHex(latched ? 0xc44536 : 0xf0e6d8);
      door.rimMat.opacity = latched ? 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(this.time * 7)) : 0.92;
      door.rim.scale.setScalar(latched ? pulse : 1);
    }
  }

  private syncMarks(view: RenderView): void {
    const guide = view.mode === "play" ? view.marks?.guide : null;
    const here = view.mode === "play" ? view.marks?.here : null;
    this.guide.visible = !!guide;
    if (guide) {
      const y = groundY(guide.x, guide.z);
      this.guide.position.set(guide.x, y + 3.2, guide.z);
      const mat = this.guide.material;
      if (mat instanceof THREE.MeshBasicMaterial) mat.opacity = 0.38 + Math.sin(this.time * 3) * 0.12;
    }
    this.here.visible = !!here;
    if (here) {
      this.here.position.set(here.x, groundY(here.x, here.z) + 0.08, here.z);
      const pulse = 1 + Math.sin(this.time * 5) * 0.08;
      this.here.scale.setScalar(pulse);
    }
    const bell = view.mode === "play" ? view.bell : null;
    this.bell.visible = !!bell;
    if (bell) {
      this.bell.position.set(bell.x, groundY(bell.x, bell.z), bell.z);
      const ring = bell.ring > 0 ? 1 + Math.sin(this.time * 18) * 0.08 : 1;
      this.bell.scale.setScalar(ring);
    }
  }

  private syncSnares(view: RenderView): void {
    while (this.snareMeshes.length < view.snares.length) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.025, 6, 14),
        new THREE.MeshBasicMaterial({ color: 0xc44536 }),
      );
      mesh.rotation.x = Math.PI / 2;
      this.snareRoot.add(mesh);
      this.snareMeshes.push(mesh);
    }
    this.snareMeshes.forEach((mesh, i) => {
      const snare = view.snares[i];
      mesh.visible = !!snare && view.mode === "play";
      if (!snare) return;
      mesh.position.set(snare.x, groundY(snare.x, snare.z) + 0.06, snare.z);
    });
  }

  private syncWards(view: RenderView): void {
    for (const ward of this.suburb.wards) {
      const lit = view.wards.some((w) => w.id === ward.id && w.lit);
      ward.mat.emissive.setHex(lit ? 0xffb060 : 0x4a180e);
      ward.mat.emissiveIntensity = lit ? 2.4 : 0.35;
      if (ward.light) ward.light.intensity = lit ? 12 : 0.35;
    }
  }

  private buildShowcase(): void {
    const dreamer = makeFigure(COATS[0]!, false, 0);
    dreamer.group.position.set(-2.4, 0, 5.4);
    dreamer.group.rotation.y = Math.PI + 0.5;
    const mon = makeFigure(0x3a2826, true, 1);
    mon.group.position.set(2.6, 0, 9.2);
    mon.group.rotation.y = Math.PI + 0.15;
    this.scene.add(dreamer.group, mon.group);
    this.scene.userData.showcase = [dreamer.group, mon.group];
  }
}

function pullIn(px: number, pz: number, cx: number, cz: number): { x: number; z: number } {
  const steps = 10;
  let lx = px;
  let lz = pz;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = px + (cx - px) * t;
    const z = pz + (cz - pz) * t;
    if (hitsBlock(x, z, 0.2)) return { x: lx, z: lz };
    lx = x;
    lz = z;
  }
  return { x: cx, z: cz };
}

/** Hide the menu mannequins once a real match is on the cul-de-sac. */
export function setShowcase(rendererScene: THREE.Scene, visible: boolean): void {
  const list = rendererScene.userData.showcase as THREE.Object3D[] | undefined;
  if (!list) return;
  for (const obj of list) obj.visible = visible;
}
