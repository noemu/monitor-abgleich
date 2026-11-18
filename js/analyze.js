import { PATCHES, GAMMA_LEVELS, patchRects } from './pattern.js';
import { homography, center, UNIT } from './geometry.js';

export const LUMA = [0.2126, 0.7152, 0.0722];
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luma = v => v[0] * LUMA[0] + v[1] * LUMA[1] + v[2] * LUMA[2];

export const SIDE_NAMES = ['oben', 'unten', 'links', 'rechts'];

export function facingSides(quads) {
  const [a, b] = quads.map(center);
  if (Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1])) return a[0] < b[0] ? [3, 2] : [2, 3];
  return a[1] < b[1] ? [1, 0] : [0, 1];
}

export function sideRects(p, side) {
  const all = patchRects(p);
  return side == null ? all : [all[side]];
}

function samplePatch(img, H, p, side) {
  const N = side == null ? 7 : 11, vals = [[], [], []];
  let total = 0;
  for (const r of sideRects(p, side)) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    total++;
    const [x, y] = H(r.x + r.w * (0.3 + 0.4 * i / (N - 1)), r.y + r.h * (0.3 + 0.4 * j / (N - 1)));
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) continue;
    const o = (yi * img.width + xi) * 4;
    vals[0].push(img.data[o]); vals[1].push(img.data[o + 1]); vals[2].push(img.data[o + 2]);
  }
  const med = vals.map(a => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[a.length >> 1]; });
  return { med, coverage: vals[0].length / total };
}

export function measure(img, quad, side) {
  const H = homography(UNIT, quad);
  if (!H) return null;
  const raw = {}, lin = {};
  let coverage = 1;
  for (const p of PATCHES) {
    const s = samplePatch(img, H, p, side);
    raw[p.id] = s.med;
    lin[p.id] = raw[p.id].map(c => toLin(c / 255));
    coverage = Math.min(coverage, s.coverage);
  }
  const W = lin.w, K = lin.k, yW = luma(W), yK = luma(K);
  let gs = 0, gn = 0, ls = 0, ln = 0;
  for (const [id, lv] of GAMMA_LEVELS) {
    const yn = (luma(lin[id]) - yK) / (yW - yK);
    if (yn > 0.002 && yn < 0.999) {
      gs += Math.log(yn) / Math.log(lv); gn++;
      if (lv <= 0.6) { ls += Math.log(yn) / Math.log(lv); ln++; }
    }
  }
  const y80 = (luma(lin.g80) - yK) / (yW - yK);
  const purity = ['r', 'g', 'b'].map((id, c) => {
    const n = lin[id].map((v, k) => (v - K[k]) / Math.max(1e-6, W[k] - K[k]));
    const others = n.filter((_, k) => k !== c);
    return n[c] > 0.02 ? 1 - Math.max(...others) / n[c] : 0;
  });
  const mid = lin.g50.map((v, k) => (v - K[k]) / Math.max(1e-6, W[k] - K[k]));
  const [cx, cy] = center(quad);
  return {
    raw, lin, W, K, yW, yK, cx, cy, side, coverage,
    gamma: gn ? gs / gn : NaN,
    highlight: ln ? y80 / Math.pow(0.8, ls / ln) : NaN,
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

export const SETTINGS = [
  ['rgb', 'RGB-Gain'], ['brightness', 'Helligkeit'], ['contrast', 'Kontrast'],
  ['gamma', 'Gamma'], ['black', 'Schwarzwert'], ['saturation', 'Sättigung'],
];
const ALL = Object.fromEntries(SETTINGS.map(([k]) => [k, true]));

export function advise(ref, adj, avail = ALL) {
  const items = [];
  const na = (key, name, txt, hint, cls) => items.push({ key, cls, name, act: 'info', txt, hint });
  const f = [0, 1, 2].map(c => ref.W[c] / adj.W[c]);
  const fmax = Math.max(...f);
  let fn = f.map(v => v / fmax);
  const chan = [['R', 'Rot', 'r'], ['G', 'Grün', 'g'], ['B', 'Blau', 'b']];

  const g = avail.rgb ? fn : [1, 1, 1];
  const bf = ref.yW / adj.W.reduce((s, v, c) => s + v * g[c] * LUMA[c], 0);
  const lum = avail.brightness ? 'brightness' : avail.contrast ? 'contrast' : null;
  const rgbLum = !lum && avail.rgb && bf < 0.96;
  if (rgbLum) fn = fn.map(v => v * bf);

  if (avail.rgb) {
    chan.forEach(([k, label, cls], c) => {
      const pct = (fn[c] - 1) * 100;
      if (pct > -2) items.push({ key: k, cls, name: `${k}-Gain (${label})`, act: 'ok', txt: 'passt' });
      else items.push({ key: k, cls, name: `${k}-Gain (${label})`, act: 'down', txt: `${k} ↓ ${fmt(-pct)} %`, hint: `Bei Regler 100 auf etwa ${Math.round(100 * fn[c])}.${rgbLum ? ' Enthält die Helligkeitsanpassung, weil Helligkeit und Kontrast abgewählt sind.' : ''}` });
    });
  } else if (Math.min(...fn) < 0.98) {
    const s = fn.indexOf(Math.min(...fn));
    const hint = s === 2 ? 'Blau ist zu stark. Ein wärmeres Farbtemperatur-Preset probieren (weniger Kelvin, z. B. 6500 K statt 9300 K).'
      : s === 0 ? 'Rot ist zu stark. Ein kälteres Farbtemperatur-Preset probieren (mehr Kelvin).'
      : 'Grün ist zu stark. Über die Farbtemperatur-Presets meist nicht lösbar.';
    na('rgb', 'Weißpunkt', `${chan[s][0]} zu stark`, hint, chan[s][2]);
  }

  if (lum) {
    const name = lum === 'brightness' ? 'Helligkeit' : 'Kontrast';
    const via = lum === 'contrast' ? ' Kontrast statt Helligkeit, weil Helligkeit abgewählt ist. Er senkt nur Weiß, nicht Schwarz.' : '';
    if (bf < 0.96) items.push({ key: lum, name, act: 'down', txt: `↓ ${fmt((1 - bf) * 100)} % Licht`, hint: `Nach dem RGB-Abgleich gerechnet. Der Regler ist meist nicht linear, also schrittweise senken und neu fotografieren.${via}` });
    else if (bf > 1.04) items.push({ key: lum, name, act: 'up', txt: `↑ ${fmt((bf - 1) * 100)} % Licht`, hint: `Steht der Regler schon auf Maximum, stattdessen die Referenz dunkler stellen oder die Referenz wechseln.${via}` });
    else items.push({ key: lum, name, act: 'ok', txt: 'passt' });
  } else if (bf > 1.04 || (bf < 0.96 && !rgbLum)) {
    na('brightness', 'Helligkeit', bf > 1 ? 'zu dunkel' : 'zu hell', bf > 1 ? 'Ohne Helligkeits- und Kontrastregler nicht heller zu bekommen. Die Referenz dunkler stellen oder die Referenz wechseln.' : 'Ohne Helligkeits-, Kontrast- und RGB-Regler nicht angleichbar. Stattdessen die Referenz heller stellen.');
  }

  if (lum === 'brightness') {
    const dh = adj.highlight - ref.highlight;
    if (dh > 0.06) {
      const hint = 'Die hellen Stufen 80 % und Weiß liegen enger zusammen als bei der Referenz, helle Details brennen aus.';
      if (avail.contrast) items.push({ key: 'contrast', name: 'Kontrast', act: 'down', txt: '↓ etwas', hint: `${hint} Kontrast senken, bis 80 % und Weiß wieder klar getrennt sind.` });
      else na('contrast', 'Kontrast', 'Spitzlichter zu hell', `${hint} Ohne Kontrastregler hilft teils ein anderer Bildmodus.`);
    } else if (dh < -0.06) na('contrast', 'Kontrast', 'Referenz prüfen', 'Bei der Referenz liegen 80 % und Weiß enger zusammen, dort brennen helle Details aus. Besser an der Referenz den Kontrast senken.');
    else if (avail.contrast) items.push({ key: 'contrast', name: 'Kontrast', act: 'ok', txt: 'passt' });
  }

  const dg = adj.gamma - ref.gamma;
  const gammaAlt = ' Ohne Gamma-Regler hilft teils ein anderer Bildmodus (z. B. sRGB oder Standard).';
  if (!isFinite(dg)) items.push({ key: 'gamma', name: 'Gamma', act: 'info', txt: 'nicht messbar', hint: 'Graustufen waren nicht auswertbar. Ecken prüfen.' });
  else if (dg < -0.07) {
    if (avail.gamma) items.push({ key: 'gamma', name: 'Gamma', act: 'up', txt: `↑ ~${fmt(Math.max(0.1, Math.round(-dg * 10) / 10), 1)}`, hint: 'Mitteltöne sind heller als bei der Referenz. Gamma-Wert erhöhen, z. B. 2,2 → 2,4.' });
    else na('gamma', 'Gamma', 'Mitten zu hell', `Mitteltöne sind heller als bei der Referenz.${gammaAlt}`);
  } else if (dg > 0.07) {
    if (avail.gamma) items.push({ key: 'gamma', name: 'Gamma', act: 'down', txt: `↓ ~${fmt(Math.max(0.1, Math.round(dg * 10) / 10), 1)}`, hint: 'Mitteltöne sind dunkler als bei der Referenz. Gamma-Wert senken, z. B. 2,4 → 2,2.' });
    else na('gamma', 'Gamma', 'Mitten zu dunkel', `Mitteltöne sind dunkler als bei der Referenz.${gammaAlt}`);
  } else if (avail.gamma) items.push({ key: 'gamma', name: 'Gamma', act: 'ok', txt: 'passt' });

  if (Math.max(ref.blackRaw, adj.blackRaw) >= 8) {
    const kr = (adj.yK / adj.yW) / Math.max(1e-6, ref.yK / ref.yW);
    const blackAlt = ' Ohne Schwarzwert-Regler hilft teils ein anderer Bildmodus, bei HDMI auch der RGB-Bereich „Voll“ statt „Begrenzt“ (oder umgekehrt).';
    if (kr > 1.4) {
      if (avail.black) items.push({ key: 'black', name: 'Schwarzwert', act: 'down', txt: '↓ etwas', hint: 'Schwarz wirkt heller als bei der Referenz. Regler „Schwarzwert“ oder „Black Level“ senken.' });
      else na('black', 'Schwarzwert', 'Schwarz zu hell', `Schwarz wirkt heller als bei der Referenz.${blackAlt}`);
    } else if (kr < 0.7) {
      if (avail.black) items.push({ key: 'black', name: 'Schwarzwert', act: 'up', txt: '↑ etwas', hint: 'Schwarz wirkt dunkler als bei der Referenz, dunkle Details können absaufen. Schwarzwert leicht anheben.' });
      else na('black', 'Schwarzwert', 'Schwarz zu dunkel', `Schwarz wirkt dunkler als bei der Referenz.${blackAlt}`);
    } else if (avail.black) items.push({ key: 'black', name: 'Schwarzwert', act: 'ok', txt: 'passt' });
  }

  const dp = adj.purity - ref.purity;
  const satAlt = ' Ohne Sättigungsregler hilft oft ein sRGB-Modus oder ein anderer Bildmodus.';
  if (dp < -0.06) {
    if (avail.saturation) items.push({ key: 'saturation', name: 'Sättigung', act: 'up', txt: '↑ etwas', hint: 'Die reinen Farben R, G, B wirken blasser als bei der Referenz.' });
    else na('saturation', 'Sättigung', 'Farben zu blass', `Die reinen Farben R, G, B wirken blasser als bei der Referenz.${satAlt}`);
  } else if (dp > 0.06) {
    if (avail.saturation) items.push({ key: 'saturation', name: 'Sättigung', act: 'down', txt: '↓ etwas', hint: 'Die reinen Farben R, G, B wirken kräftiger als bei der Referenz.' });
    else na('saturation', 'Sättigung', 'Farben zu kräftig', `Die reinen Farben R, G, B wirken kräftiger als bei der Referenz.${satAlt}`);
  } else if (avail.saturation) items.push({ key: 'saturation', name: 'Sättigung', act: 'ok', txt: 'passt' });

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
