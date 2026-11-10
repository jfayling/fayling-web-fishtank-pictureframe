// Procedural fish geometry. Each species is lofted from its dorsal, ventral and width
// profiles, then given membrane fins, domed eyes and (for the moray) a hinged lower jaw.
//
// Vertex layout (14 floats): position xyz, normal xyz, body uv (t, y), aux xyzw, texture uv.
//   aux.x  part: 0 body, 1 caudal, 2 dorsal, 3 anal, 4 pectoral, 5 pelvic, 6 eye
//   aux.y  side: -1 left, +1 right, 0 on the midline
//   body:  aux.z normalized height (-1 belly .. 1 back), aux.w jaw weight
//   fins:  aux.z distance from the fin base (0 .. 1), aux.w position across the span (0 .. 1)
//   eye:   aux.z radius from the pupil centre (0 .. 1)
// Local frame: +x forward (snout), +y up, +z the fish's right side. One unit = body length.
import { curve, orientTriangles } from './math.js';

export const FISH_STRIDE = 14;

const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

export function buildFishMesh(def) {
  const g = def.geo;
  const top = curve(g.top), bot = curve(g.bot), wid = curve(g.width);
  const n = g.n, pivot = g.pivot ?? (def.id === 11 ? 0.05 : 0.4);
  const P = [], UV = [], AUX = [], TEX = [], FIXN = [];
  const idx = [];
  const center = (t) => (top(t) + bot(t)) / 2;
  const half = (t) => Math.max(1e-4, (top(t) - bot(t)) / 2);
  // body surface z at (t, y): positive side
  const surfZ = (t, y) => {
    const v = Math.min(0.999, Math.abs((y - center(t)) / half(t)));
    return wid(t) * Math.pow(1 - Math.pow(v, n), 1 / n);
  };
  function vert(t, y, z, aux, uvY = y, fixN = null, tex = null) {
    P.push(t, y, z);
    UV.push(t, uvY);
    AUX.push(aux[0], aux[1], aux[2], aux[3]);
    TEX.push(tex ? tex[0] : 0, tex ? tex[1] : 0);
    FIXN.push(fixN);
    return P.length / 3 - 1;
  }
  const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };

  // ---- body -----------------------------------------------------------------------------
  const tPed = g.tPed;
  const R = g.rings ?? 72;
  const K = 40; // around; K/2 must land on theta = pi
  const jaw = g.jaw;
  const ringStart = [];
  const t0 = 0.004 * tPed;
  for (let i = 0; i < R; i++) {
    const s = i / (R - 1);
    const t = t0 + (tPed - t0) * Math.pow(s, 1.25);
    const c = center(t), hh = half(t), w = Math.max(1e-4, wid(t));
    ringStart.push(P.length / 3);
    // upper half j = 0..K/2, lower half j = K/2..K (duplicated seam vertices)
    for (let half_ = 0; half_ < 2; half_++) {
      for (let j = 0; j <= K / 2; j++) {
        const th = (Math.PI * 2 * (j + half_ * (K / 2))) / K;
        const cs = Math.cos(th), sn = Math.sin(th);
        const y = c + hh * sgnpow(sn, 2 / n);
        const z = w * sgnpow(cs, 2 / n);
        const lower = half_ === 1;
        let jw = 0;
        if (jaw && lower && t < jaw.t) jw = Math.min(1, (jaw.t - t) / 0.02);
        const side = Math.abs(cs) < 1e-6 ? 0 : Math.sign(cs);
        vert(t, y, z, [0, side, (y - c) / hh, jw], y, null, jaw && lower ? [pivot - jaw.t, jaw.y] : null);
      }
    }
  }
  const H = K / 2 + 1; // vertices per half ring
  for (let i = 0; i < R - 1; i++) {
    for (let h = 0; h < 2; h++) {
      const a0 = ringStart[i] + h * H, b0 = ringStart[i + 1] + h * H;
      for (let j = 0; j < K / 2; j++) quad(a0 + j, b0 + j, b0 + j + 1, a0 + j + 1);
    }
  }
  // snout tips (upper and lower) and tail cap
  {
    const c0 = center(0);
    for (let h = 0; h < 2; h++) {
      const jw = jaw && h === 1 ? 1 : 0;
      const tip = vert(0, c0, 0, [0, 0, 0, jw], c0, null, jaw && h === 1 ? [pivot - jaw.t, jaw.y] : null);
      const a0 = ringStart[0] + h * H;
      for (let j = 0; j < K / 2; j++) idx.push(tip, a0 + j + 1, a0 + j);
    }
    const cT = center(tPed);
    for (let h = 0; h < 2; h++) {
      const cap = vert(tPed + 0.004, cT, 0, [0, 0, 0, 0], cT);
      const a0 = ringStart[R - 1] + h * H;
      for (let j = 0; j < K / 2; j++) idx.push(cap, a0 + j, a0 + j + 1);
    }
  }
  const bodyEnd = P.length / 3;

  // ---- fin membranes ----------------------------------------------------------------------
  function membrane(cols, rows, fn) {
    const base = P.length / 3;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) fn(c / cols, r / rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        quad(a, a + 1, a + cols + 2, a + cols + 1);
      }
    }
  }
  // aux.w carries s + 2 * segment so the shader can tell a spiny first dorsal from the soft one
  function medianFin(f, part, seg) {
    const hC = curve(f.h), swC = curve(f.sweep);
    const rows = Math.max(10, Math.round((f.to - f.from) * 90)) + (f.spines ? f.spines * 4 : 0);
    const up = part === 2 ? 1 : -1;
    membrane(7, rows, (u, s) => {
      const tb = f.from + s * (f.to - f.from);
      const yb = (up > 0 ? top(tb) : bot(tb)) - up * 0.006;
      const tt = tb + swC(s) * u;
      const yt = yb + up * (hC(s) + 0.006) * u;
      vert(tt, yt, 0, [part, 0, u, Math.min(s, 0.999) + 2 * seg]);
    });
  }
  (g.dorsal || []).forEach((f, k) => medianFin(f, 2, k));
  (g.anal || []).forEach((f, k) => medianFin(f, 3, k));

  if (g.caudal) {
    const cf = g.caudal;
    const cT = center(tPed), hb = half(tPed) * 0.95;
    const shape = {
      rounded: (v) => Math.sqrt(Math.max(0, 1 - 0.6 * v * v)),
      truncate: (v) => 0.97 + 0.06 * v * v,
      emarginate: (v) => 0.86 + 0.14 * Math.pow(Math.abs(v), 1.5),
      forked: (v) => 0.5 + 0.5 * Math.pow(Math.abs(v), 1.2),
      lunate: (v) => 0.4 + 0.6 * Math.pow(Math.abs(v), 1.6),
      lyre: (v) => 0.32 + 0.68 * Math.pow(Math.abs(v), 2.6),
    }[cf.type];
    const spanK = cf.type === 'rounded' ? 0.92 : 1;
    membrane(9, 26, (u, s) => {
      const v = s * 2 - 1;
      const tb = tPed - 0.025, yb = cT + v * hb;
      const tt = tPed + cf.len * shape(v), yt = cT + v * cf.span * spanK;
      // slight concave bulge so the fin is not a perfect ruled surface
      const t = tb + (tt - tb) * u, y = yb + (yt - yb) * Math.pow(u, 0.85);
      vert(t, y, 0, [1, 0, u, s]);
    });
  }

  function pairedFin(f, part) {
    if (!f) return;
    const shapeC = curve(f.shape);
    const rows = Math.max(12, (f.rays || 9) * 2);
    for (const side of [-1, 1]) {
      const zh = surfZ(f.t, f.y) * (part === 5 ? 0.55 : 0.92);
      const tau = (f.tilt * Math.PI) / 180;
      membrane(7, rows, (u, s) => {
        const a = ((f.a0 + s * (f.a1 - f.a0)) * Math.PI) / 180;
        let dx = Math.cos(a) * Math.cos(tau), dy = Math.sin(a), dz = Math.cos(a) * Math.sin(tau);
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const L = f.len * shapeC(s) * u;
        const t = f.t + dx * L, y = f.y + (s - 0.5) * f.base * (1 - u * 0.6) + dy * L;
        vert(t, y, side * (zh + dz * L), [part, side, u, s]);
      });
    }
  }
  pairedFin(g.pectoral, 4);
  pairedFin(g.pelvic, 5);
  const finEnd = P.length / 3;

  // ---- eyes (explicit normals) ------------------------------------------------------------
  if (g.eye) {
    const e = g.eye;
    const zs = surfZ(e.t, e.y);
    const rings = 7, segs = 20, phiMax = (82 * Math.PI) / 180;
    for (const side of [-1, 1]) {
      const base = P.length / 3;
      const cz = zs - e.r * 0.28;
      for (let k = 0; k <= rings; k++) {
        const phi = (k / rings) * phiMax;
        for (let m = 0; m < segs; m++) {
          const psi = (m / segs) * Math.PI * 2;
          const nt = Math.sin(phi) * Math.cos(psi), ny = Math.sin(phi) * Math.sin(psi), nz = Math.cos(phi);
          // flatter dome so it sits in the head instead of bulging like a bead
          const t = e.t + e.r * nt, y = e.y + e.r * ny, z = side * (cz + e.r * nz * 0.75);
          vert(t, y, z, [6, side, Math.sin(phi) / Math.sin(phiMax), psi], y, [nt, ny, side * nz]);
        }
      }
      for (let k = 0; k < rings; k++) {
        for (let m = 0; m < segs; m++) {
          const a = base + k * segs + m, b = base + k * segs + ((m + 1) % segs);
          quad(a, a + segs, b + segs, b);
        }
      }
    }
  }

  // ---- convert t to local x, compute normals ----------------------------------------------
  const nv = P.length / 3;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = pivot - P[i * 3];
    pos[i * 3 + 1] = P[i * 3 + 1];
    pos[i * 3 + 2] = P[i * 3 + 2];
  }
  const nrm = new Float32Array(nv * 3);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nrm[o] += fx; nrm[o + 1] += fy; nrm[o + 2] += fz; }
  }
  // weld the duplicated seam normals so the body shades smoothly across the seam
  for (let i = 0; i < R; i++) {
    const s = ringStart[i];
    const pairs = [[s, s + H + K / 2], [s + K / 2, s + H]];
    for (const [a, b] of pairs) {
      for (let c = 0; c < 3; c++) { const m = nrm[a * 3 + c] + nrm[b * 3 + c]; nrm[a * 3 + c] = m; nrm[b * 3 + c] = m; }
    }
  }
  for (let i = 0; i < nv; i++) {
    const o = i * 3;
    if (FIXN[i]) { nrm[o] = -FIXN[i][0]; nrm[o + 1] = FIXN[i][1]; nrm[o + 2] = FIXN[i][2]; continue; }
    let x = nrm[o], y = nrm[o + 1], z = nrm[o + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    if (i < bodyEnd) {
      // body normals point away from the spine
      const t = P[o], ry = P[o + 1] - center(Math.min(t, tPed)), rz = P[o + 2];
      if (ry * y + rz * z < 0 && Math.abs(ry) + Math.abs(rz) > 1e-5) { x = -x; y = -y; z = -z; }
    } else if (i < finEnd && z < 0 && AUX[i * 4 + 1] === 0) {
      // median fins face +z by convention (the shader flips back faces)
      x = -x; y = -y; z = -z;
    }
    nrm[o] = x; nrm[o + 1] = y; nrm[o + 2] = z;
  }

  const v = new Float32Array(nv * FISH_STRIDE);
  for (let i = 0; i < nv; i++) {
    const o = i * FISH_STRIDE;
    v[o] = pos[i * 3]; v[o + 1] = pos[i * 3 + 1]; v[o + 2] = pos[i * 3 + 2];
    v[o + 3] = nrm[i * 3]; v[o + 4] = nrm[i * 3 + 1]; v[o + 5] = nrm[i * 3 + 2];
    v[o + 6] = UV[i * 2]; v[o + 7] = UV[i * 2 + 1];
    v[o + 8] = AUX[i * 4]; v[o + 9] = AUX[i * 4 + 1]; v[o + 10] = AUX[i * 4 + 2]; v[o + 11] = AUX[i * 4 + 3];
    v[o + 12] = TEX[i * 2]; v[o + 13] = TEX[i * 2 + 1];
  }
  let maxH = 0, maxW = 0;
  for (let t = 0; t <= tPed; t += 0.01) { maxH = Math.max(maxH, half(t)); maxW = Math.max(maxW, wid(t)); }
  return { vertices: v, indices: orientTriangles(v, FISH_STRIDE, new Uint32Array(idx)), maxHalfHeight: maxH, maxHalfWidth: maxW, pivot };
}
