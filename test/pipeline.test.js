import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { patternRects } from '../js/pattern.js';
import { synthPhoto, DEMO } from '../js/synth.js';
import { locateScreens } from '../js/detect.js';
import { measure, advise, facingSides } from '../js/analyze.js';
import { center } from '../js/geometry.js';

const { AR } = createRequire(import.meta.url)('../js/vendor/js-aruco2/aruco.js');
const RECTS = patternRects(AR);

const scaleScene = (scene, s) => ({
  ...scene,
  width: Math.round(scene.width * s),
  height: Math.round(scene.height * s),
  monitors: scene.monitors.map(m => ({ ...m, corners: m.corners.map(([x, y]) => [x * s, y * s]) })),
});

const CASES = {
  beispiel: DEMO,
  ueberbelichtet: { ...DEMO, monitors: DEMO.monitors.map(m => ({ ...m, display: { ...m.display, exposure: 1.4 } })) },
  stark_schraeg: {
    ...DEMO,
    monitors: [
      { ...DEMO.monitors[0], corners: [[100, 300], [740, 170], [755, 640], [115, 610]] },
      { ...DEMO.monitors[1], corners: [[850, 200], [1500, 330], [1480, 560], [840, 660]] },
    ],
  },
  uebereinander: {
    width: 1200, height: 1600,
    monitors: [
      { ...DEMO.monitors[0], corners: [[200, 150], [1000, 170], [990, 620], [210, 600]] },
      { ...DEMO.monitors[1], corners: [[210, 700], [990, 720], [1000, 1180], [200, 1160]] },
    ],
  },
  kleines_foto: scaleScene(DEMO, 0.55),
  grosses_foto: scaleScene(DEMO, 2.5),
  viel_rauschen: { ...DEMO, noise: 30 },
  weit_weg_12mp: {
    width: 4000, height: 3000,
    monitors: [
      { ...DEMO.monitors[0], corners: [[1250, 1300], [1950, 1260], [1955, 1650], [1255, 1680]] },
      { ...DEMO.monitors[1], corners: [[2040, 1260], [2740, 1300], [2735, 1680], [2035, 1650]] },
    ],
  },
};

for (const [name, scene] of Object.entries(CASES)) {
  test(`erkennt beide Monitore: ${name}`, () => {
    const img = synthPhoto({ ...scene, rects: RECTS, noise: scene.noise ?? 5 });
    const res = locateScreens(AR, img);
    assert.ok(res.ok, `Marker gefunden: ${JSON.stringify(res.counts)}`);
    const tol = Math.max(3, Math.max(img.width, img.height) / 400);
    for (const truth of scene.monitors) {
      const tc = center(truth.corners);
      const q = res.quads.reduce((a, b) => {
        const da = Math.hypot(center(a)[0] - tc[0], center(a)[1] - tc[1]);
        const db = Math.hypot(center(b)[0] - tc[0], center(b)[1] - tc[1]);
        return da <= db ? a : b;
      });
      truth.corners.forEach((p, i) => {
        const d = Math.hypot(q[i][0] - p[0], q[i][1] - p[1]);
        assert.ok(d < tol, `Ecke ${i} weicht ${d.toFixed(1)} px ab (Toleranz ${tol.toFixed(1)})`);
      });
    }
  });
}

const shift = (scene, dx, dy, width, height) => ({
  ...scene, width, height,
  monitors: scene.monitors.map(m => ({ ...m, corners: m.corners.map(([x, y]) => [x + dx, y + dy]) })),
});

const PARTIAL = {
  naht_nebeneinander: { scene: shift(DEMO, -450, 0, 900, 900), facing: [[1, 2], [0, 3]] },
  naht_uebereinander: { scene: shift(CASES.uebereinander, 0, -400, 1200, 650), facing: [[2, 3], [0, 1]] },
};

for (const [name, { scene, facing }] of Object.entries(PARTIAL)) {
  test(`erkennt Teilfoto der Nahtstelle: ${name}`, () => {
    const img = synthPhoto({ ...scene, rects: RECTS });
    const res = locateScreens(AR, img);
    assert.ok(res.ok, `Marker gefunden: ${JSON.stringify(res.counts)}`);
    assert.equal(res.markers.length, 4);
    const sorted = [...res.quads].sort((a, b) => center(a)[0] + center(a)[1] - center(b)[0] - center(b)[1]);
    scene.monitors.forEach((truth, mi) => {
      for (const i of facing[mi]) {
        const d = Math.hypot(sorted[mi][i][0] - truth.corners[i][0], sorted[mi][i][1] - truth.corners[i][1]);
        assert.ok(d < 6, `Monitor ${mi}, Ecke ${i} weicht ${d.toFixed(1)} px ab`);
      }
    });
    const sides = facingSides(sorted);
    const [ref, adj] = sorted.map((q, i) => measure(img, q, sides[i]));
    assert.ok(ref.coverage === 1 && adj.coverage === 1, `Abdeckung ${ref.coverage} / ${adj.coverage}`);
    const items = Object.fromEntries(advise(ref, adj).map(i => [i.key, i]));
    assert.equal(items.R.act, 'down');
    assert.equal(items.G.act, 'down');
    assert.equal(items.B.act, 'ok');
    assert.equal(items.gamma.act, 'up');
  });
}

test('Empfehlungen zum Beispielfoto zeigen in die richtige Richtung', () => {
  const img = synthPhoto({ ...DEMO, rects: RECTS });
  const quads = DEMO.monitors.map(m => m.corners);
  const sides = facingSides(quads);
  const [ref, adj] = quads.map((q, i) => measure(img, q, sides[i]));
  const items = Object.fromEntries(advise(ref, adj).map(i => [i.key, i]));
  assert.equal(items.R.act, 'down');
  assert.equal(items.G.act, 'down');
  assert.equal(items.B.act, 'ok');
  assert.equal(items.gamma.act, 'up');
  assert.ok(Math.abs(adj.gamma - 2.0) < 0.15 && Math.abs(ref.gamma - 2.2) < 0.15, `Gamma ${ref.gamma} / ${adj.gamma}`);
});

const measurePair = displays => {
  const scene = { ...DEMO, monitors: DEMO.monitors.map((m, i) => ({ ...m, display: { ...DEMO.monitors[0].display, ...displays[i] } })) };
  const img = synthPhoto({ ...scene, rects: RECTS });
  return scene.monitors.map(m => measure(img, m.corners));
};
const byKey = items => Object.fromEntries(items.map(i => [i.key, i]));

test('zu hoher Kontrast wird erkannt', () => {
  const [ref, adj] = measurePair([{}, { contrast: 1.15 }]);
  assert.equal(byKey(advise(ref, adj)).contrast.act, 'down');
});

test('ohne Helligkeit übernimmt der Kontrast', () => {
  const [ref, adj] = measurePair([{}, { exposure: 1 }]);
  const items = byKey(advise(ref, adj, { rgb: true, brightness: false, contrast: true, gamma: true, black: true, saturation: true }));
  assert.equal(items.brightness, undefined);
  assert.equal(items.contrast.act, 'down');
});

test('ohne Helligkeit und Kontrast werden alle RGB-Regler gesenkt', () => {
  const [ref, adj] = measurePair([{}, { exposure: 1 }]);
  const items = byKey(advise(ref, adj, { rgb: true, brightness: false, contrast: false, gamma: true, black: true, saturation: true }));
  for (const k of ['R', 'G', 'B']) assert.equal(items[k].act, 'down');
  assert.equal(items.brightness, undefined);
});

test('ohne RGB-Regler wird ein Farbtemperatur-Preset vorgeschlagen', () => {
  const [ref, adj] = measurePair([{}, { gain: [0.9, 0.95, 1] }]);
  const items = byKey(advise(ref, adj, { rgb: false, brightness: true, contrast: true, gamma: true, black: true, saturation: true }));
  assert.equal(items.R, undefined);
  assert.equal(items.rgb.act, 'info');
  assert.match(items.rgb.hint, /wärmeres/);
});

test('gleiche Monitore ergeben keine Änderung', () => {
  const scene = { ...DEMO, monitors: DEMO.monitors.map(m => ({ ...m, display: DEMO.monitors[0].display })) };
  const img = synthPhoto({ ...scene, rects: RECTS });
  const [a, b] = scene.monitors.map(m => measure(img, m.corners));
  const todo = advise(a, b).filter(i => i.act === 'up' || i.act === 'down');
  assert.deepEqual(todo, []);
});
