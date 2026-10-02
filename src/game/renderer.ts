import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { makeFigure, makeLoot, type Figure } from "./figures";
import { BLOCKS, type Block } from "./level";
import { buildSuburb, type SuburbHandle } from "./suburb";
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

const COATS = [0x7a3a32, 0x3e4c56, 0x8a7d68, 0x3c3348];

const GradeShader = {
  name: "SomnarchGrade",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
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
      col = mix(col, col * vec3(1.08, 0.78, 0.86) + vec3(0.012, 0.003, 0.006), shadow * 0.55);
      float high = smoothstep(0.35, 1.3, luma);
      col += vec3(0.035, 0.02, 0.008) * high;
      float vig = smoothstep(0.62, 0.18, r2);
      col *= mix(0.82, 1.0, vig);
      float n = fract(sin(dot(vUv * vec2(210.0, 93.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.018;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
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
  private orbit = 0.4;
  private time = 0;
  private shake = 0;
  private readonly look = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();

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
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x100a10, 1);
    renderer.shadowMap.enabled = this.high;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.scene.background = new THREE.Color(0x100a10);
    this.scene.fog = new THREE.FogExp2(0x120c12, this.high ? 0.0165 : 0.02);

    this.buildLights();
    this.suburb = buildSuburb(this.scene, renderer, this.high);
    this.ash = this.buildAsh();
    this.scene.add(this.actorRoot);
    this.scene.add(this.pickupRoot);
    this.buildShowcase();

    this.monsterLight = new THREE.PointLight(0xff3b2a, 0, 11, 2);
    this.scene.add(this.monsterLight);

    if (this.high) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(320, 180), 0.42, 0.38, 0.92);
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
    this.suburb.lampLights.forEach((light, i) => {
      light.intensity = (this.high ? 16 : 10) * (0.9 + Math.sin(this.time * 1.7 + i * 1.3) * 0.08);
    });
    this.driftAsh(dt);
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
    for (const tex of this.suburb.textures) tex.dispose();
    this.suburb.environment?.dispose();
    this.ash.dispose();
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
    let dist = view.viewerRole === "somnarch" ? 7.1 : 5.35;
    if (view.mode === "menu" || view.mode === "end") {
      yaw = this.orbit;
      pitch = view.mode === "end" ? 0.86 : 0.62;
      dist = view.mode === "end" ? 26 : 22;
      tx = 0;
      tz = 2;
    }
    const horiz = dist * Math.cos(pitch);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let cx = tx - fx * horiz;
    let cz = tz - fz * horiz;
    const cy = Math.max(0.55, 1.45 + dist * Math.sin(pitch));
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
    this.look.set(tx, view.viewerRole === "somnarch" ? 1.55 : 1.25, tz);
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
      const y = actor.dead ? -1.7 : actor.downed ? -0.7 : bob;
      g.position.y += (y - g.position.y) * (1 - Math.exp(-6 * dt));
      g.rotation.z = actor.downed ? 1.15 : 0;
      g.visible = !(actor.dead && g.position.y < -1.45) && !view.hidden.has(actor.id);
      fig.ring.visible = actor.lucid && !actor.dead;
      const stride = actor.dead || actor.downed ? 0 : Math.min(1, moving * 0.14);
      const phase = this.time * (fig.monster ? 6.2 : 9.2) + fig.seed;
      const amp = fig.monster ? 0.42 : 0.62;
      fig.legL.rotation.x = Math.sin(phase) * amp * stride;
      fig.legR.rotation.x = Math.sin(phase + Math.PI) * amp * stride;
      fig.offArm.rotation.x = -0.2 + Math.sin(phase) * 0.45 * stride;
      fig.arm.rotation.x = -0.22 - actor.swing * 1.55 + Math.sin(phase + Math.PI) * 0.2 * stride * (1 - actor.swing);
      fig.coat.emissiveIntensity = actor.lucid ? 0.5 : fig.monster ? 0.42 : 0.12;
      if (actor.swing > 0.65) fig.coat.emissive.setHex(0xffe1c4);
      else fig.coat.emissive.setHex(fig.monster ? 0x3a0c08 : actor.lucid ? 0x5a4630 : 0x14080c);
      if (!fig.monster) fig.eyes.color.setHex(actor.lucid ? 0xe4d3b0 : 0x1a1214);
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
    this.monsterLight.intensity = showMon ? 16 : 0;
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
    this.scene.add(new THREE.HemisphereLight(0x8e98b8, 0x2a1216, this.high ? 0.38 : 0.62));
    this.scene.add(new THREE.AmbientLight(0x1a1218, this.high ? 0.14 : 0.28));
    const moon = new THREE.DirectionalLight(0xc9d6ff, this.high ? 2.45 : 2.15);
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
    const fill = new THREE.DirectionalLight(0xffb090, 0.38);
    fill.position.set(-22, 12, 16);
    this.scene.add(fill);
  }

  private buildAsh(): THREE.BufferGeometry {
    const n = this.high ? 380 : 160;
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
        color: 0xd9cbb6,
        size: 0.055,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    pts.name = "ash";
    pts.frustumCulled = false;
    this.scene.add(pts);
    return geo;
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
    if (BLOCKS.some((b) => inside(b, x, z))) return { x: lx, z: lz };
    lx = x;
    lz = z;
  }
  return { x: cx, z: cz };
}

function inside(b: Block, x: number, z: number): boolean {
  return Math.abs(x - b.x) <= b.w * 0.5 + 0.25 && Math.abs(z - b.z) <= b.d * 0.5 + 0.25;
}

/** Hide the menu mannequins once a real match is on the cul-de-sac. */
export function setShowcase(rendererScene: THREE.Scene, visible: boolean): void {
  const list = rendererScene.userData.showcase as THREE.Object3D[] | undefined;
  if (!list) return;
  for (const obj of list) obj.visible = visible;
}
