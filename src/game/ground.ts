import * as THREE from "three";
import { BLOCKS, BOUNDARY } from "./level";
import { DIRT, ROAD, STRIPS, driveFronts } from "./roads";

const HOUSES = BLOCKS.length;

function stripsGlsl(
  name: string,
  strips: ReadonlyArray<{ axis: number; fixed: number; half: number; min: number; max: number }>,
  widen: string,
): string {
  return strips
    .map(
      (s) =>
        `${name} += boxStrip(p, ${s.fixed.toFixed(2)}, ${(s.half).toFixed(2)} + ${widen}, ${s.min.toFixed(2)}, ${s.max.toFixed(2)}, ${s.axis.toFixed(1)});`,
    )
    .join("\n    ");
}

const FRAGMENT_FN = /* glsl */ `
float suburbHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float suburbNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(suburbHash(i), suburbHash(i + vec2(1.0, 0.0)), u.x),
    mix(suburbHash(i + vec2(0.0, 1.0)), suburbHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float suburbFbm(vec2 p) {
  return suburbNoise(p) * 0.56 + suburbNoise(p * 2.17) * 0.28 + suburbNoise(p * 4.31) * 0.16;
}
float boxStrip(vec2 p, float fixedC, float halfW, float a, float b, float axis) {
  float lat = axis < 0.5 ? p.y - fixedC : p.x - fixedC;
  float lon = axis < 0.5 ? p.x : p.y;
  return step(abs(lat), halfW) * step(a, lon) * step(lon, b);
}
float stripMask(vec2 p, float widen) {
  float m = 0.0;
  ${stripsGlsl("m", STRIPS, "widen")}
  return clamp(m, 0.0, 1.0);
}
float dirtMask(vec2 p) {
  float m = 0.0;
  ${stripsGlsl("m", DIRT, "0.0")}
  return clamp(m, 0.0, 1.0);
}
float padMask(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < ${HOUSES}; i++) {
    vec2 d = abs(p - uHouses[i].xy) - uHouses[i].zw - vec2(0.35);
    m = max(m, step(max(d.x, d.y), 0.0));
  }
  return m;
}
float driveMask(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < ${HOUSES}; i++) {
    vec2 d = p - uDrives[i].xy;
    float along = dot(d, uDrives[i].zw);
    float side = abs(d.x * uDrives[i].w - d.y * uDrives[i].z);
    m = max(m, step(0.2, along) * step(along, ${ROAD.driveReach.toFixed(1)}) * step(side, ${ROAD.driveHalf.toFixed(2)}));
  }
  return m;
}
float asphaltMask(vec2 p) {
  float r = length(p);
  float bulb = step(${ROAD.bulbIn.toFixed(2)}, r) * step(r, ${ROAD.bulbOut.toFixed(2)});
  return clamp(bulb + stripMask(p, 0.0), 0.0, 1.0);
}
float walkMask(vec2 p) {
  float r = length(p);
  float ring = step(${ROAD.bulbOut.toFixed(2)}, r) * step(r, ${ROAD.walkOut.toFixed(2)});
  return clamp(ring + stripMask(p, ${ROAD.walkExtra.toFixed(2)}), 0.0, 1.0);
}
bool gReady = false;
float gAsp, gWalk, gDirt, gDrive, gPad, gIsland, gN, gR;
void prep(vec3 w) {
  if (gReady) return;
  gReady = true;
  vec2 p = w.xz;
  gR = length(p);
  gN = suburbNoise(p * 0.37);
  gAsp = asphaltMask(p);
  gWalk = walkMask(p);
  gDirt = dirtMask(p);
  gDrive = driveMask(p);
  gPad = padMask(p);
  gIsland = step(gR, ${ROAD.bulbIn.toFixed(2)});
}
vec3 suburbAlbedo(vec3 w) {
  prep(w);
  vec2 p = w.xz;
  vec3 dead = vec3(0.03, 0.036, 0.022);
  vec3 dry = vec3(0.078, 0.064, 0.034);
  vec3 col = mix(dead, dry, smoothstep(0.38, 0.74, gN));
  col = mix(col, vec3(0.055, 0.034, 0.024), smoothstep(0.62, 0.9, suburbNoise(p * 1.7)));
  col = mix(col, vec3(0.065, 0.046, 0.03), gDirt);
  col = mix(col, vec3(0.05, 0.046, 0.042), gDrive);
  vec3 walk = vec3(0.095, 0.09, 0.082);
  float seam = step(0.92, fract(p.x * 0.7)) + step(0.92, fract(p.y * 0.7));
  walk *= mix(1.0, 0.72, clamp(seam, 0.0, 1.0));
  col = mix(col, walk, gWalk);
  vec3 asp = mix(vec3(0.02, 0.019, 0.02), vec3(0.04, 0.038, 0.037), gN);
  float crack = 1.0 - smoothstep(0.0, 0.02, abs(suburbNoise(p * 0.28) - 0.5));
  asp = mix(asp, asp * 0.5, crack);
  float lane = step(abs(p.y + 5.5), 0.07) * step(abs(p.x), 14.0);
  lane = max(lane, step(abs(p.x), 0.07) * step(p.y, 16.5) * step(4.5, p.y));
  asp = mix(asp, asp * 1.7, lane * step(0.45, fract(max(abs(p.x), abs(p.y)) * 0.4)));
  col = mix(col, asp, gAsp);
  float curb = step(abs(gR - ${ROAD.bulbOut.toFixed(2)}), 0.14) * step(${ROAD.bulbIn.toFixed(2)}, gR);
  col = mix(col, vec3(0.11, 0.1, 0.09), curb * (1.0 - gPad));
  vec3 bone = mix(vec3(0.2, 0.17, 0.13), vec3(0.12, 0.095, 0.08), gN);
  bone = mix(bone, vec3(0.16, 0.04, 0.035), smoothstep(0.55, 0.95, abs(sin(gR * 3.4))) * smoothstep(3.2, 1.2, gR));
  col = mix(col, bone, gIsland);
  col = mix(col, vec3(0.038, 0.035, 0.032), gPad);
  float ao = 1.0;
  for (int i = 0; i < ${HOUSES}; i++) {
    vec2 q = abs(p - uHouses[i].xy) - uHouses[i].zw;
    float inside = max(q.x, q.y);
    float dist = length(max(q, 0.0));
    ao *= inside < 0.0 ? 0.0 : smoothstep(0.0, 1.6, dist);
  }
  col *= mix(0.58, 1.0, ao);
  col = mix(col, vec3(0.012, 0.008, 0.01), smoothstep(${(BOUNDARY - 12).toFixed(1)}, ${(BOUNDARY + 4).toFixed(1)}, gR));
  return col;
}
float suburbRough(vec3 w) {
  prep(w);
  float rough = 0.96;
  rough = mix(rough, 0.9, gDrive);
  rough = mix(rough, 0.88, gWalk);
  rough = mix(rough, 0.64, gAsp);
  rough = mix(rough, 0.8, gIsland);
  rough = mix(rough, 0.93, gPad);
  return rough;
}
float suburbMetal(vec3 w) {
  prep(w);
  return gAsp * 0.12;
}
`;

export function createGround(radius: number): THREE.Mesh {
  const houses = BLOCKS.map((b) => new THREE.Vector4(b.x, b.z, b.w * 0.5, b.d * 0.5));
  const drives = driveFronts().map((d) => new THREE.Vector4(d.x, d.z, d.nx, d.nz));
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.02,
  });
  mat.customProgramCacheKey = () => "somnarch-ground-v4";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHouses = { value: houses };
    shader.uniforms.uDrives = { value: drives };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "varying vec3 vSuburbWorld;\n#include <common>")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvSuburbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `varying vec3 vSuburbWorld;\nuniform vec4 uHouses[${HOUSES}];\nuniform vec4 uDrives[${HOUSES}];\n#include <common>`,
      )
      .replace("void main() {", `${FRAGMENT_FN}\nvoid main() {`)
      .replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.rgb = suburbAlbedo(vSuburbWorld);")
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\n\troughnessFactor = suburbRough(vSuburbWorld);\n\tmetalnessFactor = suburbMetal(vSuburbWorld);",
      );
  };

  const geo = new THREE.CircleGeometry(radius, 96);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = "suburb-ground";
  return mesh;
}
