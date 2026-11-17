export const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function normalization(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy);
  d /= pts.length;
  return { cx, cy, k: d > 0 ? Math.SQRT2 / d : 1 };
}

export function homography(src, dst) {
  if (src.length !== dst.length || src.length < 4) return null;
  const ts = normalization(src), td = normalization(dst);
  const M = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const v = new Array(8).fill(0);
  const add = (row, rhs) => {
    for (let i = 0; i < 8; i++) {
      if (!row[i]) continue;
      for (let j = 0; j < 8; j++) M[i][j] += row[i] * row[j];
      v[i] += row[i] * rhs;
    }
  };
  for (let i = 0; i < src.length; i++) {
    const x = (src[i][0] - ts.cx) * ts.k, y = (src[i][1] - ts.cy) * ts.k;
    const X = (dst[i][0] - td.cx) * td.k, Y = (dst[i][1] - td.cy) * td.k;
    add([x, y, 1, 0, 0, 0, -x * X, -y * X], X);
    add([0, 0, 0, x, y, 1, -x * Y, -y * Y], Y);
  }
  const h = solveLinear(M, v);
  if (!h) return null;
  return (u, w) => {
    const x = (u - ts.cx) * ts.k, y = (w - ts.cy) * ts.k;
    const d = h[6] * x + h[7] * y + 1;
    return [((h[0] * x + h[1] * y + h[2]) / d) / td.k + td.cx, ((h[3] * x + h[4] * y + h[5]) / d) / td.k + td.cy];
  };
}

export function sortQuad(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  return pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

export function isConvexClockwise(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) return false;
  }
  return true;
}

export function perimeter(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) s += Math.hypot(q[(i + 1) % q.length][0] - q[i][0], q[(i + 1) % q.length][1] - q[i][1]);
  return s;
}

export function center(q) {
  return [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
}
