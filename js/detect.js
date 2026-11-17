import { homography, sortQuad, isConvexClockwise, perimeter, center, UNIT } from './geometry.js';
import { MARKER_IDS, DICTIONARY, markerCorners, ensureDictionary } from './pattern.js';

function upscale(img, s) {
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const out = new Uint8ClampedArray(w * h * 4), src = img.data, W = img.width, H = img.height;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / s - 0.5)), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / s - 0.5)), x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * W + x0) * 4 + c], b = src[(y0 * W + x1) * 4 + c];
        const d = src[(y1 * W + x0) * 4 + c], e = src[(y1 * W + x1) * 4 + c];
        out[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

export function resize(img, s) {
  if (s > 1) return upscale(img, s);
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4), src = img.data;
  const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4;
        r += src[o]; g += src[o + 1]; b += src[o + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

export function detectMarkers(AR, img) {
  ensureDictionary(AR);
  const detector = new AR.Detector({ dictionaryName: DICTIONARY });
  const maxDim = Math.max(img.width, img.height);
  const dims = [...new Set([Math.min(maxDim, 3000), 2000, 1400, 1000, Math.max(maxDim, 2000)])]
    .filter(d => d <= Math.max(maxDim, 2000)).sort((a, b) => b - a);
  const found = [];
  for (const d of dims) {
    if (MARKER_IDS.every(id => found.filter(f => f.id === id).length >= 2)) break;
    const s = d / maxDim;
    const im = Math.abs(s - 1) > 0.001 ? resize(img, s) : img;
    for (const m of detector.detect(im)) {
      if (!MARKER_IDS.includes(m.id)) continue;
      const corners = m.corners.map(c => [c.x / s, c.y / s]);
      const c = center(corners), size = perimeter(corners) / 4;
      if (found.some(f => f.id === m.id && Math.hypot(f.center[0] - c[0], f.center[1] - c[1]) < size * 0.5)) continue;
      found.push({ id: m.id, corners, center: c, size });
    }
  }
  return found;
}

export function findScreens(markers) {
  const byId = MARKER_IDS.map(id => markers.filter(m => m.id === id).sort((a, b) => b.size - a.size).slice(0, 2));
  const counts = byId.map(a => a.length);
  if (counts.some(c => c < 2)) return { ok: false, counts };
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const A = [byId[0][0]], B = [byId[0][1]];
    for (let k = 1; k < 4; k++) {
      const bit = (mask >> (k - 1)) & 1;
      A.push(byId[k][bit]); B.push(byId[k][1 - bit]);
    }
    const qa = A.map(m => m.center), qb = B.map(m => m.center);
    if (!isConvexClockwise(qa) || !isConvexClockwise(qb)) continue;
    const score = perimeter(qa) + perimeter(qb);
    if (!best || score < best.score) best = { score, groups: [A, B] };
  }
  if (!best) return { ok: false, counts };
  return { ok: true, counts, groups: best.groups };
}

export function screenCorners(group) {
  const src = [], dst = [];
  group.forEach((m, i) => { src.push(...markerCorners(i)); dst.push(...sortQuad(m.corners)); });
  const H = homography(src, dst);
  return H ? UNIT.map(([u, v]) => H(u, v)) : null;
}

export function locateScreens(AR, img) {
  const markers = detectMarkers(AR, img);
  const res = findScreens(markers);
  if (!res.ok) return { ok: false, counts: res.counts, markers };
  const quads = res.groups.map(screenCorners);
  if (quads.some(q => !q)) return { ok: false, counts: res.counts, markers };
  return { ok: true, quads, markers };
}
