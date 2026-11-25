import * as THREE from 'three';

function hash2(x: number, y: number, seed = 1337): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, period: number, seed = 1337): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbmTile(u: number, v: number, baseFreq: number, octaves: number, seed = 1337): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(u * freq, v * freq, freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Deterministic world-space puddle mask so footsteps & floor material match!
 * Returns 0 (bone dry) to 1 (deep mirror puddle).
 */
export function sampleWorldPuddle(wx: number, wz: number): number {
  // Floor UV maps [-22..22] x [-30..10] repeated 8x10; also blend large macro puddles in center hall
  const macro =
    Math.exp(-((wx + 1.8) ** 2 * 0.08 + (wz + 8.5) ** 2 * 0.05)) * 0.95 +
    Math.exp(-((wx - 3.2) ** 2 * 0.11 + (wz + 15.5) ** 2 * 0.06)) * 0.9 +
    Math.exp(-((wx + 0.5) ** 2 * 0.09 + (wz + 2.2) ** 2 * 0.12)) * 0.8 +
    Math.exp(-((wx - 1.5) ** 2 * 0.08 + (wz + 22.0) ** 2 * 0.09)) * 0.85;
  const detail = fbmTile((((wx + 24) / 48) % 1 + 1) % 1, (((wz + 36) / 48) % 1 + 1) % 1, 8, 3, 901);
  return THREE.MathUtils.clamp((macro * 0.72 + (detail - 0.42) * 0.85), 0, 1);
}

function heightFieldToNormalCanvas(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const at = (x: number, y: number) => {
    const xx = ((x % size) + size) % size;
    const yy = ((y % size) + size) % size;
    return height[yy * size + xx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const inv = 1.0 / Math.hypot(dx, dy, dz);

      const idx = (y * size + x) * 4;
      d[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((dz * inv * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeTex(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export interface PBRMaterialTextures {
  floorAlbedo: THREE.CanvasTexture;
  floorNormal: THREE.CanvasTexture;
  floorRoughness: THREE.CanvasTexture;
  floorAlpha: THREE.CanvasTexture;

  wallAlbedo: THREE.CanvasTexture;
  wallNormal: THREE.CanvasTexture;
  wallRoughness: THREE.CanvasTexture;
  wallMetalness: THREE.CanvasTexture;

  ceilingAlbedo: THREE.CanvasTexture;
  ceilingNormal: THREE.CanvasTexture;

  hazardAlbedo: THREE.CanvasTexture;
  hazardRoughness: THREE.CanvasTexture;

  gunmetalNormal: THREE.CanvasTexture;
  stippleNormal: THREE.CanvasTexture;
  carbonAlbedo: THREE.CanvasTexture;
  carbonNormal: THREE.CanvasTexture;

  serverAlbedo: THREE.CanvasTexture;
  serverEmissive: THREE.CanvasTexture;
  serverNormal: THREE.CanvasTexture;

  bulletHoleAlbedo: THREE.CanvasTexture;
  bulletHoleNormal: THREE.CanvasTexture;
  scorchTexture: THREE.CanvasTexture;
  smokeSprite: THREE.CanvasTexture;
  glowSprite: THREE.CanvasTexture;
  muzzleStarSprite: THREE.CanvasTexture;
  holoReticle: THREE.CanvasTexture;
}

export function buildProceduralTextures(maxAnisotropy: number): PBRMaterialTextures {
  const aniso = Math.min(maxAnisotropy, 16);

  // 1. WET EPOXY CONCRETE FLOOR (512x512 tiled + macro puddle alpha map)
  const fSize = 512;
  const fHeight = new Float32Array(fSize * fSize);
  const fAlbC = document.createElement('canvas');
  fAlbC.width = fAlbC.height = fSize;
  const fRoughC = document.createElement('canvas');
  fRoughC.width = fRoughC.height = fSize;

  const fAlbCtx = fAlbC.getContext('2d')!;
  const fRoughCtx = fRoughC.getContext('2d')!;
  const fAlbImg = fAlbCtx.createImageData(fSize, fSize);
  const fRoughImg = fRoughCtx.createImageData(fSize, fSize);

  for (let y = 0; y < fSize; y++) {
    const v = y / fSize;
    for (let x = 0; x < fSize; x++) {
      const u = x / fSize;
      const n1 = fbmTile(u, v, 6, 4, 101);
      const n2 = fbmTile(u, v, 24, 3, 307);
      const micro = hash2(x, y, 509);

      // Expansion joint grooves (2x2 slab grid per tile)
      const gx = Math.min((u * 2) % 1, 1 - ((u * 2) % 1));
      const gy = Math.min((v * 2) % 1, 1 - ((v * 2) % 1));
      const groove = Math.min(gx, gy) < 0.012 ? 0.0 : 1.0;

      // Local puddle breakup inside tile
      const wetPatch = THREE.MathUtils.smoothstep(n1 * 0.78 + n2 * 0.22, 0.53, 0.68);
      const h = (n1 * 0.45 + n2 * 0.35 + micro * 0.2) * groove * (1.0 - wetPatch * 0.88);
      fHeight[y * fSize + x] = h;

      // Dark wet concrete vs dusty grey-slate concrete
      const base = (38 + n1 * 24 + n2 * 12 + (micro - 0.5) * 7) * (0.82 + 0.18 * groove);
      const wetDarken = 1.0 - wetPatch * 0.36;
      const idx = (y * fSize + x) * 4;
      fAlbImg.data[idx] = Math.round(base * 0.94 * wetDarken);
      fAlbImg.data[idx + 1] = Math.round(base * 1.0 * wetDarken);
      fAlbImg.data[idx + 2] = Math.round(base * 1.08 * wetDarken);
      fAlbImg.data[idx + 3] = 255;

      const rough = Math.round(THREE.MathUtils.lerp(205 - n2 * 35, 16, wetPatch));
      fRoughImg.data[idx] = fRoughImg.data[idx + 1] = fRoughImg.data[idx + 2] = rough;
      fRoughImg.data[idx + 3] = 255;
    }
  }
  fAlbCtx.putImageData(fAlbImg, 0, 0);
  fRoughCtx.putImageData(fRoughImg, 0, 0);
  const fNormC = heightFieldToNormalCanvas(fHeight, fSize, 2.2);

  // Macro non-repeating Puddle Alpha Map mapped across the entire 32x44m floor
  const aSize = 512;
  const fAlphaC = document.createElement('canvas');
  fAlphaC.width = fAlphaC.height = aSize;
  const fAlphaCtx = fAlphaC.getContext('2d')!;
  const fAlphaImg = fAlphaCtx.createImageData(aSize, aSize);
  for (let y = 0; y < aSize; y++) {
    // Plane geometry UV: u in [0..1] -> x in [-16..16], v in [0..1] -> z in [8..-36] (rotated -PI/2 around X)
    const wz = 8 - (1 - y / aSize) * 44;
    for (let x = 0; x < aSize; x++) {
      const wx = -16 + (x / aSize) * 32;
      const puddle = sampleWorldPuddle(wx, wz);
      // Alpha = 242 on dry concrete (almost opaque), Alpha = 96 on deep puddle (lets live Reflector shine through!)
      const alpha = Math.round(THREE.MathUtils.lerp(244, 92, puddle));
      const idx = (y * aSize + x) * 4;
      fAlphaImg.data[idx] = fAlphaImg.data[idx + 1] = fAlphaImg.data[idx + 2] = alpha;
      fAlphaImg.data[idx + 3] = 255;
    }
  }
  fAlphaCtx.putImageData(fAlphaImg, 0, 0);

  // 2. INDUSTRIAL MODULAR ARMORED WALL PANELS (512x512)
  const wSize = 512;
  const wHeight = new Float32Array(wSize * wSize);
  const wAlbC = document.createElement('canvas');
  const wRoughC = document.createElement('canvas');
  const wMetC = document.createElement('canvas');
  wAlbC.width = wAlbC.height = wRoughC.width = wRoughC.height = wMetC.width = wMetC.height = wSize;
  const wAlbCtx = wAlbC.getContext('2d')!;
  const wRoughCtx = wRoughC.getContext('2d')!;
  const wMetCtx = wMetC.getContext('2d')!;
  const wAlbImg = wAlbCtx.createImageData(wSize, wSize);
  const wRoughImg = wRoughCtx.createImageData(wSize, wSize);
  const wMetImg = wMetCtx.createImageData(wSize, wSize);

  for (let y = 0; y < wSize; y++) {
    const v = y / wSize;
    for (let x = 0; x < wSize; x++) {
      const u = x / wSize;
      const n = fbmTile(u, v, 8, 4, 733);
      const brush = valueNoise(x * 0.15, y * 1.6, 128, 811);

      // Panel seams: vertical columns + horizontal trim bands
      const pu = (u * 2) % 1;
      const pv = (v * 2) % 1;
      const edgeDist = Math.min(Math.min(pu, 1 - pu), Math.min(pv, 1 - pv));
      let panelH = THREE.MathUtils.smoothstep(edgeDist, 0.008, 0.032);

      // Corner rivets
      const ru = Math.min(Math.abs(pu - 0.06), Math.abs(pu - 0.94));
      const rv = Math.min(Math.abs(pv - 0.07), Math.abs(pv - 0.93));
      const rivetDist = Math.hypot(ru, rv);
      if (rivetDist < 0.016) {
        panelH += (1.0 - rivetDist / 0.016) * 0.45;
      }

      // Horizontal structural rib band across middle
      const rib = Math.abs(v - 0.52) < 0.045 ? 0.72 : 1.0;
      const grimeBottom = THREE.MathUtils.smoothstep(v, 0.98, 0.74); // darker grime near floor (v near 1)

      wHeight[y * wSize + x] = panelH * rib * 0.75 + n * 0.18 + brush * 0.07;

      const isMetalTrim = rib < 1.0 || edgeDist < 0.025 || rivetDist < 0.016;
      const baseVal = (isMetalTrim ? 66 : 52) + n * 18 + (brush - 0.5) * 10;
      const ao = (0.58 + 0.42 * panelH) * (0.65 + 0.35 * grimeBottom);

      const idx = (y * wSize + x) * 4;
      wAlbImg.data[idx] = Math.round(baseVal * 0.92 * ao);
      wAlbImg.data[idx + 1] = Math.round(baseVal * 0.98 * ao);
      wAlbImg.data[idx + 2] = Math.round(baseVal * 1.08 * ao);
      wAlbImg.data[idx + 3] = 255;

      const rough = isMetalTrim ? 95 + n * 45 : 155 + n * 50;
      wRoughImg.data[idx] = wRoughImg.data[idx + 1] = wRoughImg.data[idx + 2] = Math.round(rough);
      wRoughImg.data[idx + 3] = 255;

      const met = isMetalTrim ? 215 : 85;
      wMetImg.data[idx] = wMetImg.data[idx + 1] = wMetImg.data[idx + 2] = met;
      wMetImg.data[idx + 3] = 255;
    }
  }
  wAlbCtx.putImageData(wAlbImg, 0, 0);
  wRoughCtx.putImageData(wRoughImg, 0, 0);
  wMetCtx.putImageData(wMetImg, 0, 0);
  const wNormC = heightFieldToNormalCanvas(wHeight, wSize, 3.0);

  // 3. RIBBED INDUSTRIAL CEILING DECK
  const cSize = 256;
  const cHeight = new Float32Array(cSize * cSize);
  const cAlbC = document.createElement('canvas');
  cAlbC.width = cAlbC.height = cSize;
  const cAlbCtx = cAlbC.getContext('2d')!;
  const cAlbImg = cAlbCtx.createImageData(cSize, cSize);
  for (let y = 0; y < cSize; y++) {
    for (let x = 0; x < cSize; x++) {
      const rib = 0.5 + 0.5 * Math.cos((x / cSize) * Math.PI * 16);
      const n = fbmTile(x / cSize, y / cSize, 8, 3, 419);
      cHeight[y * cSize + x] = rib * 0.75 + n * 0.25;
      const val = Math.round((26 + rib * 18 + n * 10));
      const idx = (y * cSize + x) * 4;
      cAlbImg.data[idx] = Math.round(val * 0.92);
      cAlbImg.data[idx + 1] = val;
      cAlbImg.data[idx + 2] = Math.round(val * 1.1);
      cAlbImg.data[idx + 3] = 255;
    }
  }
  cAlbCtx.putImageData(cAlbImg, 0, 0);
  const cNormC = heightFieldToNormalCanvas(cHeight, cSize, 2.8);

  // 4. CHIPPED YELLOW/BLACK HAZARD STRIPE
  const hzSize = 256;
  const hzAlbC = document.createElement('canvas');
  const hzRoughC = document.createElement('canvas');
  hzAlbC.width = hzAlbC.height = hzRoughC.width = hzRoughC.height = hzSize;
  const hzCtx = hzAlbC.getContext('2d')!;
  const hzRCtx = hzRoughC.getContext('2d')!;
  const hzImg = hzCtx.createImageData(hzSize, hzSize);
  const hzRImg = hzRCtx.createImageData(hzSize, hzSize);
  for (let y = 0; y < hzSize; y++) {
    for (let x = 0; x < hzSize; x++) {
      const stripe = ((x + y) % 64) < 32;
      const wear = fbmTile(x / hzSize, y / hzSize, 12, 3, 613);
      const chipped = wear > 0.69;
      const idx = (y * hzSize + x) * 4;
      if (chipped) {
        hzImg.data[idx] = 135;
        hzImg.data[idx + 1] = 140;
        hzImg.data[idx + 2] = 148;
      } else if (stripe) {
        hzImg.data[idx] = Math.round(218 - wear * 35);
        hzImg.data[idx + 1] = Math.round(156 - wear * 30);
        hzImg.data[idx + 2] = 24;
      } else {
        hzImg.data[idx] = 24;
        hzImg.data[idx + 1] = 26;
        hzImg.data[idx + 2] = 30;
      }
      hzImg.data[idx + 3] = 255;
      const r = chipped ? 65 : 150;
      hzRImg.data[idx] = hzRImg.data[idx + 1] = hzRImg.data[idx + 2] = r;
      hzRImg.data[idx + 3] = 255;
    }
  }
  hzCtx.putImageData(hzImg, 0, 0);
  hzRCtx.putImageData(hzRImg, 0, 0);

  // 5. CNC BRUSHED GUNMETAL NORMAL + POLYMER DIAMOND STIPPLING + CARBON FIBER
  const gmSize = 256;
  const gmHeight = new Float32Array(gmSize * gmSize);
  const stHeight = new Float32Array(gmSize * gmSize);
  const cbHeight = new Float32Array(gmSize * gmSize);
  const cbAlbC = document.createElement('canvas');
  cbAlbC.width = cbAlbC.height = gmSize;
  const cbCtx = cbAlbC.getContext('2d')!;
  const cbImg = cbCtx.createImageData(gmSize, gmSize);

  for (let y = 0; y < gmSize; y++) {
    for (let x = 0; x < gmSize; x++) {
      // Fine CNC toolpath + brushed linear grain
      gmHeight[y * gmSize + x] =
        valueNoise(x * 0.08, y * 1.9, 64, 211) * 0.7 +
        Math.sin((x + y * 0.2) * 0.55) * 0.15 +
        hash2(x, y, 223) * 0.15;

      // Tactical grip diamond knurling
      const dx = Math.abs((((x + y) * 0.12) % 1) - 0.5) * 2;
      const dy = Math.abs((((x - y + 512) * 0.12) % 1) - 0.5) * 2;
      stHeight[y * gmSize + x] = Math.min(dx, dy);

      // Carbon fiber weave
      const wx = Math.floor(x / 4) % 2;
      const wy = Math.floor(y / 4) % 2;
      const weave = (wx ^ wy) ? 0.78 : 0.32;
      cbHeight[y * gmSize + x] = weave;
      const cv = Math.round(22 + weave * 24);
      const idx = (y * gmSize + x) * 4;
      cbImg.data[idx] = cv;
      cbImg.data[idx + 1] = cv + 2;
      cbImg.data[idx + 2] = cv + 5;
      cbImg.data[idx + 3] = 255;
    }
  }
  cbCtx.putImageData(cbImg, 0, 0);
  const gmNormC = heightFieldToNormalCanvas(gmHeight, gmSize, 1.4);
  const stNormC = heightFieldToNormalCanvas(stHeight, gmSize, 2.6);
  const cbNormC = heightFieldToNormalCanvas(cbHeight, gmSize, 1.8);

  // 6. SERVER RACK BLADE PANEL + EMISSIVE LEDS
  const sSize = 512;
  const sAlbC = document.createElement('canvas');
  const sEmC = document.createElement('canvas');
  const sHeight = new Float32Array(sSize * sSize);
  sAlbC.width = sAlbC.height = sEmC.width = sEmC.height = sSize;
  const sCtx = sAlbC.getContext('2d')!;
  const sEmCtx = sEmC.getContext('2d')!;

  sCtx.fillStyle = '#141920';
  sCtx.fillRect(0, 0, sSize, sSize);
  sEmCtx.fillStyle = '#000000';
  sEmCtx.fillRect(0, 0, sSize, sSize);

  // 12 horizontal blade units
  for (let row = 0; row < 12; row++) {
    const ry = row * 42 + 6;
    sCtx.fillStyle = '#1d242e';
    sCtx.fillRect(14, ry, sSize - 28, 36);
    sCtx.strokeStyle = '#0b0e13';
    sCtx.lineWidth = 2;
    sCtx.strokeRect(14, ry, sSize - 28, 36);

    // Ventilation slots
    sCtx.fillStyle = '#090c10';
    for (let vx = 32; vx < 330; vx += 10) {
      sCtx.fillRect(vx, ry + 8, 5, 20);
    }

    // Status LEDs (cyan, green, amber)
    for (let l = 0; l < 6; l++) {
      const rVal = hash2(row, l, 991);
      if (rVal > 0.22) {
        const col = rVal > 0.86 ? '#ff9d2e' : rVal > 0.48 ? '#28e8ff' : '#35ff9a';
        sEmCtx.fillStyle = col;
        sEmCtx.fillRect(356 + l * 18, ry + 14, 9, 7);
        sCtx.fillStyle = col;
        sCtx.fillRect(356 + l * 18, ry + 14, 9, 7);
      }
    }
  }
  for (let y = 0; y < sSize; y++) {
    const inSlot = (y % 42) > 6 && (y % 42) < 40 ? 0.8 : 0.2;
    for (let x = 0; x < sSize; x++) {
      const grill = x > 32 && x < 330 && (x % 10) < 5 ? 0.1 : 1.0;
      sHeight[y * sSize + x] = inSlot * grill;
    }
  }
  const sNormC = heightFieldToNormalCanvas(sHeight, sSize, 2.4);

  // 7. BULLET HOLE DECAL + SCORCH + SOFT SMOKE + MUZZLE STAR + HOLO RETICLE
  const bhSize = 128;
  const bhAlbC = document.createElement('canvas');
  const bhHeight = new Float32Array(bhSize * bhSize);
  bhAlbC.width = bhAlbC.height = bhSize;
  const bhCtx = bhAlbC.getContext('2d')!;
  const bhImg = bhCtx.createImageData(bhSize, bhSize);
  for (let y = 0; y < bhSize; y++) {
    for (let x = 0; x < bhSize; x++) {
      const dx = (x / bhSize - 0.5) * 2;
      const dy = (y / bhSize - 0.5) * 2;
      const ang = Math.atan2(dy, dx);
      const jag = fbmTile((ang + Math.PI) / (Math.PI * 2), Math.hypot(dx, dy) * 0.5, 8, 3, 555);
      const r = Math.hypot(dx, dy) + (jag - 0.5) * 0.26;
      const idx = (y * bhSize + x) * 4;
      if (r < 0.24) {
        bhImg.data[idx] = 8;
        bhImg.data[idx + 1] = 9;
        bhImg.data[idx + 2] = 11;
        bhImg.data[idx + 3] = 250;
        bhHeight[y * bhSize + x] = 0.0;
      } else if (r < 0.62) {
        const rim = 1.0 - (r - 0.24) / 0.38;
        const v = Math.round(48 + jag * 45);
        bhImg.data[idx] = v;
        bhImg.data[idx + 1] = v + 2;
        bhImg.data[idx + 2] = v + 4;
        bhImg.data[idx + 3] = Math.round(rim * 220);
        bhHeight[y * bhSize + x] = 0.5 + rim * 0.5;
      } else {
        bhImg.data[idx + 3] = 0;
        bhHeight[y * bhSize + x] = 0.5;
      }
    }
  }
  bhCtx.putImageData(bhImg, 0, 0);
  const bhNormC = heightFieldToNormalCanvas(bhHeight, bhSize, 3.0);

  // Scorch mark
  const scC = document.createElement('canvas');
  scC.width = scC.height = 256;
  const scCtx = scC.getContext('2d')!;
  const scGrad = scCtx.createRadialGradient(128, 128, 8, 128, 128, 122);
  scGrad.addColorStop(0, 'rgba(5, 5, 6, 0.95)');
  scGrad.addColorStop(0.45, 'rgba(14, 12, 10, 0.72)');
  scGrad.addColorStop(1, 'rgba(10, 10, 10, 0)');
  scCtx.fillStyle = scGrad;
  scCtx.fillRect(0, 0, 256, 256);

  // Soft volumetric smoke puff
  const smC = document.createElement('canvas');
  smC.width = smC.height = 128;
  const smCtx = smC.getContext('2d')!;
  const smImg = smCtx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x / 128 - 0.5) * 2;
      const dy = (y / 128 - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      const n = fbmTile(x / 128, y / 128, 4, 3, 777);
      const a = THREE.MathUtils.clamp((1 - r) * (0.55 + n * 0.65), 0, 1);
      const idx = (y * 128 + x) * 4;
      smImg.data[idx] = 225;
      smImg.data[idx + 1] = 234;
      smImg.data[idx + 2] = 245;
      smImg.data[idx + 3] = Math.round(a * a * 185);
    }
  }
  smCtx.putImageData(smImg, 0, 0);

  // Radial glow sprite
  const glC = document.createElement('canvas');
  glC.width = glC.height = 128;
  const glCtx = glC.getContext('2d')!;
  const glGrad = glCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glGrad.addColorStop(0, 'rgba(255,255,255,1)');
  glGrad.addColorStop(0.25, 'rgba(255,235,195,0.72)');
  glGrad.addColorStop(0.6, 'rgba(255,160,70,0.2)');
  glGrad.addColorStop(1, 'rgba(0,0,0,0)');
  glCtx.fillStyle = glGrad;
  glCtx.fillRect(0, 0, 128, 128);

  // 4-lobe Muzzle Brake Star Flash
  const mzC = document.createElement('canvas');
  mzC.width = mzC.height = 256;
  const mzCtx = mzC.getContext('2d')!;
  mzCtx.translate(128, 128);
  for (let i = 0; i < 6; i++) {
    mzCtx.save();
    mzCtx.rotate((i * Math.PI) / 3 + (i % 2) * 0.15);
    const g = mzCtx.createLinearGradient(0, 0, 120, 0);
    g.addColorStop(0, 'rgba(255, 250, 230, 1)');
    g.addColorStop(0.35, 'rgba(255, 175, 65, 0.85)');
    g.addColorStop(1, 'rgba(255, 90, 10, 0)');
    mzCtx.fillStyle = g;
    mzCtx.beginPath();
    mzCtx.ellipse(48, 0, 72, 13, 0, 0, Math.PI * 2);
    mzCtx.fill();
    mzCtx.restore();
  }
  const coreG = mzCtx.createRadialGradient(0, 0, 0, 0, 0, 44);
  coreG.addColorStop(0, 'rgba(255,255,255,1)');
  coreG.addColorStop(0.5, 'rgba(255,210,120,0.85)');
  coreG.addColorStop(1, 'rgba(255,120,20,0)');
  mzCtx.fillStyle = coreG;
  mzCtx.beginPath();
  mzCtx.arc(0, 0, 44, 0, Math.PI * 2);
  mzCtx.fill();

  // EOTech Holographic Circle-Dot Reticle (256x256)
  const hrC = document.createElement('canvas');
  hrC.width = hrC.height = 256;
  const hrCtx = hrC.getContext('2d')!;
  hrCtx.strokeStyle = '#ff2a2a';
  hrCtx.shadowColor = '#ff1122';
  hrCtx.shadowBlur = 10;
  hrCtx.lineWidth = 4;
  hrCtx.beginPath();
  hrCtx.arc(128, 128, 56, 0, Math.PI * 2);
  hrCtx.stroke();
  // 4 cardinal stadia ticks
  const ticks = [
    [128, 58, 128, 76],
    [128, 180, 128, 198],
    [58, 128, 76, 128],
    [180, 128, 198, 128]
  ];
  for (const [x1, y1, x2, y2] of ticks) {
    hrCtx.beginPath();
    hrCtx.moveTo(x1, y1);
    hrCtx.lineTo(x2, y2);
    hrCtx.stroke();
  }
  // Crisp 1-MOA center aiming dot + BDC drop dot
  hrCtx.fillStyle = '#ff4444';
  hrCtx.beginPath();
  hrCtx.arc(128, 128, 4.2, 0, Math.PI * 2);
  hrCtx.fill();
  hrCtx.beginPath();
  hrCtx.arc(128, 148, 2.4, 0, Math.PI * 2);
  hrCtx.fill();

  const floorAlpha = new THREE.CanvasTexture(fAlphaC);
  floorAlpha.wrapS = THREE.ClampToEdgeWrapping;
  floorAlpha.wrapT = THREE.ClampToEdgeWrapping;
  floorAlpha.needsUpdate = true;

  const clampTex = (c: HTMLCanvasElement, cs: THREE.ColorSpace = THREE.SRGBColorSpace) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = cs;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };

  return {
    floorAlbedo: makeTex(fAlbC, aniso, THREE.SRGBColorSpace, 10, 14),
    floorNormal: makeTex(fNormC, aniso, THREE.NoColorSpace, 10, 14),
    floorRoughness: makeTex(fRoughC, aniso, THREE.NoColorSpace, 10, 14),
    floorAlpha,

    wallAlbedo: makeTex(wAlbC, aniso, THREE.SRGBColorSpace, 1, 1),
    wallNormal: makeTex(wNormC, aniso, THREE.NoColorSpace, 1, 1),
    wallRoughness: makeTex(wRoughC, aniso, THREE.NoColorSpace, 1, 1),
    wallMetalness: makeTex(wMetC, aniso, THREE.NoColorSpace, 1, 1),

    ceilingAlbedo: makeTex(cAlbC, aniso, THREE.SRGBColorSpace, 8, 12),
    ceilingNormal: makeTex(cNormC, aniso, THREE.NoColorSpace, 8, 12),

    hazardAlbedo: makeTex(hzAlbC, aniso, THREE.SRGBColorSpace, 4, 1),
    hazardRoughness: makeTex(hzRoughC, aniso, THREE.NoColorSpace, 4, 1),

    gunmetalNormal: makeTex(gmNormC, aniso, THREE.NoColorSpace, 3, 3),
    stippleNormal: makeTex(stNormC, aniso, THREE.NoColorSpace, 4, 4),
    carbonAlbedo: makeTex(cbAlbC, aniso, THREE.SRGBColorSpace, 6, 6),
    carbonNormal: makeTex(cbNormC, aniso, THREE.NoColorSpace, 6, 6),

    serverAlbedo: clampTex(sAlbC, THREE.SRGBColorSpace),
    serverEmissive: clampTex(sEmC, THREE.SRGBColorSpace),
    serverNormal: clampTex(sNormC, THREE.NoColorSpace),

    bulletHoleAlbedo: clampTex(bhAlbC, THREE.SRGBColorSpace),
    bulletHoleNormal: clampTex(bhNormC, THREE.NoColorSpace),
    scorchTexture: clampTex(scC, THREE.SRGBColorSpace),
    smokeSprite: clampTex(smC, THREE.SRGBColorSpace),
    glowSprite: clampTex(glC, THREE.SRGBColorSpace),
    muzzleStarSprite: clampTex(mzC, THREE.SRGBColorSpace),
    holoReticle: clampTex(hrC, THREE.SRGBColorSpace)
  };
}

/**
 * Generates crisp industrial wall signage / stencil plates ("SECTOR-09", etc.)
 */
export function makeStencilSignTexture(title: string, sub: string, accent = '#ffb038'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111720';
  ctx.fillRect(0, 0, 512, 192);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 176);

  ctx.fillStyle = accent;
  ctx.fillRect(18, 22, 10, 148);

  ctx.font = 'bold 42px Bahnschrift, Consolas, sans-serif';
  ctx.fillStyle = '#edf5ff';
  ctx.fillText(title, 44, 86);

  ctx.font = '20px Consolas, monospace';
  ctx.fillStyle = accent;
  ctx.fillText(sub, 44, 134);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
