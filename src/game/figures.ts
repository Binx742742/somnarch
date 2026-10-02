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

const SKIN = new THREE.MeshStandardMaterial({
  color: 0xb9a48c,
  roughness: 0.82,
  metalness: 0.02,
});

export function makeFigure(coatHex: number, monster: boolean, variant = 0): Figure {
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({
    color: coatHex,
    roughness: monster ? 0.78 : 0.72,
    metalness: 0.06,
    emissive: monster ? 0x2a0908 : 0x12080c,
    emissiveIntensity: monster ? 0.45 : 0.14,
  });
  const skin = monster
    ? new THREE.MeshStandardMaterial({
        color: 0x4a2824,
        roughness: 0.55,
        metalness: 0.04,
        emissive: 0x2a0a08,
        emissiveIntensity: 0.35,
      })
    : SKIN;
  const dark = new THREE.MeshStandardMaterial({
    color: monster ? 0x100c0c : 0x1a1412,
    roughness: 0.8,
    metalness: 0.08,
  });
  const eyes = new THREE.MeshBasicMaterial({ color: monster ? 0xffb25a : 0x1a1214 });

  const torso = new THREE.Group();
  torso.position.y = monster ? 1.02 : 0.92;
  if (monster) torso.rotation.x = 0.32;
  group.add(torso);

  const bodyH = monster ? 1.15 : 0.78;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(monster ? 0.34 : 0.24, monster ? 0.52 : 0.32, bodyH, monster ? 7 : 7),
    coat,
  );
  body.position.y = monster ? 0.42 : 0.28;
  torso.add(body);

  const yoke = new THREE.Mesh(new THREE.BoxGeometry(monster ? 0.86 : 0.58, 0.14, monster ? 0.38 : 0.3), coat);
  yoke.position.y = monster ? 0.92 : 0.62;
  torso.add(yoke);

  if (!monster) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.08), coat);
    tail.position.set(0, -0.05, -0.2);
    torso.add(tail);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 10), dark);
    scarf.position.y = 0.78;
    scarf.rotation.x = Math.PI / 2;
    torso.add(scarf);
  } else {
    const apron = new THREE.MeshStandardMaterial({
      color: 0x6a5e52,
      roughness: 0.86,
      metalness: 0.02,
      emissive: 0x4a100c,
      emissiveIntensity: 0.4,
    });
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.06), apron);
    bib.position.set(0, 0.42, 0.34);
    torso.add(bib);
    const stain = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x3a0c0a,
        emissive: 0x6a140e,
        emissiveIntensity: 1.1,
        roughness: 0.5,
      }),
    );
    stain.position.set(0.06, 0.18, 0.38);
    torso.add(stain);
    const stitchMat = new THREE.MeshBasicMaterial({ color: 0xd8c4a8 });
    for (const y of [0.2, 0.48, 0.74]) {
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.015, 0.02), stitchMat);
      stitch.position.set(0, y, 0.28);
      torso.add(stitch);
    }
  }

  const headY = monster ? 1.18 : 0.86;
  const head = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.2 : 0.15, 12, 10), skin);
  if (monster) head.scale.set(0.86, 1.25, 0.95);
  head.position.y = headY;
  torso.add(head);

  const hood = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.28 : 0.2, 10, 8), dark);
  hood.scale.set(1.05, 1.18, 1.2);
  hood.position.set(0, headY + 0.03, -0.07);
  torso.add(hood);

  const eyeY = headY + (monster ? 0.04 : 0.02);
  const eyeZ = monster ? 0.16 : 0.12;
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(
      new THREE.SphereGeometry(monster ? 0.045 : 0.028, 8, 6),
      eyes,
    );
    e.scale.set(monster ? 1.35 : 1, monster ? 0.38 : 1, 0.7);
    e.position.set(s * (monster ? 0.075 : 0.055), eyeY, eyeZ);
    torso.add(e);
  }

  if (monster) {
    const crown = new THREE.MeshStandardMaterial({
      color: 0xd9cbb8,
      emissive: 0xff3a28,
      emissiveIntensity: 1.6,
      metalness: 0.45,
      roughness: 0.28,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const needle = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.42, 5), crown);
      needle.position.set(Math.cos(a) * 0.12, headY + 0.28, Math.sin(a) * 0.1 - 0.02);
      needle.rotation.z = Math.cos(a) * 0.35;
      needle.rotation.x = 0.2;
      torso.add(needle);
    }
  }

  const armLen = monster ? 0.95 : 0.62;
  const armR = pivotArm(torso, monster ? 0.48 : 0.32, monster ? 0.78 : 0.52, -1, armLen, skin, monster);
  const armL = pivotArm(torso, monster ? 0.48 : 0.32, monster ? 0.78 : 0.52, 1, armLen, skin, false);
  if (monster) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xd5d0c6,
      metalness: 0.82,
      roughness: 0.22,
      emissive: 0x5a1610,
      emissiveIntensity: 0.55,
    });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.28, 6), dark);
    handle.position.set(0, -armLen - 0.02, 0.02);
    armR.add(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.035), steel);
    blade.position.set(0.12, -armLen - 0.22, 0.06);
    armR.add(blade);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.42, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffe1c8 }),
    );
    edge.position.set(0.3, -armLen - 0.22, 0.08);
    armR.add(edge);
    const thread = new THREE.MeshStandardMaterial({
      color: 0xe8dcc8,
      emissive: 0xff4a32,
      emissiveIntensity: 2.2,
      metalness: 0.4,
      roughness: 0.25,
    });
    for (let i = 0; i < 4; i++) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.36, 5), thread);
      n.rotation.x = Math.PI;
      n.position.set((i - 1.5) * 0.05, -armLen + 0.05, 0.08);
      armL.add(n);
    }
  } else if (variant % 4 === 0) {
    const lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.16, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x2a2018,
        emissive: 0xffb060,
        emissiveIntensity: 2.4,
        roughness: 0.4,
      }),
    );
    lantern.position.set(0, -armLen - 0.02, 0.06);
    armL.add(lantern);
  } else if (variant % 4 === 1) {
    const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.1), dark);
    satchel.position.set(-0.05, 0.15, -0.22);
    torso.add(satchel);
  } else if (variant % 4 === 3) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), dark);
    cap.position.y = headY + 0.16;
    torso.add(cap);
  }

  const hip = monster ? 1.02 : 0.9;
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
  skin: THREE.Material,
  monster: boolean,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(side * x, y, monster ? 0.12 : 0.02);
  pivot.rotation.z = side * 0.18;
  pivot.rotation.x = -0.2;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(monster ? 0.07 : 0.055, monster ? 0.08 : 0.06, length, 6), skin);
  arm.position.y = -length * 0.5;
  pivot.add(arm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(monster ? 0.07 : 0.05, 8, 6), skin);
  hand.position.y = -length;
  pivot.add(hand);
  torso.add(pivot);
  return pivot;
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
  pivot.position.set(side * (monster ? 0.16 : 0.12), hip, 0);
  const len = monster ? 0.92 : 0.78;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(monster ? 0.1 : 0.08, monster ? 0.11 : 0.09, len - 0.12, 6), coat);
  leg.position.y = -(len - 0.12) * 0.5;
  pivot.add(leg);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(monster ? 0.16 : 0.13, 0.12, monster ? 0.28 : 0.22), bootMat);
  boot.position.set(0, -len + 0.06, 0.04);
  pivot.add(boot);
  group.add(pivot);
  return pivot;
}

export function makeLoot(kind: string): THREE.Group {
  const g = new THREE.Group();
  const color = kind === "fragment" ? 0xe4d3b0 : kind === "clock" ? 0xc44536 : kind === "adrenaline" ? 0x8fd0c6 : 0xf0e6d8;
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
  let token: THREE.Object3D;
  if (kind === "clock") {
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
  token.position.y = 0.42;
  g.add(beam, pad, token);
  return g;
}
