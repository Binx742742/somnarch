import * as THREE from "three";

export type Figure = {
  group: THREE.Group;
  arm: THREE.Object3D;
  offArm: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  torso: THREE.Object3D;
  ring: THREE.Mesh;
  coat: THREE.MeshStandardMaterial;
  eyes: THREE.MeshBasicMaterial;
  born: boolean;
  monster: boolean;
  seed: number;
};

const SKIN_HEX = [0xc4ad94, 0xb99680, 0xd2bba4, 0xa88874];

function noiseMap(seed: number, stitches: boolean): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const x = Math.floor(Math.abs(Math.sin(seed * 12.3 + i * 1.7)) * 128);
    const y = Math.floor(Math.abs(Math.sin(seed * 4.1 + i * 2.3)) * 128);
    const v = 150 + ((i * 17) % 80);
    ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
    ctx.fillRect(x, y, 2, 2);
  }
  if (stitches) {
    ctx.strokeStyle = "#f2e6d4";
    ctx.lineWidth = 2;
    for (let y = 18; y < 120; y += 22) {
      ctx.beginPath();
      for (let x = 8; x < 120; x += 8) {
        const yy = y + (x % 16 === 0 ? -3 : 3);
        if (x === 8) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "rgba(40,30,24,0.35)";
    ctx.lineWidth = 1;
    for (let y = 0; y < 128; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y + 1);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeFigure(coatHex: number, monster: boolean, variant = 0): Figure {
  const group = new THREE.Group();
  const clothMap = noiseMap(variant + 2.2, false);
  const fleshMap = noiseMap(variant + (monster ? 9.1 : 1.4), monster);
  const coat = new THREE.MeshStandardMaterial({
    color: coatHex,
    map: clothMap,
    roughness: monster ? 0.86 : 0.78,
    metalness: 0.02,
    emissive: monster ? 0x140606 : 0x12080c,
    emissiveIntensity: monster ? 0.08 : 0.1,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: monster ? 0x5c342e : SKIN_HEX[variant % SKIN_HEX.length],
    map: fleshMap,
    roughness: monster ? 0.62 : 0.58,
    metalness: 0.02,
    emissive: monster ? 0x1a0808 : 0x000000,
    emissiveIntensity: monster ? 0.12 : 0,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: monster ? 0x14100e : 0x1c1614,
    roughness: 0.84,
    metalness: 0.04,
  });
  const eyes = new THREE.MeshBasicMaterial({ color: monster ? 0xffb25a : 0x1a1214 });
  const stitchMat = new THREE.MeshStandardMaterial({
    color: 0xe4d4bc,
    roughness: 0.45,
    metalness: 0.08,
    emissive: 0x6a4030,
    emissiveIntensity: 0.35,
  });

  const torso = new THREE.Group();
  torso.position.y = monster ? 1.08 : 0.96;
  if (monster) torso.rotation.x = 0.34;
  group.add(torso);

  if (!monster) {
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.2), coat);
    pelvis.position.y = 0.02;
    torso.add(pelvis);
    const ribs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.2), coat);
    ribs.position.y = 0.28;
    torso.add(ribs);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.22), coat);
    chest.position.y = 0.52;
    torso.add(chest);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.22), coat);
    skirt.position.set(0, -0.1, -0.02);
    torso.add(skirt);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), skin);
    neck.position.y = 0.66;
    torso.add(neck);
  } else {
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.26), coat);
    pelvis.position.y = 0.02;
    torso.add(pelvis);
    const gut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.3), coat);
    gut.position.set(0, 0.28, 0.04);
    torso.add(gut);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.34), coat);
    chest.position.set(0, 0.62, 0.06);
    torso.add(chest);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.36), coat);
    yoke.position.set(0, 0.78, 0.04);
    torso.add(yoke);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08), coat);
    tail.position.set(0, -0.16, -0.16);
    torso.add(tail);
    const apron = new THREE.MeshStandardMaterial({
      color: 0x6a5e52,
      roughness: 0.9,
      metalness: 0.02,
      emissive: 0x2a0c0a,
      emissiveIntensity: 0.18,
    });
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.78, 0.045), apron);
    bib.position.set(0, 0.36, 0.22);
    torso.add(bib);
    const stain = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.22, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x3a0c0a,
        emissive: 0x5a120e,
        emissiveIntensity: 0.7,
        roughness: 0.55,
      }),
    );
    stain.position.set(0.06, 0.22, 0.25);
    torso.add(stain);
    for (const y of [0.18, 0.4, 0.62]) {
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.016), stitchMat);
      stitch.position.set(0, y, 0.2);
      torso.add(stitch);
    }
  }

  const headY = monster ? 1.02 : 0.84;
  const head = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.16 : 0.125, 14, 12), skin);
  head.scale.set(monster ? 0.82 : 0.92, monster ? 1.28 : 1.08, monster ? 0.9 : 0.96);
  head.position.set(0, headY, monster ? 0.02 : 0.01);
  torso.add(head);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(monster ? 0.12 : 0.1, monster ? 0.07 : 0.05, monster ? 0.1 : 0.08), skin);
  jaw.position.set(0, headY - 0.1, monster ? 0.07 : 0.07);
  torso.add(jaw);
  if (monster) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.06), skin);
    brow.position.set(0, headY + 0.06, 0.1);
    torso.add(brow);
    for (const y of [headY - 0.02, headY + 0.08]) {
      const scar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.012), stitchMat);
      scar.position.set(0, y, 0.13);
      torso.add(scar);
    }
  }

  const hood = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.22 : 0.16, 10, 8), dark);
  hood.scale.set(1.15, 1.05, 0.72);
  hood.position.set(0, headY + 0.04, monster ? -0.1 : -0.1);
  torso.add(hood);
  const cowl = new THREE.Mesh(new THREE.TorusGeometry(monster ? 0.14 : 0.11, 0.035, 6, 10), dark);
  cowl.position.set(0, headY - 0.02, 0.02);
  cowl.rotation.x = Math.PI / 2;
  torso.add(cowl);

  const eyeY = headY + (monster ? 0.03 : 0.02);
  const eyeZ = monster ? 0.13 : 0.11;
  for (const s of [-1, 1]) {
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(monster ? 0.028 : 0.02, 8, 6),
      dark,
    );
    socket.position.set(s * (monster ? 0.055 : 0.042), eyeY, eyeZ - 0.01);
    torso.add(socket);
    const e = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.02 : 0.014, 8, 6), eyes);
    e.scale.set(monster ? 1.5 : 1.1, monster ? 0.45 : 0.7, 0.6);
    e.position.set(s * (monster ? 0.055 : 0.042), eyeY, eyeZ);
    torso.add(e);
  }

  if (monster) {
    const crown = new THREE.MeshStandardMaterial({
      color: 0xd9cbb8,
      emissive: 0xff3a28,
      emissiveIntensity: 1.4,
      metalness: 0.55,
      roughness: 0.32,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const needle = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.36, 5), crown);
      needle.position.set(Math.cos(a) * 0.1, headY + 0.24, Math.sin(a) * 0.06 - 0.04);
      needle.rotation.z = Math.cos(a) * 0.28;
      needle.rotation.x = 0.15;
      torso.add(needle);
    }
  }

  const armLen = monster ? 1.05 : 0.68;
  const shoulderY = monster ? 0.74 : 0.56;
  const shoulderX = monster ? 0.4 : 0.24;
  const right = pivotArm(torso, shoulderX, shoulderY, -1, armLen, monster ? skin : coat, skin, monster);
  const left = pivotArm(torso, shoulderX, shoulderY, 1, armLen, monster ? skin : coat, skin, false);
  const armR = right.pivot;
  const armL = left.pivot;
  if (monster) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xc8c2b6,
      metalness: 0.78,
      roughness: 0.28,
      emissive: 0x3a100e,
      emissiveIntensity: 0.25,
    });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.42, 6), dark);
    handle.position.set(0.02, -0.16, 0.02);
    right.hand.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.028), steel);
    blade.position.set(0.1, -0.42, 0.03);
    right.hand.add(blade);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.42, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffe1c8 }),
    );
    edge.position.set(0.18, -0.42, 0.04);
    right.hand.add(edge);
    const thread = new THREE.MeshStandardMaterial({
      color: 0xe8dcc8,
      emissive: 0xff4a32,
      emissiveIntensity: 1.6,
      metalness: 0.35,
      roughness: 0.3,
    });
    for (let i = 0; i < 4; i++) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.22, 5), thread);
      n.rotation.x = Math.PI;
      n.position.set((i - 1.5) * 0.04, 0.02, 0.04);
      left.hand.add(n);
    }
  } else if (variant % 4 === 0) {
    const lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.14, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0x2a2018,
        emissive: 0xffb060,
        emissiveIntensity: 2.2,
        roughness: 0.4,
      }),
    );
    lantern.position.set(0, -0.02, 0.04);
    left.hand.add(lantern);
  } else if (variant % 4 === 1) {
    const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.08), dark);
    satchel.position.set(-0.02, 0.12, -0.16);
    torso.add(satchel);
  } else if (variant % 4 === 3) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.06, 10), dark);
    cap.position.y = headY + 0.14;
    torso.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 10), dark);
    brim.position.set(0, headY + 0.1, 0.04);
    torso.add(brim);
  }

  const hip = monster ? 1.05 : 0.94;
  const legL = pivotLeg(group, -1, hip, coat, dark, monster);
  const legR = pivotLeg(group, 1, hip, coat, dark, monster);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(monster ? 0.72 : 0.5, 0.03, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xe4d3b0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  group.add(ring);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(monster ? 0.78 : 0.48, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.025;
  blob.castShadow = false;
  blob.receiveShadow = false;
  group.add(blob);

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh === blob || mesh === ring) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  return {
    group,
    arm: armR,
    offArm: armL,
    legL,
    legR,
    torso,
    ring,
    coat,
    eyes,
    born: false,
    monster,
    seed: Math.random() * 10,
  };
}

function pivotArm(
  torso: THREE.Group,
  x: number,
  y: number,
  side: number,
  length: number,
  sleeve: THREE.Material,
  skin: THREE.Material,
  monster: boolean,
): { pivot: THREE.Group; hand: THREE.Group } {
  const pivot = new THREE.Group();
  pivot.position.set(side * x, y, monster ? 0.06 : 0);
  pivot.rotation.z = side * (monster ? 0.08 : 0.14);
  pivot.rotation.x = -0.12;
  const upper = length * 0.48;
  const fore = length * 0.52;
  const upperMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(monster ? 0.075 : 0.055, monster ? 0.08 : 0.05, upper, 7),
    sleeve,
  );
  upperMesh.position.y = -upper * 0.5;
  pivot.add(upperMesh);
  const elbow = new THREE.Group();
  elbow.position.y = -upper;
  elbow.rotation.x = monster ? 0.1 : 0.28;
  const foreMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(monster ? 0.055 : 0.04, monster ? 0.06 : 0.045, fore, 7),
    skin,
  );
  foreMesh.position.y = -fore * 0.5;
  elbow.add(foreMesh);
  const hand = new THREE.Group();
  hand.position.y = -fore;
  const palm = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.055 : 0.04, 8, 6), skin);
  hand.add(palm);
  elbow.add(hand);
  pivot.add(elbow);
  torso.add(pivot);
  return { pivot, hand };
}

function pivotLeg(
  group: THREE.Group,
  side: number,
  hip: number,
  coat: THREE.Material,
  bootMat: THREE.Material,
  monster: boolean,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(side * (monster ? 0.16 : 0.1), hip, 0);
  const len = monster ? 0.98 : 0.86;
  const thigh = len * 0.48;
  const shin = len * 0.52;
  const thighMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(monster ? 0.11 : 0.08, monster ? 0.09 : 0.065, thigh, 7),
    coat,
  );
  thighMesh.position.y = -thigh * 0.5;
  pivot.add(thighMesh);
  const knee = new THREE.Group();
  knee.position.y = -thigh;
  knee.rotation.x = monster ? 0.06 : 0.1;
  const shinMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(monster ? 0.07 : 0.055, monster ? 0.08 : 0.06, shin - 0.08, 7),
    coat,
  );
  shinMesh.position.y = -(shin - 0.08) * 0.5;
  knee.add(shinMesh);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(monster ? 0.14 : 0.11, 0.1, monster ? 0.26 : 0.22), bootMat);
  boot.position.set(0, -shin + 0.05, 0.04);
  knee.add(boot);
  pivot.add(knee);
  group.add(pivot);
  return pivot;
}

export function makeLoot(kind: string, bare = false): THREE.Group {
  const g = new THREE.Group();
  const color =
    kind === "fragment"
      ? 0xe4d3b0
      : kind === "clock"
        ? 0xc44536
        : kind === "adrenaline" || kind === "haste"
          ? 0x8fd0c6
          : kind === "mend"
            ? 0xc44536
            : kind === "hush"
              ? 0x9eb4c8
              : kind === "ward"
                ? 0xe4d3b0
                : kind === "iron"
                  ? 0x8a8680
                  : kind === "lamp"
                    ? 0xffb46a
                    : 0xf0e6d8;
  if (!bare) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.14, 2.4, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    beam.position.y = 1.15;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.8 }),
    );
    pad.position.y = 0.03;
    g.add(beam, pad);
  }
  let token: THREE.Object3D;
  if (kind === "iron") {
    token = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.72, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x3a3836, metalness: 0.72, roughness: 0.32 }),
    );
    const hook = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.6, roughness: 0.4 }),
    );
    hook.position.set(0.08, 0.3, 0);
    token.add(hook);
  } else if (kind === "shears") {
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8c2b6, metalness: 0.7, roughness: 0.28 });
    token = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.02), steel);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.02), steel);
    a.rotation.z = 0.35;
    b.rotation.z = -0.35;
    token.add(a, b);
  } else if (kind === "lamp") {
    token = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.2, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0x2a2018,
        emissive: 0xffb060,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      }),
    );
  } else if (kind === "mend" || kind === "haste" || kind === "hush" || kind === "ward") {
    const glass = kind === "mend" ? 0xc44536 : kind === "haste" ? 0xd8fff4 : kind === "hush" ? 0xc5d4e4 : 0xf4efe6;
    token = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, 0.16, 4, 6),
      new THREE.MeshStandardMaterial({ color: glass, emissive: glass, emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.08 }),
    );
  } else if (kind === "clock") {
    token = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a100e, emissive: 0xc44536, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.35 }),
    );
    token.rotation.x = Math.PI / 2;
  } else if (kind === "adrenaline") {
    token = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.045, 0.18, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xd8fff4, emissive: 0x7dffe8, emissiveIntensity: 0.6, roughness: 0.25 }),
    );
    token.rotation.z = 0.4;
  } else if (kind === "phone") {
    token = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x1a1816, emissive: 0xffb46a, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
  } else if (kind === "ear" || kind === "bar" || kind === "tend" || kind === "rope") {
    const ink = kind === "ear" ? 0xe4d3b0 : kind === "bar" ? 0xc44536 : kind === "tend" ? 0x8fd0c6 : 0xffb46a;
    token = new THREE.Mesh(
      new THREE.OctahedronGeometry(kind === "rope" ? 0.2 : 0.16, 0),
      new THREE.MeshStandardMaterial({ color: ink, emissive: ink, emissiveIntensity: 0.85, roughness: 0.3 }),
    );
  } else if (kind === "bandage") {
    token = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.7 }),
    );
  } else {
    token = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: 0xf0e2c4,
        emissive: 0xe4d3b0,
        emissiveIntensity: 0.7,
        roughness: 0.35,
        metalness: 0.2,
      }),
    );
  }
  token.position.y = bare ? 0.15 : 0.42;
  g.add(token);
  g.userData.kind = kind;
  return g;
}
