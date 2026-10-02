import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BLOCKS, BOUNDARY, LAMPS, type Block } from "./level";
import type { Actor, Pickup, Role } from "./sim";

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
};

type Figure = {
  group: THREE.Group;
  arm: THREE.Object3D;
  ring: THREE.Mesh;
  coat: THREE.MeshStandardMaterial;
  born: boolean;
  monster: boolean;
};

const COATS = [0x7a3a32, 0x3e4c56, 0x8a7d68, 0x3c3348];

export class DreamRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 240);
  private readonly composer: EffectComposer | null;
  private readonly actorRoot = new THREE.Group();
  private readonly pickupRoot = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private readonly loots = new Map<string, THREE.Object3D>();
  private readonly clockHands: THREE.Object3D[] = [];
  private readonly windows: { mat: THREE.MeshStandardMaterial; phase: number }[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly ash: THREE.BufferGeometry;
  private readonly monsterLight: THREE.PointLight;
  private readonly altarLight: THREE.PointLight;
  private orbit = 0.4;
  private shake = 0;
  private readonly look = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();
  private bloom = false;

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x07060a, 1);
    this.renderer = renderer;
    this.scene.background = new THREE.Color(0x10080e);
    this.scene.fog = new THREE.FogExp2(0x140c12, 0.027);

    this.buildLights();
    this.buildSky();
    this.buildGround();
    this.buildHouses();
    this.buildTrees();
    this.buildAltar();
    this.buildFloaters();
    this.ash = this.buildAsh();
    this.scene.add(this.actorRoot);
    this.scene.add(this.pickupRoot);
    this.buildShowcase();

    this.monsterLight = new THREE.PointLight(0xff3b2a, 0, 9, 2);
    this.scene.add(this.monsterLight);
    this.altarLight = new THREE.PointLight(0xffc890, 18, 18, 2);
    this.altarLight.position.set(0, 2.4, 0);
    this.scene.add(this.altarLight);

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.bloom = !coarse && window.innerWidth >= 900;
    if (this.bloom) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(320, 180), 0.38, 0.55, 0.84);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } else {
      this.composer = null;
    }
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 800 ? 1.25 : 1.7);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
  }

  render(dt: number, view: RenderView): void {
    this.orbit += dt * (view.mode === "menu" ? 0.12 : 0.04);
    this.shake = Math.max(0, this.shake * Math.exp(-3.5 * dt) + view.shake);
    this.placeCamera(dt, view);
    this.flicker(dt);
    this.driftAsh(dt);
    for (const hand of this.clockHands) hand.rotation.z += dt * (hand.userData.fast ? 1.4 : 0.28);
    this.altarLight.intensity = 14 + Math.sin(this.orbit * 3) * 3;
    this.syncActors(dt, view);
    this.syncPickups(view);
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
    for (const d of this.disposables) d.dispose();
  }

  private placeCamera(dt: number, view: RenderView): void {
    let yaw = view.camYaw;
    let pitch = THREE.MathUtils.clamp(view.camPitch, 0.28, 1.08);
    let tx = view.targetX;
    let tz = view.targetZ;
    let dist = view.viewerRole === "somnarch" ? 6.5 : 5.15;
    if (view.mode === "menu" || view.mode === "end") {
      yaw = this.orbit;
      pitch = view.mode === "end" ? 0.92 : 0.66;
      dist = view.mode === "end" ? 24 : 20;
      tx = 0;
      tz = 0;
    }
    const horiz = dist * Math.cos(pitch);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let cx = tx - fx * horiz;
    let cz = tz - fz * horiz;
    const cy = Math.max(0.45, 1.35 + dist * Math.sin(pitch));
    if (view.mode === "play") {
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
    this.look.set(tx, 1.28, tz);
    this.camera.lookAt(this.look);
  }

  private syncActors(dt: number, view: RenderView): void {
    const seen = new Set<string>();
    let mon: Actor | undefined;
    for (const actor of view.actors) {
      seen.add(actor.id);
      let fig = this.figures.get(actor.id);
      if (!fig) {
        const coat = actor.role === "somnarch" ? 0x2a1614 : COATS[this.figures.size % COATS.length]!;
        fig = makeFigure(coat, actor.role === "somnarch");
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
      const bob = actor.dead || actor.downed ? 0 : Math.sin(performance.now() * 0.008 + actor.x) * Math.min(0.06, moving * 0.008);
      const y = actor.dead ? -1.55 : actor.downed ? -0.62 : bob;
      g.position.y += (y - g.position.y) * (1 - Math.exp(-6 * dt));
      g.rotation.z = actor.downed ? 0.9 : 0;
      g.visible = !(actor.dead && g.position.y < -1.35) && !view.hidden.has(actor.id);
      fig.ring.visible = actor.lucid && !actor.dead;
      fig.arm.rotation.x = -0.15 - actor.swing * 1.45;
      fig.coat.emissiveIntensity = actor.lucid ? 0.55 : fig.monster ? 0.4 : 0.16;
      if (actor.swing > 0.65) fig.coat.emissive.setHex(0xffe1c4);
      else fig.coat.emissive.setHex(fig.monster ? 0x3a0c08 : actor.lucid ? 0x5a4630 : 0x14080c);
      if (actor.role === "somnarch") {
        mon = actor;
        this.monsterLight.position.set(actor.x, 1.6, actor.z);
      }
    }
    for (const [id, fig] of this.figures) {
      if (!seen.has(id)) {
        this.actorRoot.remove(fig.group);
        this.figures.delete(id);
      }
    }
    const showMon = !!mon && !view.hidden.has(mon.id) && view.mode === "play";
    this.monsterLight.intensity = showMon ? 14 : 0;
  }

  private syncPickups(view: RenderView): void {
    const seen = new Set<string>();
    const show = view.mode === "play";
    for (const p of view.pickups) {
      seen.add(p.id);
      let mesh = this.loots.get(p.id);
      if (!mesh) {
        mesh = makeLoot(p.kind);
        this.pickupRoot.add(mesh);
        this.loots.set(p.id, mesh);
      }
      mesh.position.set(p.x, 0, p.z);
      mesh.visible = show && !p.taken;
      mesh.rotation.y += 0.01;
    }
  }

  private flicker(dt: number): void {
    const t = performance.now() * 0.001;
    for (const w of this.windows) {
      const n = 0.65 + Math.sin(t * (1.5 + w.phase) + w.phase * 6) * 0.25;
      w.mat.emissiveIntensity = 1.7 + n + (Math.sin(t * 13 + w.phase) > 0.92 ? 0.8 : 0);
    }
    void dt;
  }

  private driftAsh(dt: number): void {
    const attr = this.ash.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) {
      const y = arr[i] ?? 0;
      arr[i] = y - dt * 0.45;
      if ((arr[i] ?? 0) < 0) arr[i] = 8 + Math.random() * 6;
    }
    attr.needsUpdate = true;
    const pts = this.scene.getObjectByName("ash");
    if (pts) {
      pts.position.x = this.camera.position.x;
      pts.position.z = this.camera.position.z;
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xc8bdd4, 0x2a1214, 0.95));
    this.scene.add(new THREE.AmbientLight(0x3a2430, 0.42));
    const moon = new THREE.DirectionalLight(0xd7e0ff, 2.6);
    moon.position.set(26, 40, -20);
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(0xffb088, 0.7);
    fill.position.set(-18, 10, 14);
    this.scene.add(fill);
  }

  private buildSky(): void {
    const geo = new THREE.SphereGeometry(190, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vDir = position;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.55 + 0.15, 0.0, 1.0);
          vec3 top = vec3(0.025, 0.018, 0.04);
          vec3 hor = vec3(0.22, 0.09, 0.1);
          vec3 col = mix(hor, top, smoothstep(0.0, 0.7, h));
          float moon = pow(max(dot(dir, normalize(vec3(0.42, 0.72, -0.38))), 0.0), 32.0);
          col += vec3(0.9, 0.82, 0.66) * moon;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xf0e2c4 }),
    );
    moon.position.set(32, 46, -28);
    this.scene.add(moon);
  }

  private buildGround(): void {
    const geo = new THREE.CircleGeometry(BOUNDARY + 8, 72);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: `
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz;
          float r = length(p);
          float ang = atan(p.y, p.x);
          float vein = sin(r * 0.55 - ang * 3.0) * 0.5 + 0.5;
          vec3 ink = vec3(0.035, 0.028, 0.032);
          vec3 rust = vec3(0.28, 0.08, 0.07);
          vec3 bone = vec3(0.42, 0.34, 0.22);
          vec3 col = mix(ink, rust, smoothstep(0.55, 0.92, vein) * 0.55);
          float road = smoothstep(1.6, 0.2, abs(r - 15.0));
          col = mix(col, vec3(0.02, 0.016, 0.018), road * 0.75);
          float chk = abs(step(0.0, sin(p.x * 1.5)) - step(0.0, sin(p.y * 1.5)));
          float altar = smoothstep(9.0, 1.2, r);
          col = mix(col, vec3(0.45, 0.1, 0.1), chk * altar * 0.55);
          col = mix(col, bone, smoothstep(4.0, 0.4, r) * 0.35);
          float edge = smoothstep(32.0, 40.0, r);
          col = mix(col, vec3(0.05, 0.02, 0.03), edge);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    const tick = () => {
      mat.uniforms.uTime!.value = performance.now() * 0.001;
    };
    mesh.onBeforeRender = tick;
  }

  private buildHouses(): void {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x120c10, roughness: 0.9, metalness: 0.05 });
    for (const block of BLOCKS) {
      const wall = new THREE.MeshStandardMaterial({
        color: wallColor(block.kind),
        roughness: 0.88,
        metalness: 0.06,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(block.w, block.h, block.d), wall);
      body.position.set(block.x, block.h * 0.5, block.z);
      this.scene.add(body);
      const roofH = block.kind === "chapel" ? 3.4 : block.kind === "boiler" ? 0.8 : 1.45;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(block.w, block.d) * 0.62, roofH, 4),
        roofMat,
      );
      roof.position.set(block.x, block.h + roofH * 0.5, block.z);
      roof.rotation.y = Math.PI / 4;
      this.scene.add(roof);
      if (block.kind === "chapel") {
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 4.2, 6), roofMat);
        spire.position.set(block.x, block.h + roofH + 2, block.z);
        this.scene.add(spire);
      }
      if (block.kind === "boiler") {
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.7, 5.5, 8),
          new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.7, metalness: 0.25 }),
        );
        stack.position.set(block.x + 3.2, block.h + 2.4, block.z + 1);
        this.scene.add(stack);
        const maw = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 1.6, 0.3),
          this.windowMat(0xff5a32, 2.4),
        );
        const face = streetPoint(block);
        maw.position.set(face.x, 1.3, face.z);
        maw.lookAt(block.x, 1.3, block.z);
        this.scene.add(maw);
      }
      const face = streetPoint(block);
      const count = block.kind === "school" ? 5 : 3;
      for (let i = 0; i < count; i++) {
        const along = (i - (count - 1) / 2) * 1.35;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.12), this.windowMat(0xffc48a, 1.8));
        const px = -face.nz * along;
        const pz = face.nx * along;
        win.position.set(face.x + px, 1.6 + (i % 2) * 0.15, face.z + pz);
        win.lookAt(block.x, 1.6, block.z);
        this.scene.add(win);
      }
    }
    for (const [x, z] of LAMPS) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.6, metalness: 0.4 }),
      );
      pole.position.set(x, 1.6, z);
      this.scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), this.windowMat(0xffe1b0, 2.2));
      bulb.position.set(x, 3.25, z);
      this.scene.add(bulb);
    }
  }

  private windowMat(color: number, intensity: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a0e0a,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.35,
    });
    this.windows.push({ mat, phase: Math.random() * 6 });
    return mat;
  }

  private buildTrees(): void {
    const bark = new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x241018, roughness: 0.9 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 33.2;
      const z = Math.sin(a) * 33.2;
      if (BLOCKS.some((b) => Math.abs(x - b.x) < b.w && Math.abs(z - b.z) < b.d)) continue;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 5), bark);
      trunk.position.set(x, 1.2, z);
      trunk.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.08;
      this.scene.add(trunk);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 5), leaf);
      top.position.set(x, 2.8, z);
      this.scene.add(top);
    }
  }

  private buildAltar(): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.75, metalness: 0.08 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.12, 8, 28), stone);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    this.scene.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.4, 0.28), stone);
      p.position.set(Math.cos(a) * 1.6, 1.2, Math.sin(a) * 1.6);
      this.scene.add(p);
    }
    const clock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.18, 20),
      new THREE.MeshStandardMaterial({
        color: 0x1a120e,
        emissive: 0xc44536,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    clock.rotation.x = Math.PI / 2;
    clock.position.y = 2.5;
    this.scene.add(clock);
    const handMat = new THREE.MeshBasicMaterial({ color: 0xf0e6d8 });
    for (const fast of [false, true]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 2.5, 0.2);
      const hand = new THREE.Mesh(
        new THREE.BoxGeometry(fast ? 0.04 : 0.07, fast ? 0.28 : 0.42, 0.03),
        handMat,
      );
      hand.position.y = fast ? 0.14 : 0.2;
      pivot.add(hand);
      pivot.userData.fast = fast;
      this.clockHands.push(pivot);
      this.scene.add(pivot);
    }
  }

  setDolls(visible: boolean): void {
    const list = this.scene.userData.showcase as THREE.Object3D[] | undefined;
    if (!list) return;
    for (const obj of list) obj.visible = visible;
  }

  private buildFloaters(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3428, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6e3030, roughness: 0.7 });
    const specs = [
      { x: -6, z: 10, y: 2.2 },
      { x: 8, z: -7, y: 2.6 },
      { x: -4, z: -8, y: 1.8 },
      { x: 6, z: 9, y: 3.1 },
    ];
    specs.forEach((s, i) => {
      const g = new THREE.Group();
      if (i % 2 === 0) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.8), wood);
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.7), cloth);
        sheet.position.y = 0.12;
        g.add(bed, sheet);
      } else {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.08), wood);
        g.add(door);
      }
      g.position.set(s.x, s.y, s.z);
      g.userData.base = s.y;
      g.userData.phase = i;
      this.scene.add(g);
      const orig = g.onBeforeRender;
      g.onBeforeRender = () => {
        const t = performance.now() * 0.001;
        g.position.y = s.y + Math.sin(t * 0.7 + i) * 0.35;
        g.rotation.y = t * 0.25 + i;
        void orig;
      };
    });
  }

  private buildAsh(): THREE.BufferGeometry {
    const n = 260;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 36;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xd9cbb6,
        size: 0.07,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    pts.name = "ash";
    this.scene.add(pts);
    return geo;
  }

  private buildShowcase(): void {
    const dreamer = makeFigure(COATS[0]!, false);
    dreamer.group.position.set(-2.2, 0, 4.2);
    dreamer.group.rotation.y = Math.PI + 0.4;
    const mon = makeFigure(0x2a1614, true);
    mon.group.position.set(2.4, 0, 8.5);
    mon.group.rotation.y = Math.PI;
    this.scene.add(dreamer.group, mon.group);
    this.scene.userData.showcase = [dreamer.group, mon.group];
  }
}

function wallColor(kind: string): number {
  switch (kind) {
    case "boiler":
      return 0x16100e;
    case "chapel":
      return 0x221c24;
    case "nursery":
      return 0x2a2422;
    case "diner":
      return 0x2a1614;
    case "school":
      return 0x1e1c22;
    case "manor":
      return 0x1a1618;
    default:
      return 0x241c18;
  }
}

function streetPoint(b: Block): { x: number; z: number; nx: number; nz: number } {
  let nx = -b.x;
  let nz = -b.z;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  const tx = Math.abs(nx) > 0.001 ? (b.w * 0.5) / Math.abs(nx) : 1e9;
  const tz = Math.abs(nz) > 0.001 ? (b.d * 0.5) / Math.abs(nz) : 1e9;
  const t = Math.min(tx, tz);
  return { x: b.x + nx * (t + 0.08), z: b.z + nz * (t + 0.08), nx, nz };
}

function pullIn(px: number, pz: number, cx: number, cz: number): { x: number; z: number } {
  const steps = 10;
  let lx = px;
  let lz = pz;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = px + (cx - px) * t;
    const z = pz + (cz - pz) * t;
    if (BLOCKS.some((b) => Math.abs(x - b.x) <= b.w * 0.5 + 0.25 && Math.abs(z - b.z) <= b.d * 0.5 + 0.25)) {
      return { x: lx, z: lz };
    }
    lx = x;
    lz = z;
  }
  return { x: cx, z: cz };
}

function makeFigure(coatHex: number, monster: boolean): Figure {
  const group = new THREE.Group();
  if (monster) group.scale.setScalar(1.24);
  const coat = new THREE.MeshStandardMaterial({
    color: coatHex,
    roughness: 0.72,
    metalness: 0.08,
    emissive: monster ? 0x3a0c08 : 0x14080c,
    emissiveIntensity: monster ? 0.4 : 0.16,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: monster ? 0x5a3028 : 0xcbb59a,
    roughness: 0.62,
    emissive: monster ? 0x2a0806 : 0x000000,
    emissiveIntensity: 0.25,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(monster ? 0.38 : 0.3, monster ? 0.46 : 0.34, monster ? 1.25 : 0.92, 8), coat);
  body.position.y = monster ? 1.35 : 1.15;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.28 : 0.21, 12, 10), skin);
  head.position.y = monster ? 2.2 : 1.82;
  group.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: monster ? 0xffe7b8 : 0x1a1214 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.045 : 0.03, 8, 8), eyeMat);
    e.position.set(s * 0.09, head.position.y + 0.02, 0.18);
    group.add(e);
  }
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, monster ? 1.15 : 0.7, 6),
    skin,
  );
  arm.position.set(monster ? 0.55 : 0.42, monster ? 1.4 : 1.25, 0.05);
  arm.rotation.z = -0.2;
  if (monster) {
    const needle = new THREE.MeshStandardMaterial({
      color: 0xf2e6d0,
      emissive: 0xff4a32,
      emissiveIntensity: 2,
      metalness: 0.4,
      roughness: 0.25,
    });
    for (let i = 0; i < 4; i++) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.46, 5), needle);
      n.rotation.x = -Math.PI / 2;
      n.position.set((i - 1.5) * 0.07, -0.62, 0.18);
      arm.add(n);
    }
  }
  group.add(arm);
  const armL = arm.clone();
  armL.position.x *= -1;
  armL.rotation.z = 0.2;
  group.add(armL);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.72, 6), coat);
    leg.position.set(s * 0.16, 0.36, 0);
    group.add(leg);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.025, 6, 22),
    new THREE.MeshBasicMaterial({ color: 0xe4d3b0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  ring.visible = false;
  group.add(ring);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(monster ? 0.7 : 0.46, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  group.add(blob);
  return { group, arm, ring, coat, born: false, monster };
}

function makeLoot(kind: string): THREE.Group {
  const g = new THREE.Group();
  const color = kind === "fragment" ? 0xe4d3b0 : kind === "clock" ? 0xc44536 : 0xf0e6d8;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.12, 2.2, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  beam.position.y = 1.1;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(kind === "fragment" ? 0.18 : 0.14, 10, 8), new THREE.MeshBasicMaterial({ color }));
  orb.position.y = 0.45;
  g.add(beam, orb);
  return g;
}

/** Hide the menu mannequins once a real match is on the cul-de-sac. */
export function setShowcase(rendererScene: THREE.Scene, visible: boolean): void {
  const list = rendererScene.userData.showcase as THREE.Object3D[] | undefined;
  if (!list) return;
  for (const obj of list) obj.visible = visible;
}
