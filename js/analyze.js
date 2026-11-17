import { PATCHES, GAMMA_LEVELS, patchRects } from './pattern.js';
import { homography, center, UNIT } from './geometry.js';

export const LUMA = [0.2126, 0.7152, 0.0722];
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luma = v => v[0] * LUMA[0] + v[1] * LUMA[1] + v[2] * LUMA[2];

function samplePatch(img, H, p) {
  const N = 7, vals = [[], [], []];
  for (const r of patchRects(p)) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [x, y] = H(r.x + r.w * (0.3 + 0.4 * i / (N - 1)), r.y + r.h * (0.3 + 0.4 * j / (N - 1)));
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) continue;
    const o = (yi * img.width + xi) * 4;
    vals[0].push(img.data[o]); vals[1].push(img.data[o + 1]); vals[2].push(img.data[o + 2]);
  }
  return vals.map(a => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[a.length >> 1]; });
}

export function measure(img, quad) {
  const H = homography(UNIT, quad);
  if (!H) return null;
  const raw = {}, lin = {};
  for (const p of PATCHES) {
    raw[p.id] = samplePatch(img, H, p);
    lin[p.id] = raw[p.id].map(c => toLin(c / 255));
  }
  const W = lin.w, K = lin.k, yW = luma(W), yK = luma(K);
  let gs = 0, gn = 0;
  for (const [id, lv] of GAMMA_LEVELS) {
    const yn = (luma(lin[id]) - yK) / (yW - yK);
    if (yn > 0.002 && yn < 0.999) { gs += Math.log(yn) / Math.log(lv); gn++; }
  }
  const purity = ['r', 'g', 'b'].map((id, c) => {
    const n = lin[id].map((v, k) => (v - K[k]) / Math.max(1e-6, W[k] - K[k]));
    const others = n.filter((_, k) => k !== c);
    return n[c] > 0.02 ? 1 - Math.max(...others) / n[c] : 0;
  });
  const mid = lin.g50.map((v, k) => (v - K[k]) / Math.max(1e-6, W[k] - K[k]));
  const [cx, cy] = center(quad);
  return {
    raw, lin, W, K, yW, yK, cx, cy,
    gamma: gn ? gs / gn : NaN,
    purity: (purity[0] + purity[1] + purity[2]) / 3,
    mid,
    clipped: raw.w.some(c => c >= 250),
    dark: Math.max(...raw.w) < 90,
    blackRaw: Math.max(...raw.k),
  };
}

export function names(ms) {
  const dx = Math.abs(ms[0].cx - ms[1].cx), dy = Math.abs(ms[0].cy - ms[1].cy);
  if (dx >= dy) return ms[0].cx < ms[1].cx ? ['Links', 'Rechts'] : ['Rechts', 'Links'];
  return ms[0].cy < ms[1].cy ? ['Oben', 'Unten'] : ['Unten', 'Oben'];
}

export const fmt = (n, d = 0) => n.toFixed(d).replace('.', ',').replace('-', '−');

export function advise(ref, adj) {
  const items = [];
  const f = [0, 1, 2].map(c => ref.W[c] / adj.W[c]);
  const fmax = Math.max(...f);
  const fn = f.map(v => v / fmax);
  const chan = [['R', 'Rot', 'r'], ['G', 'Grün', 'g'], ['B', 'Blau', 'b']];
  chan.forEach(([k, label, cls], c) => {
    const pct = (fn[c] - 1) * 100;
    if (pct > -2) items.push({ key: k, cls, name: `${k}-Gain (${label})`, act: 'ok', txt: 'passt' });
    else items.push({ key: k, cls, name: `${k}-Gain (${label})`, act: 'down', txt: `${k} ↓ ${fmt(-pct)} %`, hint: `Bei Regler 100 auf etwa ${Math.round(100 * fn[c])}.` });
  });

  const yNew = adj.W.reduce((s, v, c) => s + v * fn[c] * LUMA[c], 0);
  const bf = ref.yW / yNew;
  if (bf < 0.96) items.push({ key: 'brightness', name: 'Helligkeit', act: 'down', txt: `↓ ${fmt((1 - bf) * 100)} % Licht`, hint: 'Nach dem RGB-Abgleich gerechnet. Der Helligkeitsregler ist meist nicht linear, also schrittweise senken und neu fotografieren.' });
  else if (bf > 1.04) items.push({ key: 'brightness', name: 'Helligkeit', act: 'up', txt: `↑ ${fmt((bf - 1) * 100)} % Licht`, hint: 'Steht der Regler schon auf Maximum, stattdessen die Referenz dunkler stellen oder die Referenz wechseln.' });
  else items.push({ key: 'brightness', name: 'Helligkeit', act: 'ok', txt: 'passt' });

  const dg = adj.gamma - ref.gamma;
  if (!isFinite(dg)) items.push({ key: 'gamma', name: 'Gamma', act: 'info', txt: 'nicht messbar', hint: 'Graustufen waren nicht auswertbar. Ecken prüfen.' });
  else if (dg < -0.07) items.push({ key: 'gamma', name: 'Gamma', act: 'up', txt: `↑ ~${fmt(Math.max(0.1, Math.round(-dg * 10) / 10), 1)}`, hint: 'Mitteltöne sind heller als bei der Referenz. Gamma-Wert erhöhen, z. B. 2,2 → 2,4.' });
  else if (dg > 0.07) items.push({ key: 'gamma', name: 'Gamma', act: 'down', txt: `↓ ~${fmt(Math.max(0.1, Math.round(dg * 10) / 10), 1)}`, hint: 'Mitteltöne sind dunkler als bei der Referenz. Gamma-Wert senken, z. B. 2,4 → 2,2.' });
  else items.push({ key: 'gamma', name: 'Gamma', act: 'ok', txt: 'passt' });

  if (Math.max(ref.blackRaw, adj.blackRaw) >= 8) {
    const kr = (adj.yK / adj.yW) / Math.max(1e-6, ref.yK / ref.yW);
    if (kr > 1.4) items.push({ key: 'black', name: 'Schwarzwert', act: 'down', txt: '↓ etwas', hint: 'Schwarz wirkt heller als bei der Referenz. Regler „Schwarzwert“ oder „Black Level“ senken, falls vorhanden.' });
    else if (kr < 0.7) items.push({ key: 'black', name: 'Schwarzwert', act: 'up', txt: '↑ etwas', hint: 'Schwarz wirkt dunkler als bei der Referenz, dunkle Details können absaufen. Schwarzwert leicht anheben, falls vorhanden.' });
    else items.push({ key: 'black', name: 'Schwarzwert', act: 'ok', txt: 'passt' });
  }

  const dp = adj.purity - ref.purity;
  if (dp < -0.06) items.push({ key: 'saturation', name: 'Sättigung', act: 'up', txt: '↑ etwas', hint: 'Die reinen Farben R, G, B wirken blasser als bei der Referenz.' });
  else if (dp > 0.06) items.push({ key: 'saturation', name: 'Sättigung', act: 'down', txt: '↓ etwas', hint: 'Die reinen Farben R, G, B wirken kräftiger als bei der Referenz.' });
  else items.push({ key: 'saturation', name: 'Sättigung', act: 'ok', txt: 'passt' });

  const mr = [0, 1, 2].map(c => adj.mid[c] / Math.max(1e-6, ref.mid[c]));
  const mm = (mr[0] + mr[1] + mr[2]) / 3;
  const dev = mr.map(v => v / mm - 1);
  const worst = dev.reduce((bi, v, i) => (Math.abs(v) > Math.abs(dev[bi]) ? i : bi), 0);
  if (Math.abs(dev[worst]) > 0.06) {
    const k = chan[worst];
    items.push({ key: 'midtint', cls: k[2], name: 'Farbstich in Mitteltönen', act: 'info', txt: `${k[0]} ${dev[worst] > 0 ? 'zu stark' : 'zu schwach'}`, hint: 'Weiß passt dann, Grau aber nicht. Nur korrigierbar, wenn der Monitor RGB-Offset oder Gamma pro Kanal anbietet.' });
  }
  return items;
}
