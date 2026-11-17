import { PATCHES, patchRects, patternRects, drawPattern, MARKER_IDS } from './pattern.js';
import { homography, sortQuad, UNIT } from './geometry.js';
import { locateScreens } from './detect.js';
import { measure, advise, names, fmt } from './analyze.js';
import { synthPhoto, DEMO } from './synth.js';

const AR = window.AR;
const RECTS = patternRects(AR);
const MAX_DIM = 3000;
const CORNER_NAMES = ['oben links', 'oben rechts', 'unten rechts', 'unten links'];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const prev = $('patternPrev');
drawPattern(prev.getContext('2d'), prev.width, prev.height, RECTS);

const fs = $('fs'), fsCanvas = $('fsCanvas');
function drawFs() {
  const dpr = window.devicePixelRatio || 1;
  fsCanvas.width = Math.round(innerWidth * dpr);
  fsCanvas.height = Math.round(innerHeight * dpr);
  drawPattern(fsCanvas.getContext('2d'), fsCanvas.width, fsCanvas.height, RECTS);
}
function closeFs() {
  fs.hidden = true;
  removeEventListener('resize', drawFs);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('btnFs').addEventListener('click', () => {
  fs.hidden = false;
  drawFs();
  addEventListener('resize', drawFs);
  if (fs.requestFullscreen) fs.requestFullscreen().then(drawFs).catch(() => {});
});
fs.addEventListener('click', closeFs);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !fs.hidden) closeFs(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !fs.hidden) closeFs(); });

const view = $('view'), vctx = view.getContext('2d');
const src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
let image = null, pts = [], drag = -1, refChoice = null, isDemo = false, detectInfo = null, busy = false;

const quads = () => {
  const out = [];
  for (let q = 0; q < 2; q++) if (pts.length >= 4 * (q + 1)) out.push(pts.slice(4 * q, 4 * q + 4));
  return out;
};

function setImageData(img) {
  src.width = img.width; src.height = img.height;
  sctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  image = sctx.getImageData(0, 0, img.width, img.height);
  view.width = img.width; view.height = img.height;
}

function runDetect() {
  if (!image) return;
  busy = true;
  setStatus('Suche Testbilder …');
  setTimeout(() => {
    let res;
    try { res = locateScreens(AR, image); } catch (e) { res = { ok: false, counts: [0, 0, 0, 0], error: e }; }
    busy = false;
    refChoice = null;
    if (res.ok) {
      const c = res.quads.map(q => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4]);
      const axis = Math.abs(c[0][0] - c[1][0]) >= Math.abs(c[0][1] - c[1][1]) ? 0 : 1;
      pts = (c[0][axis] <= c[1][axis] ? res.quads : [res.quads[1], res.quads[0]]).flat();
      detectInfo = { ok: true, text: 'Beide Testbilder erkannt. Die Ecken lassen sich bei Bedarf nachziehen.' };
    } else {
      pts = [];
      const counts = res.counts || MARKER_IDS.map(id => res.markers ? res.markers.filter(m => m.id === id).length : 0);
      const missing = counts.map((c, i) => (c < 2 ? `${CORNER_NAMES[i]} ${c}/2` : null)).filter(Boolean);
      detectInfo = { ok: false, text: `Nicht alle Eck-Codes gefunden (${missing.join(', ')}). Sind beide Testbilder ganz im Foto und füllen es gut aus? Sonst Ecken von Hand antippen.` };
    }
    update();
  }, 30);
}

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    src.width = w; src.height = h;
    sctx.drawImage(img, 0, 0, w, h);
    image = sctx.getImageData(0, 0, w, h);
    view.width = w; view.height = h;
    URL.revokeObjectURL(url);
    isDemo = false;
    $('demoTag').hidden = true;
    pts = [];
    render();
    runDetect();
  };
  img.onerror = () => { setStatus('Das Bild ließ sich nicht öffnen. Bitte JPG oder PNG verwenden.'); URL.revokeObjectURL(url); };
  img.src = url;
}
for (const id of ['inCam', 'inGal']) {
  const el = $(id);
  el.addEventListener('change', () => { loadFile(el.files[0]); el.value = ''; });
}

const scale = () => view.width / view.getBoundingClientRect().width;
function toImg(e) {
  const r = view.getBoundingClientRect(), s = view.width / r.width;
  return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
}
view.addEventListener('pointerdown', e => {
  if (!image || busy) return;
  const p = toImg(e), hit = 22 * scale();
  let best = -1, bd = hit;
  pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
  if (best < 0 && pts.length < 8) { pts.push(p); best = pts.length - 1; detectInfo = null; }
  if (best >= 0) { drag = best; view.setPointerCapture(e.pointerId); render(); }
});
view.addEventListener('pointermove', e => {
  if (drag < 0) return;
  const p = toImg(e);
  pts[drag] = [Math.max(0, Math.min(view.width, p[0])), Math.max(0, Math.min(view.height, p[1]))];
  render();
});
const endDrag = () => {
  if (drag < 0) return;
  drag = -1;
  for (let q = 0; q < 2; q++) if (pts.length >= 4 * (q + 1)) pts.splice(4 * q, 4, ...sortQuad(pts.slice(4 * q, 4 * q + 4)));
  update();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
$('btnUndo').addEventListener('click', () => { pts.pop(); detectInfo = null; update(); });
$('btnReset').addEventListener('click', () => { pts = []; refChoice = null; detectInfo = null; update(); });
$('btnAuto').addEventListener('click', () => { if (image && !busy) runDetect(); });

function setStatus(t) { $('status').textContent = t; }

function render() {
  if (!image) return;
  vctx.drawImage(src, 0, 0);
  const s = scale(), cols = ['#5db3d1', '#f0a640'];
  quads().forEach((q, qi) => {
    vctx.lineWidth = 2 * s; vctx.strokeStyle = cols[qi];
    vctx.beginPath(); q.forEach((p, i) => (i ? vctx.lineTo(...p) : vctx.moveTo(...p))); vctx.closePath(); vctx.stroke();
    if (drag >= 0) return;
    const H = homography(UNIT, sortQuad(q));
    if (!H) return;
    vctx.lineWidth = 1 * s;
    for (const p of PATCHES) for (const r of patchRects(p)) {
      const c = [[r.x + r.w * .3, r.y + r.h * .3], [r.x + r.w * .7, r.y + r.h * .3], [r.x + r.w * .7, r.y + r.h * .7], [r.x + r.w * .3, r.y + r.h * .7]].map(([u, v]) => H(u, v));
      vctx.beginPath(); c.forEach((p2, i) => (i ? vctx.lineTo(...p2) : vctx.moveTo(...p2))); vctx.closePath(); vctx.stroke();
    }
  });
  pts.forEach((p, i) => {
    vctx.beginPath(); vctx.arc(p[0], p[1], 7 * s, 0, Math.PI * 2);
    vctx.fillStyle = i < 4 ? cols[0] : cols[1]; vctx.fill();
    vctx.lineWidth = 2 * s; vctx.strokeStyle = '#000'; vctx.stroke();
  });
  if (drag >= 0) {
    const p = pts[drag], R = 70 * s, Z = 4;
    const cx = p[0] < view.width / 2 ? view.width - R - 10 * s : R + 10 * s, cy = R + 10 * s;
    vctx.save();
    vctx.beginPath(); vctx.arc(cx, cy, R, 0, Math.PI * 2); vctx.clip();
    vctx.imageSmoothingEnabled = false;
    vctx.drawImage(src, p[0] - R / Z, p[1] - R / Z, 2 * R / Z, 2 * R / Z, cx - R, cy - R, 2 * R, 2 * R);
    vctx.strokeStyle = '#fff'; vctx.lineWidth = 1 * s;
    vctx.beginPath(); vctx.moveTo(cx - R, cy); vctx.lineTo(cx + R, cy); vctx.moveTo(cx, cy - R); vctx.lineTo(cx, cy + R); vctx.stroke();
    vctx.restore();
    vctx.beginPath(); vctx.arc(cx, cy, R, 0, Math.PI * 2); vctx.lineWidth = 2 * s; vctx.strokeStyle = '#fff'; vctx.stroke();
  }
}

function update() {
  render();
  const n = pts.length;
  const pre = detectInfo && !detectInfo.ok ? detectInfo.text + ' ' : '';
  if (!image) setStatus('Mach ein Foto, auf dem beide Monitore mit dem Testbild zu sehen sind.');
  else if (n < 4) setStatus(`${pre}Erster Monitor: tippe Ecke ${n + 1} von 4.`);
  else if (n < 8) setStatus(`${pre}Zweiter Monitor: tippe Ecke ${n - 3} von 4.`);
  else if (detectInfo && detectInfo.ok) setStatus(detectInfo.text);
  else setStatus('Alle Ecken gesetzt. Punkte lassen sich zum Feinjustieren ziehen, die Lupe hilft dabei.');
  analyze();
}

function analyze() {
  const out = $('results'), b0 = $('ref0'), b1 = $('ref1'), note = $('refNote');
  if (pts.length < 8) {
    b0.textContent = b1.textContent = '—'; b0.disabled = b1.disabled = true; note.textContent = '';
    out.innerHTML = '<p class="muted">Sobald beide Monitore erkannt sind, steht hier, was einzustellen ist.</p>';
    return;
  }
  const ms = quads().map(q => measure(image, sortQuad(q)));
  if (ms.some(m => !m)) { out.innerHTML = '<p class="warn">Die Ecken ergeben kein gültiges Viereck. Bitte neu setzen.</p>'; return; }
  const nm = names(ms);
  const auto = ms[0].yW <= ms[1].yW ? 0 : 1;
  const ri = refChoice ?? auto, ai = 1 - ri;
  b0.textContent = nm[0]; b1.textContent = nm[1]; b0.disabled = b1.disabled = false;
  b0.setAttribute('aria-pressed', String(ri === 0)); b1.setAttribute('aria-pressed', String(ri === 1));
  note.textContent = ri === auto ? 'automatisch: der dunklere Monitor, damit der andere nur abgesenkt werden muss' : 'manuell gewählt';

  const items = advise(ms[ri], ms[ai]);
  const todo = items.filter(i => i.act === 'up' || i.act === 'down').length;
  const warns = [];
  if (ms.some(m => m.clipped)) warns.push('Weiß ist im Foto ausgebrannt. Belichtung an der Kamera senken und neu fotografieren, sonst stimmen RGB und Helligkeit nicht.');
  if (ms.some(m => m.dark)) warns.push('Das Foto ist sehr dunkel. Belichtung erhöhen.');
  if (Math.abs(ms[0].lin.w[1] - ms[1].lin.w[1]) / Math.max(ms[0].lin.w[1], ms[1].lin.w[1]) > 0.6) warns.push('Die Monitore unterscheiden sich sehr stark. Prüfe, ob beide das Testbild formatfüllend zeigen und die Ecken stimmen.');

  const row = it => `<div class="osd-row"><div class="name"><span class="dot ${it.cls || ''}"></span><span>${esc(it.name)}</span></div><span class="act ${it.act}">${esc(it.txt)}</span>${it.hint ? `<div class="hint">${esc(it.hint)}</div>` : ''}</div>`;
  const tr = (label, f) => `<tr><td>${label}</td>${[ri, ai].map(i => `<td class="num">${f(ms[i])}</td>`).join('')}</tr>`;
  const ref = ms[ri];
  out.innerHTML = `
    <div class="results">
      ${isDemo ? '<div class="tag">Ergebnis zum Beispielfoto</div>' : ''}
      <p class="verdict">${todo ? `Am Monitor <em>${esc(nm[ai])}</em> einstellen:` : `${esc(nm[ai])} passt bereits gut zur Referenz.`}</p>
      ${warns.map(w => `<p class="warn">${esc(w)}</p>`).join('')}
      <div class="osd">${items.map(row).join('')}</div>
      <p class="muted">Reihenfolge: erst RGB, dann Helligkeit, dann Gamma. RGB ist so gerechnet, dass nur abgesenkt wird. Danach neu fotografieren.</p>
      <details>
        <summary>Messwerte</summary>
        <div class="tablewrap"><table>
          <thead><tr><th>Größe</th><th class="num">${esc(nm[ri])} (Ref.)</th><th class="num">${esc(nm[ai])}</th></tr></thead>
          <tbody>
            ${tr('Weiß, Leuchtdichte', m => fmt(100 * m.yW / ref.yW) + ' %')}
            ${['R', 'G', 'B'].map((k, c) => tr(`Weiß, Kanal ${k}`, m => fmt(100 * m.W[c] / ref.W[c]) + ' %')).join('')}
            ${tr('Gamma (Kamera, relativ)', m => (isFinite(m.gamma) ? fmt(m.gamma, 2) : '–'))}
            ${tr('Schwarz / Weiß', m => fmt(100 * m.yK / m.yW, 2) + ' %')}
            ${tr('Farbreinheit R/G/B', m => fmt(100 * m.purity) + ' %')}
            ${tr('Weiß im Foto (max. 0–255)', m => Math.max(...m.raw.w))}
          </tbody>
        </table></div>
        <p class="muted" style="margin-top:8px">Die Kamera misst nicht absolut. Aussagekräftig ist nur der Vergleich der beiden Monitore im selben Foto.</p>
      </details>
    </div>`;
}
$('ref0').addEventListener('click', () => { refChoice = 0; analyze(); });
$('ref1').addEventListener('click', () => { refChoice = 1; analyze(); });

addEventListener('resize', render);

setImageData(synthPhoto({ ...DEMO, rects: RECTS }));
isDemo = true;
runDetect();
