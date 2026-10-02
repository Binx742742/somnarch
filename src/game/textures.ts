import * as THREE from "three";

function makeCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The dream could not paint its materials.");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function speck(ctx: CanvasRenderingContext2D, size: number, amount: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n));
  }
  ctx.putImageData(img, 0, 0);
}

export type SuburbTextures = {
  siding: THREE.CanvasTexture;
  brick: THREE.CanvasTexture;
  stone: THREE.CanvasTexture;
  shingle: THREE.CanvasTexture;
  metal: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  all: THREE.Texture[];
};

export function createSuburbTextures(): SuburbTextures {
  const siding = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 22) {
      const shade = 214 + ((y / 22) % 2) * 18;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, s, 19);
      ctx.fillStyle = "#5c5c5c";
      ctx.fillRect(0, y + 19, s, 3);
    }
    speck(ctx, s, 18);
  });

  const brick = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, s, s);
    const bw = 36;
    const bh = 16;
    const gap = 3;
    for (let row = 0, y = 2; y < s; y += bh + gap, row++) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      for (let x = -bw + offset; x < s; x += bw + gap) {
        const v = 196 + Math.floor(Math.random() * 48);
        ctx.fillStyle = `rgb(${v},${v - 4},${v - 6})`;
        ctx.fillRect(x, y, bw, bh);
      }
    }
    speck(ctx, s, 14);
  });

  const stone = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = "#8d8d8d";
    ctx.fillRect(0, 0, s, s);
    let y = 2;
    let row = 0;
    while (y < s) {
      const bh = 28 + (row % 3) * 8;
      let x = row % 2 === 0 ? 2 : -20;
      while (x < s) {
        const bw = 40 + Math.floor(Math.random() * 36);
        const v = 176 + Math.floor(Math.random() * 50);
        ctx.fillStyle = `rgb(${v},${v},${v - 2})`;
        ctx.fillRect(x, y, bw - 3, bh - 3);
        x += bw;
      }
      y += bh;
      row++;
    }
    speck(ctx, s, 16);
  });

  const shingle = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = "#6e6e6e";
    ctx.fillRect(0, 0, s, s);
    const bh = 18;
    for (let row = 0, y = 0; y < s; y += bh, row++) {
      const offset = row % 2 === 0 ? 0 : 16;
      for (let x = -32 + offset; x < s; x += 32) {
        const v = 150 + Math.floor(Math.random() * 40);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + bh - 2);
        ctx.lineTo(x + 16, y + 2);
        ctx.lineTo(x + 30, y + bh - 2);
        ctx.fill();
      }
    }
  });

  const metal = makeCanvas(256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, "#8a8a8a");
    g.addColorStop(0.5, "#d0d0d0");
    g.addColorStop(1, "#7a7a7a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(40,40,40,0.45)";
    for (let y = 8; y < s; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    speck(ctx, s, 20);
  });

  const wood = makeCanvas(128, (ctx, s) => {
    ctx.fillStyle = "#c8b8a4";
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 7) {
      const v = 120 + ((x * 3) % 40);
      ctx.fillStyle = `rgba(${v},${v - 20},${v - 40},0.35)`;
      ctx.fillRect(x, 0, 2, s);
    }
    speck(ctx, s, 12);
  });

  const concrete = makeCanvas(128, (ctx, s) => {
    ctx.fillStyle = "#b7b4ae";
    ctx.fillRect(0, 0, s, s);
    speck(ctx, s, 36);
    ctx.strokeStyle = "rgba(60,60,60,0.35)";
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });

  const glow = makeCanvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,244,220,0.7)");
    g.addColorStop(1, "rgba(255,244,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  glow.wrapS = THREE.ClampToEdgeWrapping;
  glow.wrapT = THREE.ClampToEdgeWrapping;

  return {
    siding,
    brick,
    stone,
    shingle,
    metal,
    wood,
    concrete,
    glow,
    all: [siding, brick, stone, shingle, metal, wood, concrete, glow],
  };
}
