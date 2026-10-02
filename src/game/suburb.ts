import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BLOCKS, BOUNDARY, CAR_SPOTS, HILL, LAMPS, SHORTCUTS, TELLS, WARD_SPOTS, doorPoses, doorSpots, groundY, hitsBlock, type Block } from "./level";
import { createGround } from "./ground";
import { orient, surfaceAt, type Front } from "./roads";
import { createSuburbTextures, type SuburbTextures } from "./textures";

export type SuburbHandle = {
  windowMat: THREE.ShaderMaterial;
  clockHands: THREE.Object3D[];
  altarLight: THREE.PointLight;
  lampLights: THREE.PointLight[];
  textures: THREE.Texture[];
  environment: THREE.Texture | null;
  wards: Array<{ id: string; light: THREE.PointLight | null; mat: THREE.MeshStandardMaterial }>;
  doors: Array<{ id: string; pivot: THREE.Group; latch: THREE.Mesh; bar: THREE.Object3D; rim: THREE.Group; rimMat: THREE.MeshBasicMaterial }>;
  porchLights: THREE.PointLight[];
};

type Style = {
  wall: "siding" | "brick" | "stone" | "metal";
  tint: number;
  roof: "eave" | "front" | "flat";
  porch: boolean;
  special: "house" | "boiler" | "chapel" | "diner";
  rise: number;
};

const STYLES: Record<string, Style> = {
  boiler: { wall: "brick", tint: 0x4a403c, roof: "flat", porch: false, special: "boiler", rise: 0.35 },
  chapel: { wall: "stone", tint: 0xd2ccd0, roof: "front", porch: false, special: "chapel", rise: 3.4 },
  nursery: { wall: "siding", tint: 0xe4ddcf, roof: "eave", porch: true, special: "house", rise: 1.7 },
  manor: { wall: "brick", tint: 0x8a5b52, roof: "front", porch: true, special: "house", rise: 2.35 },
  diner: { wall: "metal", tint: 0xc5ced6, roof: "flat", porch: false, special: "diner", rise: 0.3 },
  school: { wall: "brick", tint: 0x9a6458, roof: "eave", porch: true, special: "house", rise: 1.55 },
  station: { wall: "siding", tint: 0xd2c2a4, roof: "eave", porch: true, special: "house", rise: 1.35 },
  cottage: { wall: "siding", tint: 0xedd9c0, roof: "front", porch: true, special: "house", rise: 2.15 },
  bungalow: { wall: "siding", tint: 0xd8c8b0, roof: "eave", porch: true, special: "house", rise: 1.6 },
  garage: { wall: "brick", tint: 0x6a5a52, roof: "eave", porch: false, special: "house", rise: 0.85 },
  library: { wall: "stone", tint: 0xc8c4bc, roof: "front", porch: true, special: "house", rise: 2.2 },
  greenhouse: { wall: "metal", tint: 0x9aa89a, roof: "eave", porch: false, special: "house", rise: 0.7 },
  funeral: { wall: "stone", tint: 0xb7b0b4, roof: "front", porch: false, special: "house", rise: 1.85 },
  lodge: { wall: "siding", tint: 0x8a6848, roof: "eave", porch: true, special: "house", rise: 1.9 },
  mill: { wall: "brick", tint: 0x7a5348, roof: "eave", porch: false, special: "house", rise: 1.45 },
  mausoleum: { wall: "stone", tint: 0xd5d0cc, roof: "front", porch: false, special: "house", rise: 1.15 },
  shed: { wall: "siding", tint: 0xc4b49a, roof: "eave", porch: false, special: "house", rise: 1.05 },
  barn: { wall: "siding", tint: 0x8d5a42, roof: "eave", porch: false, special: "house", rise: 1.7 },
  cabin: { wall: "siding", tint: 0xe0c8a8, roof: "front", porch: true, special: "house", rise: 1.85 },
  rectory: { wall: "brick", tint: 0x6e403c, roof: "front", porch: true, special: "house", rise: 2.05 },
  shelter: { wall: "siding", tint: 0xb7a48a, roof: "eave", porch: false, special: "house", rise: 0.8 },
  radio: { wall: "siding", tint: 0xc4b08a, roof: "eave", porch: true, special: "house", rise: 0.55 },
  orchard: { wall: "siding", tint: 0xd8c4a6, roof: "eave", porch: true, special: "house", rise: 1.5 },
  twin: { wall: "siding", tint: 0xead8c4, roof: "front", porch: true, special: "house", rise: 2.1 },
  pump: { wall: "brick", tint: 0x6e564c, roof: "eave", porch: false, special: "house", rise: 0.7 },
};

const WHITE = new THREE.Color(0xffffff);
const CONCRETE = new THREE.Color(0xb7b2aa);
const TAR = new THREE.Color(0x2a2728);
const WOOD = new THREE.Color(0x8a6a52);
const DARK = new THREE.Color(0x2c2826);

class Bucket {
  private readonly map = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry): void {
    const list = this.map.get(mat);
    if (list) list.push(geo);
    else this.map.set(mat, [geo]);
  }

  flush(scene: THREE.Scene, cast: boolean, receive: boolean): void {
    for (const [mat, geos] of this.map) {
      if (geos.length === 0) continue;
      const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      if (geos.length > 1) for (const g of geos) g.dispose();
    }
    this.map.clear();
  }
}

export function buildSuburb(scene: THREE.Scene, renderer: THREE.WebGLRenderer, high: boolean): SuburbHandle {
  const textures = createSuburbTextures();
  const mats = createMaterials(textures);
  const bucket = new Bucket();
  const windows: THREE.BufferGeometry[] = [];
  const clockHands: THREE.Object3D[] = [];

  scene.add(createGround(BOUNDARY + 8));
  buildSky(scene, textures.glow);

  for (const block of BLOCKS) {
    const style = STYLES[block.kind] ?? STYLES.cottage!;
    buildBlock(block, style, mats, bucket, windows);
  }

  buildAltar(scene, mats, bucket, clockHands);
  buildLamps(scene, mats, windows);
  buildTrees(scene, mats, high);
  buildCars(mats, bucket);
  buildProps(mats, bucket, windows);
  buildRoutes(mats, bucket, windows);
  buildWhispers(scene);
  buildFloaters(scene);
  buildSmoke(scene);
  buildHill(scene);

  bucket.flush(scene, true, true);

  const windowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vColor = color;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        float phase = fract(sin(dot(floor(vWorld * vec3(2.7, 1.3, 2.7)), vec3(127.1, 67.3, 311.7))) * 43758.5453);
        float pulse = 0.78 + 0.22 * sin(uTime * (1.1 + phase * 2.2) + phase * 6.2831);
        float blink = smoothstep(0.988, 0.998, sin(uTime * (6.5 + phase * 8.0) + phase * 13.0));
        float dark = smoothstep(0.8, 0.86, phase);
        float lit = mix(pulse + blink * 0.85, 0.04, dark);
        float warm = smoothstep(0.15, 0.85, vColor.r / (vColor.b + 0.05));
        vec3 amber = vec3(vColor.r * 1.28, vColor.g * 0.7, vColor.b * 0.28);
        vec3 col = mix(vColor, amber, warm) * lit;
        float dist = length(vWorld - cameraPosition);
        float fogF = 1.0 - exp(-dist * 0.012);
        col = mix(col, vec3(0.01, 0.006, 0.008), fogF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (windows.length > 0) {
    const merged = windows.length === 1 ? windows[0]! : mergeGeometries(windows, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, windowMat);
      mesh.castShadow = false;
      mesh.name = "windows";
      scene.add(mesh);
      if (windows.length > 1) for (const g of windows) g.dispose();
    }
  }

  const altarLight = new THREE.PointLight(0xffc090, 22, 20, 2);
  altarLight.position.set(0, 2.6, 0);
  scene.add(altarLight);

  const lampLights: THREE.PointLight[] = [];
  const lampIdx = high ? [0, 1, 2, 11, 12, 13] : [0, 1, 2];
  for (const i of lampIdx) {
    const spot = LAMPS[i];
    if (!spot) continue;
    const [x, z] = spot;
    if (hitsBlock(x, z, 0.4)) continue;
    const head = lampHead(x, z);
    const light = new THREE.PointLight(0xffb46a, high ? 30 : 14, 18, 2);
    light.position.set(head[0], 4.2, head[1]);
    scene.add(light);
    lampLights.push(light);
    addLampShaft(scene, head[0], 4.2, head[1]);
  }

  const porchLights: THREE.PointLight[] = [];
  for (const door of doorSpots()) {
    addLampShaft(scene, door.x, groundY(door.x, door.z) + 2.55, door.z, 0.16);
  }
  if (high) {
    for (const door of doorSpots().slice(0, 3)) {
      const light = new THREE.PointLight(0xffb070, 10, 9, 2);
      light.position.set(door.x, groundY(door.x, door.z) + 2.45, door.z);
      scene.add(light);
      porchLights.push(light);
    }
  }
  const doors = buildDoors(scene);

  let environment: THREE.Texture | null = null;
  if (high) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.08;
    pmrem.dispose();
  }

  const wards = buildWards(scene, high);
  return { windowMat, clockHands, altarLight, lampLights, textures: textures.all, environment, wards, doors, porchLights };
}

function createMaterials(tex: SuburbTextures): Record<string, THREE.MeshStandardMaterial> {
  const std = (
    map: THREE.Texture | null,
    roughness: number,
    metalness: number,
    side: THREE.Side = THREE.FrontSide,
    vertexColors = true,
  ): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness,
      metalness,
      vertexColors,
      side,
    });
    if (map) mat.map = map;
    return mat;
  };
  const bark = std(null, 1, 0, THREE.FrontSide, false);
  bark.color.set(0x3a2c2a);
  const leaf = std(null, 0.96, 0, THREE.FrontSide, false);
  leaf.color.set(0xffffff);
  return {
    siding: std(tex.siding, 0.84, 0.02),
    brick: std(tex.brick, 0.92, 0.02),
    stone: std(tex.stone, 0.8, 0.04),
    shingle: std(tex.shingle, 0.9, 0.06, THREE.DoubleSide),
    metal: std(tex.metal, 0.42, 0.62),
    wood: std(tex.wood, 0.78, 0.04),
    concrete: std(tex.concrete, 0.94, 0.02),
    tar: std(null, 0.9, 0.08),
    bark,
    leaf,
    rubber: std(null, 0.9, 0.05),
    paint: std(null, 0.38, 0.48),
    glass: std(null, 0.12, 0.7),
  };
}

function buildShell(
  bucket: Bucket,
  mat: THREE.Material,
  face: Front,
  block: Block,
  h: number,
  tint: THREE.Color,
): void {
  const t = 0.48;
  const door = 1.7;
  const fw = face.width;
  const fd = face.depth;
  const side = Math.max(0.45, (fw - door) * 0.5);
  const y = h * 0.5 + 0.12;
  put(bucket, mat, face, block, side, h, t, -(door * 0.5 + side * 0.5), y, fd * 0.5 - t * 0.5, tint);
  put(bucket, mat, face, block, side, h, t, door * 0.5 + side * 0.5, y, fd * 0.5 - t * 0.5, tint);
  put(bucket, mat, face, block, door, Math.max(0.42, h * 0.2), t, 0, h * 0.88, fd * 0.5 - t * 0.5, tint);
  put(bucket, mat, face, block, fw, h, t, 0, y, -(fd * 0.5 - t * 0.5), tint);
  put(bucket, mat, face, block, t, h, fd, fw * 0.5 - t * 0.5, y, 0, tint);
  put(bucket, mat, face, block, t, h, fd, -(fw * 0.5 - t * 0.5), y, 0, tint);
}

function buildTower(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  windows: THREE.BufferGeometry[],
  block: Block,
): void {
  const y0 = groundY(block.x, block.z);
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const leg = new THREE.CylinderGeometry(0.12, 0.16, 3.4, 5);
    leg.translate(block.x + sx * 1.05, y0 + 1.7, block.z + sz * 1.05);
    bucket.add(mats.metal!, stamp(leg, DARK));
  }
  const tank = new THREE.CylinderGeometry(1.35, 1.35, 2.2, 10);
  tank.translate(block.x, y0 + 4.6, block.z);
  bucket.add(mats.metal!, stamp(tank, new THREE.Color(0x6a6248)));
  const cap = new THREE.ConeGeometry(1.5, 0.85, 10);
  cap.translate(block.x, y0 + 6.05, block.z);
  bucket.add(mats.metal!, stamp(cap, new THREE.Color(0x4a4038)));
  const bulb = new THREE.SphereGeometry(0.18, 8, 6);
  bulb.translate(block.x, y0 + 6.6, block.z);
  windows.push(paintGlow(bulb, 4.2, 0.35, 0.22));
}

function buildHill(scene: THREE.Scene): void {
  const segs = 20;
  const rings = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  positions.push(0, HILL.h, 0);
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * HILL.r;
    const y = (1 - r / rings) ** 2 * HILL.h;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, Math.max(0.04, y), Math.sin(a) * radius);
    }
  }
  const center = 0;
  for (let s = 0; s < segs; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % segs);
    indices.push(center, b, a);
  }
  for (let r = 0; r < rings - 1; r++) {
    const row = 1 + r * segs;
    const next = row + segs;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(row + s, row + s2, next + s);
      indices.push(row + s2, next + s2, next + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c342c, roughness: 0.96, metalness: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(HILL.x, 0.03, HILL.z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "overlook";
  scene.add(mesh);
}

function buildWards(
  scene: THREE.Scene,
  high: boolean,
): Array<{ id: string; light: THREE.PointLight | null; mat: THREE.MeshStandardMaterial }> {
  return WARD_SPOTS.map((w) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a241c,
      emissive: 0x4a180e,
      emissiveIntensity: 0.35,
      roughness: 0.62,
    });
    const y = groundY(w.x, w.z);
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.72, 6), mat);
    stone.position.set(w.x, y + 0.36, w.z);
    stone.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 8), mat);
    bowl.position.set(w.x, y + 0.78, w.z);
    bowl.rotation.x = Math.PI / 2;
    scene.add(stone, bowl);
    let light: THREE.PointLight | null = null;
    if (high) {
      light = new THREE.PointLight(0xffb070, 0.4, 7, 2);
      light.position.set(w.x, y + 1.4, w.z);
      scene.add(light);
    }
    return { id: w.id, light, mat };
  });
}

function buildBlock(
  block: Block,
  style: Style,
  mats: Record<string, THREE.MeshStandardMaterial>,
  bucket: Bucket,
  windows: THREE.BufferGeometry[],
): void {
  const face = orient(block);
  if (block.interior) addDoorBulb(windows, face, block);
  const tint = new THREE.Color(style.tint);
  if (style.wall === "siding") tint.multiplyScalar(0.38);
  const wall = mats[style.wall]!;
  const h = block.h;
  if (block.kind === "tower") {
    buildTower(bucket, mats, windows, block);
    return;
  }
  const two = style.special === "house" && h >= 5.2 && !block.interior;
  const porchD = style.porch && !block.interior ? Math.min(1.28, face.depth * 0.22) : 0;

  put(bucket, mats.concrete!, face, block, face.width + 0.2, 0.2, face.depth + 0.2, 0, 0.1, 0, CONCRETE);

  if (style.special === "boiler") {
    put(bucket, wall, face, block, face.width * 0.96, h - 0.2, face.depth * 0.96, 0, h * 0.5 + 0.05, 0, tint);
    flatRoof(bucket, mats, face, block, h, 0.45);
    addWindowsRow(windows, face, block, face.depth * 0.5 + 0.05, h * 0.72, 1.6, [2.8, 0.55, 0.16], 0.55, 0.7);
    const mawY = 1.45;
    addPane(windows, face, block, 0, mawY, face.depth * 0.5 + 0.06, 2.4, 1.35, 0.08, "street", [6.5, 1.3, 0.25]);
    put(bucket, mats.metal!, face, block, 2.7, 1.55, 0.12, 0, mawY, face.depth * 0.5 + 0.02, DARK);
    stack(bucket, mats.brick!, face, block, face.width * 0.28, 1.2, h, tint);
    stack(bucket, mats.brick!, face, block, -face.width * 0.22, -0.4, h, tint);
    pipe(bucket, mats.metal!, face, block, h * 0.45);
    pipe(bucket, mats.metal!, face, block, h * 0.62);
    return;
  }

  if (style.special === "chapel") {
    if (block.interior) buildShell(bucket, wall, face, block, h, tint);
    else put(bucket, wall, face, block, face.width * 0.92, h, face.depth * 0.9, 0, h * 0.5 + 0.12, -0.15, tint);
    addRoof(bucket, mats.shingle!, face, block, h, style.rise, 0.4, "front", new THREE.Color(0x3a3438));
    addPane(windows, face, block, -0.7, h * 0.48, face.depth * 0.5 + 0.02, 0.55, h * 0.42, 0.08, "street", [3.4, 0.45, 0.55]);
    addPane(windows, face, block, 0.85, h * 0.48, face.depth * 0.5 + 0.02, 0.55, h * 0.42, 0.08, "street", [0.45, 0.7, 3.2]);
    if (!block.interior) {
      put(bucket, mats.wood!, face, block, 1.15, 2.4, 0.12, 0, 1.4, face.depth * 0.5 + 0.02, new THREE.Color(0x2a211c));
    } else {
      put(bucket, mats.wood!, face, block, face.width * 0.7, 0.06, face.depth * 0.7, 0, 0.08, 0, new THREE.Color(0x8a6848));
    }
    steeple(bucket, mats, windows, face, block, h);
    return;
  }

  if (style.special === "diner") {
    if (block.interior) buildShell(bucket, wall, face, block, h - 0.15, tint);
    else put(bucket, wall, face, block, face.width * 0.98, h - 0.15, face.depth * 0.96, 0, (h - 0.15) * 0.5 + 0.12, 0, tint);
    flatRoof(bucket, mats, face, block, h, 0.28);
    const awningY = Math.min(2.55, h * 0.68);
    put(
      bucket,
      mats.paint!,
      face,
      block,
      face.width * 0.72,
      0.08,
      1.35,
      0,
      awningY,
      face.depth * 0.5 + 0.55,
      new THREE.Color(0x8e2e32),
    );
    addWindowsRow(windows, face, block, face.depth * 0.5 + 0.06, awningY * 0.55, 2.4, [0.35, 2.6, 2.4], 1.15, 0.7);
    if (!block.interior) {
      put(bucket, mats.wood!, face, block, 1.05, 2.05, 0.1, 0, 1.2, face.depth * 0.5 + 0.05, new THREE.Color(0x241c18));
    } else {
      put(bucket, mats.wood!, face, block, face.width * 0.7, 0.06, face.depth * 0.7, 0, 0.08, 0, new THREE.Color(0x8a6848));
    }
    neonEat(windows, face, block, h + 0.7);
    return;
  }

  const porchH = two ? 3.08 : Math.min(2.62, h * 0.72);
  const bodyN = -(porchD * 0.5);
  const bodyD = face.depth - porchD;
  if (block.interior) {
    buildShell(bucket, wall, face, block, h * 0.94, tint);
    put(bucket, mats.wood!, face, block, face.width * 0.72, 0.06, face.depth * 0.72, 0, 0.08, 0, new THREE.Color(0x8a6848));
  } else {
    put(bucket, wall, face, block, face.width * 0.98, porchH - 0.16, bodyD, 0, (porchH - 0.16) * 0.5 + 0.16, bodyN, tint);
    if (two) {
      const upper = h - porchH;
      put(bucket, wall, face, block, face.width * 0.98, upper, face.depth * 0.98, 0, porchH + upper * 0.5, 0, tint);
    }
  }
  if (porchD > 0.2) {
    const pierY = (porchH - 0.16) * 0.5 + 0.16;
    const pierN = face.depth * 0.5 - porchD * 0.5;
    for (const s of [-1, 1]) {
      put(bucket, wall, face, block, 0.4, porchH - 0.16, porchD, s * (face.width * 0.5 - 0.28), pierY, pierN, tint);
    }
    put(bucket, mats.wood!, face, block, face.width - 1.05, 0.1, porchD - 0.08, 0, 0.28, pierN, WOOD);
    if (!two) {
      put(bucket, mats.tar!, face, block, face.width * 0.98, 0.1, porchD + 0.2, 0, porchH, pierN, TAR);
    }
    addPane(windows, face, block, 0, porchH - 0.18, pierN, 0.18, 0.1, 0.18, "street", [3.2, 2.1, 1.1]);
    put(bucket, mats.wood!, face, block, 1.02, 2.08, 0.08, 0, 1.22, face.depth * 0.5 - porchD + 0.04, new THREE.Color(0x2a2018));
    put(bucket, mats.concrete!, face, block, 1.15, 0.08, 0.42, 0, 0.2, face.depth * 0.5 - porchD * 0.35, CONCRETE);
  }
  const frontN = porchD > 0.2 ? face.depth * 0.5 - porchD + 0.05 : face.depth * 0.5 + 0.05;
  if (style.wall === "siding") addClapboardTrim(bucket, mats, face, block, h);
  addFacadeWindows(windows, face, block, frontN, porchH, two, h, [3.1, 1.85, 0.72]);
  addSideWindows(windows, face, block, porchD, two, porchH, h);
  if (block.kind === "radio") buildRadioMast(bucket, mats, windows, block);
  addRoof(bucket, mats.shingle!, face, block, h, style.rise, 0.42, style.roof === "front" ? "front" : "eave", new THREE.Color(0x6e666c));
  const ridgeLong = style.roof === "front" ? face.depth : face.width;
  put(
    bucket,
    mats.metal!,
    face,
    block,
    style.roof === "front" ? 0.16 : ridgeLong + 0.55,
    0.1,
    style.roof === "front" ? ridgeLong + 0.55 : 0.16,
    0,
    h + style.rise,
    0,
    new THREE.Color(0x9a9298),
  );
  put(
    bucket,
    mats.brick!,
    face,
    block,
    0.55,
    1.7,
    0.55,
    face.width * 0.28,
    h + style.rise + 0.7,
    -face.depth * 0.22,
    tint,
  );
  cornice(bucket, mats.wood!, face, block, h);
  if (block.kind === "mill") {
    const silo = new THREE.CylinderGeometry(1.35, 1.45, h + 2.4, 8);
    silo.translate(block.x + face.tx * face.width * 0.28, (h + 2.4) * 0.5, block.z + face.tz * face.width * 0.28);
    bucket.add(mats.brick!, stamp(silo, tint));
    const cap = new THREE.ConeGeometry(1.55, 1.1, 8);
    cap.translate(block.x + face.tx * face.width * 0.28, h + 2.8, block.z + face.tz * face.width * 0.28);
    bucket.add(mats.metal!, stamp(cap, new THREE.Color(0x5c5854)));
  }
}

function addFacadeWindows(
  windows: THREE.BufferGeometry[],
  face: Front,
  block: Block,
  normal: number,
  porchH: number,
  two: boolean,
  h: number,
  glow: [number, number, number],
): void {
  const count = Math.max(2, Math.round(face.width / 2.5));
  for (let i = 0; i < count; i++) {
    const along = (i - (count - 1) / 2) * Math.min(2.15, (face.width - 1.4) / count);
    if (Math.abs(along) < 0.72) continue;
    const lit = hash01(block.x * 3 + block.z + i) > 0.22;
    const g: [number, number, number] = lit ? glow : [glow[0] * 0.08, glow[1] * 0.08, glow[2] * 0.08];
    addPane(windows, face, block, along, 1.55, normal, 0.72, 1.05, 0.06, "street", g);
    if (two) {
      addPane(windows, face, block, along, porchH + (h - porchH) * 0.55, face.depth * 0.5 + 0.05, 0.68, 0.95, 0.06, "street", g);
    }
  }
}

function addSideWindows(
  windows: THREE.BufferGeometry[],
  face: Front,
  block: Block,
  porchD: number,
  two: boolean,
  porchH: number,
  h: number,
): void {
  const span = face.depth - porchD - 1.2;
  const count = Math.max(1, Math.round(span / 2.4));
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const normal = -face.depth * 0.5 + 0.8 + t * Math.max(0.4, span);
      const along = side * (face.width * 0.5 + 0.04);
      const lit = hash01(i * 9 + side * 4 + block.z) > 0.3;
      const g: [number, number, number] = lit ? [2.4, 1.45, 0.55] : [0.2, 0.12, 0.06];
      addPane(windows, face, block, along, 1.5, normal, 0.62, 0.95, 0.05, "side", g);
      if (two) addPane(windows, face, block, along, porchH + (h - porchH) * 0.5, normal, 0.58, 0.85, 0.05, "side", g);
    }
  }
}

function addWindowsRow(
  windows: THREE.BufferGeometry[],
  face: Front,
  block: Block,
  normal: number,
  y: number,
  gap: number,
  glow: [number, number, number],
  w: number,
  h: number,
): void {
  const count = Math.max(2, Math.floor((face.width - 1) / gap));
  for (let i = 0; i < count; i++) {
    const along = (i - (count - 1) / 2) * gap;
    if (Math.abs(along) < 0.2 && count > 3) continue;
    addPane(windows, face, block, along, y, normal, w, h, 0.06, "street", glow);
  }
}

function addPane(
  windows: THREE.BufferGeometry[],
  face: Front,
  block: Block,
  along: number,
  y: number,
  normal: number,
  wide: number,
  tall: number,
  thick: number,
  facing: "street" | "side",
  glow: [number, number, number],
): void {
  const sizeT = facing === "street" ? wide : thick;
  const sizeN = facing === "street" ? thick : wide;
  const geo = new THREE.BoxGeometry(
    Math.abs(face.nx) > 0.5 ? sizeN : sizeT,
    tall,
    Math.abs(face.nz) > 0.5 ? sizeN : sizeT,
  );
  const cx = block.x + face.tx * along + face.nx * normal;
  const cz = block.z + face.tz * along + face.nz * normal;
  geo.translate(cx, y, cz);
  windows.push(paintGlow(geo, glow[0], glow[1], glow[2]));
}

function neonEat(windows: THREE.BufferGeometry[], face: Front, block: Block, y: number): void {
  const glow: [number, number, number] = [4.2, 0.35, 0.28];
  const n = face.depth * 0.5 + 0.2;
  const bar = (along: number, yy: number, w: number, h: number) =>
    addPane(windows, face, block, along, yy, n, w, h, 0.08, "street", glow);
  bar(-1.15, y, 0.12, 0.85);
  bar(-1.15, y + 0.36, 0.55, 0.1);
  bar(-1.15, y, 0.5, 0.1);
  bar(-1.15, y - 0.36, 0.55, 0.1);
  bar(0.05, y + 0.28, 0.12, 0.5);
  bar(0.45, y + 0.28, 0.12, 0.5);
  bar(0.25, y + 0.5, 0.5, 0.1);
  bar(0.25, y + 0.05, 0.42, 0.1);
  bar(1.15, y, 0.62, 0.1);
  bar(1.15, y + 0.28, 0.12, 0.62);
}

function flatRoof(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  face: Front,
  block: Block,
  h: number,
  parapet: number,
): void {
  put(bucket, mats.tar!, face, block, face.width + 0.3, 0.22, face.depth + 0.3, 0, h + 0.1, 0, TAR);
  const y = h + parapet * 0.5 + 0.15;
  put(bucket, mats.brick!, face, block, face.width + 0.3, parapet, 0.16, 0, y, face.depth * 0.5 + 0.08, DARK);
  put(bucket, mats.brick!, face, block, face.width + 0.3, parapet, 0.16, 0, y, -(face.depth * 0.5 + 0.08), DARK);
  put(bucket, mats.brick!, face, block, 0.16, parapet, face.depth + 0.3, face.width * 0.5 + 0.08, y, 0, DARK);
  put(bucket, mats.brick!, face, block, 0.16, parapet, face.depth + 0.3, -(face.width * 0.5 + 0.08), y, 0, DARK);
}

function addRoof(
  bucket: Bucket,
  mat: THREE.Material,
  face: Front,
  block: Block,
  h: number,
  rise: number,
  overhang: number,
  mode: "eave" | "front",
  tint: THREE.Color,
): void {
  const hw = face.width * 0.5 + overhang;
  const hd = face.depth * 0.5 + overhang;
  const y0 = h + 0.04;
  const y1 = h + rise;
  const p = (along: number, normal: number, y: number): [number, number, number] => [
    block.x + face.tx * along + face.nx * normal,
    y,
    block.z + face.tz * along + face.nz * normal,
  ];
  const pts =
    mode === "eave"
      ? [p(hw, hd, y0), p(-hw, hd, y0), p(-hw, -hd, y0), p(hw, -hd, y0), p(hw, 0, y1), p(-hw, 0, y1)]
      : [p(hw, hd, y0), p(-hw, hd, y0), p(-hw, -hd, y0), p(hw, -hd, y0), p(0, hd, y1), p(0, -hd, y1)];
  const faces =
    mode === "eave"
      ? [
          [0, 1, 5],
          [0, 5, 4],
          [3, 4, 5],
          [3, 5, 2],
          [0, 4, 3],
          [1, 2, 5],
        ]
      : [
          [0, 4, 1],
          [3, 2, 5],
          [0, 3, 5],
          [0, 5, 4],
          [1, 4, 5],
          [1, 5, 2],
        ];
  bucket.add(mat, stamp(roofGeo(pts, faces), tint));
}

function cornice(bucket: Bucket, mat: THREE.Material, face: Front, block: Block, h: number): void {
  put(bucket, mat, face, block, face.width + 0.22, 0.1, face.depth + 0.22, 0, h - 0.02, 0, WOOD);
}

function steeple(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  windows: THREE.BufferGeometry[],
  face: Front,
  block: Block,
  h: number,
): void {
  const along = -face.width * 0.28;
  const normal = face.depth * 0.18;
  const towerH = h + 3.4;
  put(bucket, mats.stone!, face, block, 2.05, towerH, 2.05, along, towerH * 0.5, normal, new THREE.Color(0xc8c4c8));
  addPane(windows, face, block, along, h * 0.62, normal + 1.08, 0.45, 1.4, 0.06, "street", [3.2, 0.7, 0.4]);
  const cx = block.x + face.tx * along + face.nx * normal;
  const cz = block.z + face.tz * along + face.nz * normal;
  const cone = new THREE.ConeGeometry(1.35, 3.1, 4);
  cone.rotateY(Math.PI / 4);
  cone.translate(cx, towerH + 1.45, cz);
  bucket.add(mats.shingle!, stamp(cone, new THREE.Color(0x2e2a30)));
  put(bucket, mats.metal!, face, block, 0.08, 0.7, 0.08, along, towerH + 3.2, normal, DARK);
  put(bucket, mats.metal!, face, block, 0.46, 0.08, 0.08, along, towerH + 3.35, normal, DARK);
}

function stack(
  bucket: Bucket,
  mat: THREE.Material,
  face: Front,
  block: Block,
  along: number,
  normal: number,
  h: number,
  tint: THREE.Color,
): void {
  const geo = new THREE.CylinderGeometry(0.38, 0.5, 4.4, 8);
  const cx = block.x + face.tx * along + face.nx * normal;
  const cz = block.z + face.tz * along + face.nz * normal;
  geo.translate(cx, h + 2.3, cz);
  bucket.add(mat, stamp(geo, tint));
  const cap = new THREE.CylinderGeometry(0.5, 0.42, 0.18, 8);
  cap.translate(cx, h + 4.55, cz);
  bucket.add(mat, stamp(cap, DARK));
}

function pipe(bucket: Bucket, mat: THREE.Material, face: Front, block: Block, y: number): void {
  const geo = new THREE.CylinderGeometry(0.1, 0.1, face.width * 0.7, 6);
  if (Math.abs(face.nx) > 0.5) geo.rotateX(Math.PI / 2);
  else geo.rotateZ(Math.PI / 2);
  const cx = block.x + face.nx * -face.depth * 0.15;
  const cz = block.z + face.nz * -face.depth * 0.15;
  geo.translate(cx, y, cz);
  bucket.add(mat, stamp(geo, new THREE.Color(0x6a625c)));
}

function put(
  bucket: Bucket,
  mat: THREE.Material,
  face: Front,
  block: Block,
  sizeT: number,
  sizeY: number,
  sizeN: number,
  along: number,
  y: number,
  normal: number,
  tint: THREE.Color,
): void {
  if (sizeT <= 0.01 || sizeY <= 0.01 || sizeN <= 0.01) return;
  const geo = new THREE.BoxGeometry(
    Math.abs(face.nx) > 0.5 ? sizeN : sizeT,
    sizeY,
    Math.abs(face.nz) > 0.5 ? sizeN : sizeT,
  );
  geo.translate(block.x + face.tx * along + face.nx * normal, y, block.z + face.tz * along + face.nz * normal);
  bucket.add(mat, stamp(geo, tint));
}

function stamp(geo: THREE.BufferGeometry, tint: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.getAttribute("position");
  const norm = g.getAttribute("normal");
  let uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    g.setAttribute("uv", uv);
  }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv.setXY(i, u * 0.45, v * 0.45);
    const n = 0.9 + 0.1 * frac(Math.sin(x * 12.989 + y * 4.141 + z * 7.77) * 43758.5453);
    col[i * 3] = tint.r * n;
    col[i * 3 + 1] = tint.g * n;
    col[i * 3 + 2] = tint.b * n;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function paintGlow(geo: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const mesh = geo.index ? geo.toNonIndexed() : geo;
  if (mesh !== geo) geo.dispose();
  const pos = mesh.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  mesh.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (!mesh.getAttribute("uv")) mesh.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (!mesh.getAttribute("normal")) mesh.computeVertexNormals();
  return mesh;
}

function roofGeo(pts: [number, number, number][], faces: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const f of faces) {
    const a = pts[f[0]!]!;
    const b = pts[f[1]!]!;
    const c = pts[f[2]!]!;
    const ax = b[0] - a[0];
    const ay = b[1] - a[1];
    const az = b[2] - a[2];
    const bx = c[0] - a[0];
    const by = c[1] - a[1];
    const bz = c[2] - a[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(nx, ny, nz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
  return geo;
}

function buildAltar(
  scene: THREE.Scene,
  mats: Record<string, THREE.MeshStandardMaterial>,
  bucket: Bucket,
  hands: THREE.Object3D[],
): void {
  const stone = new THREE.Color(0xc2b8ae);
  putBox(bucket, mats.stone!, 7.2, 0.16, 7.2, 0, 0.08, 0, stone);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    putBox(bucket, mats.stone!, 0.42, 2.7, 0.42, Math.cos(a) * 2.15, 1.35, Math.sin(a) * 2.15, stone);
    const candle = new THREE.SphereGeometry(0.1, 8, 6);
    candle.translate(Math.cos(a) * 2.15, 2.78, Math.sin(a) * 2.15);
    // candles are emissive via a small basic mesh added directly
    const mesh = new THREE.Mesh(
      candle,
      new THREE.MeshBasicMaterial({ color: 0xffe1b0 }),
    );
    scene.add(mesh);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.15, 0.08, 6, 40),
    new THREE.MeshStandardMaterial({ color: 0x4a403c, roughness: 0.6, metalness: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  ring.castShadow = true;
  ring.receiveShadow = true;
  scene.add(ring);

  const clockMat = new THREE.MeshStandardMaterial({
    color: 0x140e0c,
    emissive: 0xc44536,
    emissiveIntensity: 0.85,
    roughness: 0.4,
    metalness: 0.35,
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.45, 3.3, 1.45), mats.stone!);
  // vertex colors expected by stone material — set a color attribute
  paintSolid(tower.geometry, stone);
  tower.position.y = 1.85;
  tower.castShadow = true;
  tower.receiveShadow = true;
  scene.add(tower);

  const faces: Array<[number, number, number, number]> = [
    [0, 2.15, 0.78, 0],
    [0, 2.15, -0.78, Math.PI],
    [0.78, 2.15, 0, Math.PI / 2],
    [-0.78, 2.15, 0, -Math.PI / 2],
  ];
  const handMat = new THREE.MeshBasicMaterial({ color: 0xf4ecdf });
  for (const [x, y, z, yaw] of faces) {
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), clockMat);
    dial.position.set(x, y, z);
    dial.rotation.y = yaw;
    scene.add(dial);
    for (const fast of [false, true]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.rotation.y = yaw;
      pivot.userData.fast = fast;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(fast ? 0.03 : 0.05, fast ? 0.22 : 0.34, 0.02), handMat);
      hand.position.y = fast ? 0.1 : 0.14;
      pivot.add(hand);
      scene.add(pivot);
      hands.push(pivot);
    }
  }
}

function addClapboardTrim(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  face: Front,
  block: Block,
  h: number,
): void {
  const trim = new THREE.Color(0xf4efe6);
  for (const s of [-1, 1]) {
    put(bucket, mats.paint!, face, block, 0.12, h * 0.96, 0.14, s * (face.width * 0.48), h * 0.5, face.depth * 0.46, trim);
  }
  put(bucket, mats.paint!, face, block, face.width * 0.98, 0.1, 0.16, 0, h * 0.97, face.depth * 0.46, trim);
}

function addLampShaft(scene: THREE.Scene, x: number, y: number, z: number, opacity = 0.1): void {
  const shaft = new THREE.Mesh(
    new THREE.ConeGeometry(2.15, 5.2, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb46a,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  shaft.rotation.x = Math.PI;
  shaft.position.set(x, y - 2.15, z);
  shaft.castShadow = false;
  shaft.name = "lamp-shaft";
  scene.add(shaft);
}

function buildWhispers(scene: THREE.Scene): void {
  const mote = new THREE.MeshBasicMaterial({ color: 0xe4d3b0, transparent: true, opacity: 0.9 });
  const post = new THREE.MeshStandardMaterial({ color: 0x2c2826, roughness: 0.8 });
  for (const tell of TELLS) {
    const y = groundY(tell.x, tell.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.15, 5), post);
    pole.position.set(tell.x, y + 0.55, tell.z);
    pole.castShadow = false;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mote);
    glow.position.set(tell.x, y + 1.25, tell.z);
    glow.name = `whisper-${tell.id}`;
    scene.add(pole, glow);
  }
}

function buildRoutes(mats: Record<string, THREE.MeshStandardMaterial>, bucket: Bucket, windows: THREE.BufferGeometry[]): void {
  const iron = new THREE.Color(0x2a2624);
  for (const sc of SHORTCUTS) {
    for (const [x, z] of [
      [sc.ax, sc.az],
      [sc.bx, sc.bz],
    ] as const) {
      if (sc.kind === "fence") {
        const post = new THREE.BoxGeometry(0.08, 1.05, 0.08);
        post.translate(x, 0.52, z);
        bucket.add(mats.wood!, stamp(post, WOOD));
        const rail = new THREE.BoxGeometry(1.4, 0.06, 0.06);
        rail.translate(x, 0.85, z);
        bucket.add(mats.wood!, stamp(rail, WOOD));
      } else if (sc.kind === "sewer") {
        const grate = new THREE.CylinderGeometry(0.55, 0.55, 0.06, 8);
        grate.translate(x, 0.04, z);
        bucket.add(mats.metal!, stamp(grate, iron));
      } else {
        const hatch = new THREE.BoxGeometry(0.9, 0.08, 0.7);
        hatch.translate(x, 0.06, z);
        bucket.add(mats.wood!, stamp(hatch, new THREE.Color(0x3a2c24)));
      }
    }
  }
  for (const car of CAR_SPOTS) {
    const bulb = new THREE.SphereGeometry(0.08, 6, 5);
    bulb.translate(car.x, 0.85, car.z);
    windows.push(paintGlow(bulb, 3.2, 1.8, 0.7));
  }
}

function addDoorBulb(windows: THREE.BufferGeometry[], face: Front, block: Block): void {
  const bulb = new THREE.SphereGeometry(0.09, 8, 6);
  const y = groundY(block.x, block.z) + 2.4;
  bulb.translate(block.x + face.nx * (face.depth * 0.5 + 0.12), y, block.z + face.nz * (face.depth * 0.5 + 0.12));
  windows.push(paintGlow(bulb, 4.8, 2.6, 1.05));
}

function buildRadioMast(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  windows: THREE.BufferGeometry[],
  block: Block,
): void {
  const y0 = groundY(block.x, block.z) + block.h;
  const mast = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 6);
  mast.translate(block.x, y0 + 3.1, block.z);
  bucket.add(mats.metal!, stamp(mast, DARK));
  const dish = new THREE.CylinderGeometry(0.85, 0.85, 0.08, 10);
  dish.rotateX(0.7);
  dish.translate(block.x + 0.35, y0 + 5.5, block.z);
  bucket.add(mats.metal!, stamp(dish, new THREE.Color(0x6a6248)));
  const blink = new THREE.SphereGeometry(0.12, 8, 6);
  blink.translate(block.x, y0 + 6.5, block.z);
  windows.push(paintGlow(blink, 5.2, 0.28, 0.18));
}

function buildDoors(scene: THREE.Scene): Array<{ id: string; pivot: THREE.Group; latch: THREE.Mesh; bar: THREE.Object3D; rim: THREE.Group; rimMat: THREE.MeshBasicMaterial }> {
  const paint = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.48, metalness: 0.04 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe4d8c4, roughness: 0.62, metalness: 0.02 });
  const board = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.86, metalness: 0.02 });
  const doors: Array<{ id: string; pivot: THREE.Group; latch: THREE.Mesh; bar: THREE.Object3D; rim: THREE.Group; rimMat: THREE.MeshBasicMaterial }> = [];
  for (const pose of doorPoses()) {
    const pivot = new THREE.Group();
    pivot.position.set(pose.x, groundY(pose.x, pose.z), pose.z);
    pivot.rotation.y = pose.yaw;
    pivot.userData.yaw = pose.yaw;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.16, 0.07), paint);
    slab.position.set(0.76, 1.14, 0);
    slab.castShadow = true;
    pivot.add(slab);
    for (const py of [0.48, 1.12, 1.76]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.5, 0.025), trim);
      panel.position.set(0.76, py, 0.04);
      pivot.add(panel);
    }
    const iron = new THREE.MeshStandardMaterial({
      color: 0xc9c2b4,
      roughness: 0.35,
      metalness: 0.72,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.08), iron);
    latch.position.set(1.38, 1.16, 0.08);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 8, Math.PI), iron);
    shackle.position.set(1.38, 1.3, 0.08);
    shackle.rotation.x = Math.PI;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.12, 0.1), board);
    bar.position.set(0.78, 1.42, 0.1);
    bar.visible = false;
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xf0e6d8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const rim = new THREE.Group();
    const frameW = 1.62;
    const frameH = 2.28;
    const thick = 0.05;
    for (const [gw, gh, px, py] of [
      [frameW, thick, 0.76, 1.14 + frameH / 2],
      [frameW, thick, 0.76, 1.14 - frameH / 2],
      [thick, frameH, 0.76 - frameW / 2, 1.14],
      [thick, frameH, 0.76 + frameW / 2, 1.14],
    ] as const) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.025), rimMat);
      edge.position.set(px, py, 0.07);
      rim.add(edge);
    }
    rim.visible = false;
    pivot.add(latch, shackle, bar, rim);
    scene.add(pivot);
    doors.push({ id: pose.id, pivot, latch, bar, rim, rimMat });
  }
  return doors;
}

function lampHead(x: number, z: number): [number, number] {
  const len = Math.hypot(x, z) || 1;
  return [x + (-x / len) * 0.7, z + (-z / len) * 0.7];
}

function buildLamps(scene: THREE.Scene, mats: Record<string, THREE.MeshStandardMaterial>, windows: THREE.BufferGeometry[]): void {
  const spots: Array<[number, number]> = [
    ...LAMPS,
    [0, 12.4],
    [-9.2, -5.5],
    [9.4, -5.5],
    [-4.15, -14.2],
    [-16, 20.2],
    [3.2, 6.5],
  ];
  const bucket = new Bucket();
  for (const [x, z] of spots) {
    if (hitsBlock(x, z, 0.5) || Math.hypot(x, z) > BOUNDARY - 2) continue;
    const pole = new THREE.CylinderGeometry(0.06, 0.09, 4.5, 6);
    pole.translate(x, 2.25, z);
    bucket.add(mats.metal!, stamp(pole, new THREE.Color(0x3a342e)));
    const len = Math.hypot(x, z) || 1;
    const ax = (-x / len) * 0.7;
    const az = (-z / len) * 0.7;
    const arm = new THREE.BoxGeometry(Math.abs(ax) > Math.abs(az) ? 0.85 : 0.08, 0.06, Math.abs(az) >= Math.abs(ax) ? 0.85 : 0.08);
    arm.translate(x + ax * 0.5, 4.45, z + az * 0.5);
    bucket.add(mats.metal!, stamp(arm, new THREE.Color(0x3a342e)));
    const head = lampHead(x, z);
    const bulb = new THREE.SphereGeometry(0.14, 8, 6);
    bulb.translate(head[0], 4.28, head[1]);
    windows.push(paintGlow(bulb, 3.4, 2.5, 1.35));
  }
  bucket.flush(scene, true, true);
}

function buildTrees(scene: THREE.Scene, mats: Record<string, THREE.MeshStandardMaterial>, high: boolean): void {
  const spots: Array<[number, number, number]> = [];
  const rings = [
    { count: high ? 16 : 10, r: 33.4 },
    { count: high ? 18 : 11, r: 56 },
    { count: high ? 14 : 8, r: 68 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + ring.r * 0.01;
      const r = ring.r + (i % 3) * 0.55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x, z) > BOUNDARY - 1.5) continue;
      if (!hitsBlock(x, z, 1.2) && surfaceAt(x, z) === "lawn") spots.push([x, z, 0.85 + (i % 4) * 0.18]);
    }
  }
  for (const b of BLOCKS) {
    const corners: Array<[number, number]> = [
      [b.x + b.w * 0.5 + 1.3, b.z + b.d * 0.5 + 1.3],
      [b.x - b.w * 0.5 - 1.3, b.z - b.d * 0.5 - 1.3],
    ];
    for (const [x, z] of corners) {
      if (Math.hypot(x, z) > BOUNDARY - 2) continue;
      if (hitsBlock(x, z, 0.8)) continue;
      if (surfaceAt(x, z) !== "lawn") continue;
      spots.push([x, z, 0.75 + hash01(x + z) * 0.4]);
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.26, 3.6, 5);
  trunkGeo.translate(0, 1.8, 0);
  const leafGeo = new THREE.ConeGeometry(1.15, 2.4, 6);
  leafGeo.translate(0, 1.1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mats.bark!, spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, mats.leaf!, spots.length);
  trunks.castShadow = true;
  leaves.receiveShadow = true;
  trunks.frustumCulled = false;
  leaves.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < spots.length; i++) {
    const [x, z, s] = spots[i]!;
    dummy.position.set(x, groundY(x, z), z);
    dummy.rotation.set(0, i, (i % 2 === 0 ? 1 : -1) * 0.08);
    dummy.scale.setScalar(s!);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, groundY(x, z) + 2.55 * s!, z);
    dummy.scale.set(1.15 * s!, 1.35 * s!, 1.15 * s!);
    dummy.rotation.set(0.1 * (i % 3), i * 0.7, 0);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    color.setHex(i % 5 === 0 ? 0x4a2428 : 0x2c2422);
    leaves.setColorAt(i, color);
  }
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks, leaves);
}

function buildCars(mats: Record<string, THREE.MeshStandardMaterial>, bucket: Bucket): void {
  const paints = [0x6e3030, 0xd8d0c2, 0x243028, 0x8a6238, 0x3a4048];
  let i = 0;
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
    addCar(bucket, mats, x, z, Math.atan2(face.nx, face.nz), paints[i % paints.length]!);
    i++;
  }
}

function addCar(
  bucket: Bucket,
  mats: Record<string, THREE.MeshStandardMaterial>,
  x: number,
  z: number,
  yaw: number,
  paint: number,
): void {
  const tint = new THREE.Color(paint);
  const body = new THREE.BoxGeometry(1.72, 0.48, 4.15);
  body.translate(0, 0.58, 0);
  const cabin = new THREE.BoxGeometry(1.52, 0.42, 1.9);
  cabin.translate(0, 1.0, -0.25);
  const glass = new THREE.BoxGeometry(1.4, 0.32, 1.7);
  glass.translate(0, 1.02, -0.25);
  for (const [gx, gz] of [
    [0.7, 1.25],
    [-0.7, 1.25],
    [0.7, -1.25],
    [-0.7, -1.25],
  ] as const) {
    const wheel = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 8);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(gx, 0.3, gz);
    finish(bucket, mats.rubber!, wheel, yaw, x, z, new THREE.Color(0x1a1a1a));
  }
  finish(bucket, mats.paint!, body, yaw, x, z, tint);
  finish(bucket, mats.paint!, cabin, yaw, x, z, tint.clone().multiplyScalar(0.85));
  finish(bucket, mats.glass!, glass, yaw, x, z, new THREE.Color(0x1c2428));
}

function finish(
  bucket: Bucket,
  mat: THREE.Material,
  geo: THREE.BufferGeometry,
  yaw: number,
  x: number,
  z: number,
  tint: THREE.Color,
): void {
  geo.rotateY(yaw);
  geo.translate(x, 0, z);
  bucket.add(mat, stamp(geo, tint));
}

function buildProps(
  mats: Record<string, THREE.MeshStandardMaterial>,
  bucket: Bucket,
  windows: THREE.BufferGeometry[],
): void {
  for (const block of BLOCKS) {
    if (block.kind === "boiler") continue;
    const face = orient(block);
    const hd = face.depth * 0.5;
    const x = block.x + face.nx * (hd + 2.4) - face.tx * face.width * 0.28;
    const z = block.z + face.nz * (hd + 2.4) - face.tz * face.width * 0.28;
    if (hitsBlock(x, z, 0.3)) continue;
    const post = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    post.translate(x, 0.45, z);
    bucket.add(mats.metal!, stamp(post, DARK));
    const box = new THREE.BoxGeometry(0.28, 0.22, 0.18);
    box.translate(x, 0.95, z);
    bucket.add(mats.paint!, stamp(box, new THREE.Color(0x4a4038)));
    if (BLOCKS.indexOf(block) % 2 === 0 && !hitsBlock(x + face.tx * 1.1, z + face.tz * 1.1, 0.3)) {
      const cx = x + face.tx * 1.15;
      const cz = z + face.tz * 1.15;
      const seat = new THREE.BoxGeometry(0.48, 0.06, 0.46);
      seat.translate(cx, 0.42, cz);
      bucket.add(mats.wood!, stamp(seat, WOOD));
      const back = new THREE.BoxGeometry(0.48, 0.46, 0.05);
      back.translate(cx - face.nx * 0.18, 0.68, cz - face.nz * 0.18);
      bucket.add(mats.wood!, stamp(back, WOOD));
    }
  }
  const bins: Array<[number, number]> = [
    [-18, -2],
    [12, -16],
  ];
  for (const [x, z] of bins) {
    if (hitsBlock(x, z, 0.4)) continue;
    const bin = new THREE.CylinderGeometry(0.22, 0.2, 0.7, 6);
    bin.translate(x, 0.35, z);
    bucket.add(mats.metal!, stamp(bin, new THREE.Color(0x2e4a38)));
  }
  const swingX = -19;
  const swingZ = 20.5;
  if (!hitsBlock(swingX, swingZ, 1)) {
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4);
      leg.translate(swingX + s * 0.7, 1.1, swingZ);
      bucket.add(mats.metal!, stamp(leg, DARK));
    }
    const bar = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 4);
    bar.rotateZ(Math.PI / 2);
    bar.translate(swingX, 2.15, swingZ);
    bucket.add(mats.metal!, stamp(bar, DARK));
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const rad = 5.5 + (i % 3) * 1.3;
    const x = 2 + Math.cos(a) * rad;
    const z = -48 + Math.sin(a) * rad * 0.75;
    if (hitsBlock(x, z, 0.45) || Math.hypot(x, z) > BOUNDARY - 2) continue;
    const stone = new THREE.BoxGeometry(0.42, 0.62 + (i % 3) * 0.12, 0.1);
    stone.translate(x, 0.36, z);
    stone.rotateY(a);
    bucket.add(mats.stone!, stamp(stone, new THREE.Color(i % 4 === 0 ? 0x8a8078 : 0xc8c0b8)));
  }
  void windows;
}

function buildFloaters(scene: THREE.Scene): void {
  const specs = [
    { x: -6.5, z: 10.5, y: 2.4, kind: "bed" },
    { x: 9, z: -8.5, y: 2.8, kind: "door" },
    { x: -3.5, z: -9, y: 2.1, kind: "crib" },
    { x: 5.5, z: 11, y: 3.2, kind: "chair" },
  ];
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4034, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x6a3034, roughness: 0.7 });
  specs.forEach((s, i) => {
    const g = new THREE.Group();
    if (s.kind === "bed") {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.9), wood));
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.75), cloth);
      sheet.position.y = 0.12;
      g.add(sheet);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), wood);
      post.position.set(-0.75, 0.4, -0.35);
      g.add(post);
    } else if (s.kind === "crib") {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), wood));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.06), wood);
      rail.position.set(0, 0.35, 0.32);
      g.add(rail);
    } else if (s.kind === "chair") {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), wood));
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.06), wood);
      back.position.set(0, 0.4, -0.22);
      g.add(back);
    } else {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.0, 0.08), wood);
      g.add(door);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xd8c090, metalness: 0.7, roughness: 0.3 }),
      );
      knob.position.set(0.28, 0, 0.06);
      g.add(knob);
    }
    g.position.set(s.x, s.y, s.z);
    g.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(g);
    const base = s.y;
    g.onBeforeRender = () => {
      const t = performance.now() * 0.001;
      g.position.y = base + Math.sin(t * 0.65 + i) * 0.28;
      g.rotation.y = t * 0.18 + i;
      g.rotation.z = Math.sin(t * 0.4 + i) * 0.06;
    };
  });
}

function buildSmoke(scene: THREE.Scene): void {
  const boiler = BLOCKS.find((b) => b.kind === "boiler");
  if (!boiler) return;
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2a2428,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const group = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35 + (i % 3) * 0.12, 6, 5), mat);
    puff.userData.seed = i;
    group.add(puff);
  }
  group.position.set(boiler.x + 3.2, boiler.h + 4.6, boiler.z + 1.2);
  scene.add(group);
  group.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    group.children.forEach((puff, i) => {
      const u = (t * 0.18 + i * 0.17) % 1;
      puff.position.set(Math.sin(u * 6 + i) * 0.3, u * 3.2, Math.cos(u * 5 + i) * 0.25);
      const mesh = puff as THREE.Mesh;
      mesh.scale.setScalar(0.4 + u * 1.6);
    });
  };
}

function buildSky(scene: THREE.Scene, glow: THREE.Texture): void {
  const geo = new THREE.SphereGeometry(180, 28, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.5 + 0.2, 0.0, 1.0);
        vec3 top = vec3(0.012, 0.012, 0.02);
        vec3 hor = vec3(0.11, 0.045, 0.05);
        vec3 col = mix(hor, top, smoothstep(0.0, 0.55, h));
        vec3 moonDir = normalize(vec3(0.48, 0.78, -0.31));
        float moon = pow(max(dot(dir, moonDir), 0.0), 180.0);
        float glow = pow(max(dot(dir, moonDir), 0.0), 6.0);
        col += vec3(1.0, 0.9, 0.7) * moon * 1.4;
        col += vec3(0.35, 0.28, 0.22) * glow;
        vec2 sp = floor(dir.xz / max(dir.y, 0.08) * 48.0);
        float star = pow(hash(sp), 48.0);
        col += star * smoothstep(0.15, 0.45, dir.y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: 0xfff0d2,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    }),
  );
  sprite.position.copy(new THREE.Vector3(0.48, 0.78, -0.31).normalize().multiplyScalar(150));
  sprite.scale.setScalar(22);
  scene.add(sprite);
}

function putBox(
  bucket: Bucket,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  tint: THREE.Color,
): void {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  bucket.add(mat, stamp(geo, tint));
}

function paintSolid(geo: THREE.BufferGeometry, tint: THREE.Color): void {
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = tint.r;
    col[i * 3 + 1] = tint.g;
    col[i * 3 + 2] = tint.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function frac(v: number): number {
  return v - Math.floor(v);
}
