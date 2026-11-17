export const TW = 0.1;
export const TH = 0.178;
export const CW = 0.15;
export const CH = 0.267;
export const MW = 0.14;
export const MH = 0.249;
const INSET = 0.06;

export const DICTIONARY = 'MONITOR_4X4';
export const MARKER_IDS = [0, 1, 2, 3];
export const MARKER_CENTERS = [[CW / 2, CH / 2], [1 - CW / 2, CH / 2], [1 - CW / 2, 1 - CH / 2], [CW / 2, 1 - CH / 2]];
const MARKER_UNITS = 8;

export function ensureDictionary(AR) {
  if (!AR.DICTIONARIES[DICTIONARY]) {
    AR.DICTIONARIES[DICTIONARY] = { nBits: 16, codeList: [[181, 50], [15, 154], [51, 45], [153, 70]] };
  }
  return AR;
}

export const PATCHES = [
  { id: 'k',   rgb: [0, 0, 0] },
  { id: 'g10', rgb: [.1, .1, .1] },
  { id: 'g20', rgb: [.2, .2, .2] },
  { id: 'g30', rgb: [.3, .3, .3] },
  { id: 'g40', rgb: [.4, .4, .4] },
  { id: 'g50', rgb: [.5, .5, .5] },
  { id: 'g60', rgb: [.6, .6, .6] },
  { id: 'g80', rgb: [.8, .8, .8] },
  { id: 'w',   rgb: [1, 1, 1] },
  { id: 'r',   rgb: [1, 0, 0] },
  { id: 'g',   rgb: [0, 1, 0] },
  { id: 'b',   rgb: [0, 0, 1] },
].map((p, idx) => ({ ...p, idx }));

export const GAMMA_LEVELS = [['g20', .2], ['g30', .3], ['g40', .4], ['g50', .5], ['g60', .6], ['g80', .8]];

export function patchRects(p) {
  const n = PATCHES.length, sw = (1 - 2 * CW) / n, sh = (1 - 2 * CH) / n, i = p.idx;
  return [
    { x: CW + i * sw, y: 0, w: sw, h: TH },
    { x: CW + i * sw, y: 1 - TH, w: sw, h: TH },
    { x: 0, y: CH + i * sh, w: TW, h: sh },
    { x: 1 - TW, y: CH + i * sh, w: TW, h: sh },
  ].map(r => ({ x: r.x + r.w * INSET, y: r.y + r.h * INSET, w: r.w * (1 - 2 * INSET), h: r.h * (1 - 2 * INSET) }));
}

export function markerCorners(i) {
  const [cx, cy] = MARKER_CENTERS[i];
  const hx = MW * (MARKER_UNITS / 2 - 1) / MARKER_UNITS, hy = MH * (MARKER_UNITS / 2 - 1) / MARKER_UNITS;
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

export function patternRects(AR) {
  ensureDictionary(AR);
  const R = [];
  const add = (x, y, w, h, rgb) => R.push({ x, y, w, h, rgb });
  add(0, 0, 1, 1, [0, 0, 0]);
  for (const p of PATCHES) for (const r of patchRects(p)) add(r.x, r.y, r.w, r.h, p.rgb);

  const x0 = CW + 0.03, x1 = 1 - CW - 0.03, y0 = TH + 0.06, y1 = 1 - TH - 0.06, STEPS = 64;
  const ramps = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const bh = (y1 - y0) / ramps.length;
  ramps.forEach((c, ri) => {
    for (let s = 0; s < STEPS; s++) {
      const v = s / (STEPS - 1);
      add(x0 + (x1 - x0) * s / STEPS, y0 + ri * bh + bh * 0.1, (x1 - x0) / STEPS, bh * 0.8, c.map(k => k * v));
    }
  });

  const dict = new AR.Dictionary(DICTIONARY);
  const n = dict.markSize - 2, ux = MW / MARKER_UNITS, uy = MH / MARKER_UNITS;
  MARKER_IDS.forEach((id, i) => {
    const [cx, cy] = MARKER_CENTERS[i], mx = cx - MW / 2, my = cy - MH / 2;
    add(mx, my, MW, MH, [1, 1, 1]);
    add(mx + ux, my + uy, ux * (n + 2), uy * (n + 2), [0, 0, 0]);
    const code = dict.codeList[id];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (code[y * n + x] === '1') add(mx + (x + 2) * ux, my + (y + 2) * uy, ux, uy, [1, 1, 1]);
    }
  });
  return R;
}

const css = v => `rgb(${Math.round(v[0] * 255)},${Math.round(v[1] * 255)},${Math.round(v[2] * 255)})`;

export function drawPattern(ctx, W, H, rects, display) {
  for (const r of rects) {
    const xa = Math.round(r.x * W), xb = Math.round((r.x + r.w) * W);
    const ya = Math.round(r.y * H), yb = Math.round((r.y + r.h) * H);
    ctx.fillStyle = css(display ? display(r.rgb) : r.rgb);
    ctx.fillRect(xa, ya, xb - xa, yb - ya);
  }
}
