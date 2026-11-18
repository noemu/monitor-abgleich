import { homography, UNIT } from './geometry.js';

const toSrgb = l => { l = Math.min(1, Math.max(0, l)); return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; };

export function makeDisplay({ gain = [1, 1, 1], gamma = 2.2, black = 0.003, exposure = 0.8, contrast = 1 } = {}) {
  return rgb => rgb.map((v, c) => toSrgb(exposure * (black + (1 - black) * gain[c] * Math.pow(Math.min(1, v * contrast), gamma))));
}

export function rasterize(rects, W, H, display) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (const r of rects) {
    const col = (display ? display(r.rgb) : r.rgb).map(v => Math.round(v * 255));
    const xa = Math.round(r.x * W), xb = Math.round((r.x + r.w) * W);
    const ya = Math.round(r.y * H), yb = Math.round((r.y + r.h) * H);
    for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) for (let x = Math.max(0, xa); x < Math.min(W, xb); x++) {
      const o = (y * W + x) * 4;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthPhoto({ width, height, monitors, rects, noise = 5, blur = true, seed = 1 }) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const desk = y > height * 0.8;
    const t = y / height;
    const base = desk ? [45, 42, 39] : [36 - 16 * t, 38 - 16 * t, 43 - 16 * t];
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = base[0]; out[o + 1] = base[1]; out[o + 2] = base[2]; out[o + 3] = 255;
    }
  }
  for (const m of monitors) {
    const pat = rasterize(rects, 960, 540, makeDisplay(m.display));
    const inv = homography(m.corners, UNIT);
    const xs = m.corners.map(p => p[0]), ys = m.corners.map(p => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - 30)), x1 = Math.min(width, Math.ceil(Math.max(...xs) + 30));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - 30)), y1 = Math.min(height, Math.ceil(Math.max(...ys) + 30));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const [u, v] = inv(x + 0.5, y + 0.5);
      if (u < -0.025 || u > 1.025 || v < -0.04 || v > 1.04) continue;
      const o = (y * width + x) * 4;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) { out[o] = 10; out[o + 1] = 10; out[o + 2] = 11; continue; }
      const po = (Math.floor(v * pat.height) * pat.width + Math.floor(u * pat.width)) * 4;
      out[o] = pat.data[po]; out[o + 1] = pat.data[po + 1]; out[o + 2] = pat.data[po + 2];
    }
  }
  let data = out;
  if (blur) {
    data = new Uint8ClampedArray(out.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          s += out[(yy * width + xx) * 4 + c]; n++;
        }
        data[o + c] = s / n;
      }
      data[o + 3] = 255;
    }
  }
  if (noise) {
    const rand = rng(seed);
    for (let i = 0; i < data.length; i += 4) {
      data[i] += (rand() - 0.5) * noise; data[i + 1] += (rand() - 0.5) * noise; data[i + 2] += (rand() - 0.5) * noise;
    }
  }
  return { width, height, data };
}

export const DEMO = {
  width: 1600,
  height: 900,
  monitors: [
    { corners: [[150, 262], [760, 215], [770, 585], [160, 612]], display: { gain: [1, 1, 1], gamma: 2.2, black: 0.003, exposure: 0.8 } },
    { corners: [[840, 215], [1450, 262], [1440, 612], [830, 585]], display: { gain: [1.2, 1.12, 1], gamma: 2.0, black: 0.006, exposure: 0.8 } },
  ],
};
