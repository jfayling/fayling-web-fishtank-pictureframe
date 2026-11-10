// Procedural coral, anemone, stone and shell meshes. Each generator returns one variant;
// the reef instances a few variants per type with their own transforms and colours.
//
// Vertex layout (10 floats): position xyz, normal xyz, aux xyzw.
//   aux.x  sway weight (0 = rigid base, 1 = free tip), used by soft corals
//   aux.y  type parameter (tip factor, plate radius, tentacle length position, ...)
//   aux.z  per-element phase in radians (tentacle, vesicle, branch)
//   aux.w  type flag (anemone: 1 tentacle, 0 body; leather: 1 cap)
import { Rng, makeNoise, TAU, orientTriangles } from './math.js';

export const CORAL_STRIDE = 10;
export const CORAL_TYPES = {
  staghorn: 0, brain: 1, mushroom: 2, plate: 3, fan: 4, leather: 5, bubble: 6, anemone: 7, finger: 8, stone: 9, shell: 10,
};
export const SOFT_TYPES = new Set([4, 5, 6, 7]);

class MeshBuilder {
  constructor() { this.v = []; this.i = []; }
  get count() { return this.v.length / CORAL_STRIDE; }
  add(px, py, pz, nx, ny, nz, a = 0, b = 0, c = 0, d = 0) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.v.push(px, py, pz, nx / l, ny / l, nz / l, a, b, c, d);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // Tube along points [{p:[x,y,z], r, aux:[a,b,c,d]}], optional rounded tip.
  tube(pts, sides, capTip = true) {
    const n = pts.length;
    const tangents = pts.map((_, k) => {
      const a = pts[Math.max(0, k - 1)].p, b = pts[Math.min(n - 1, k + 1)].p;
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(...t) || 1;
      return [t[0] / l, t[1] / l, t[2] / l];
    });
    // parallel-transported frame
    let t0 = tangents[0];
    let ref = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = cross(t0, ref); u = norm(u);
    let w = cross(t0, u);
    const start = this.count;
    for (let k = 0; k < n; k++) {
      const t = tangents[k];
      if (k > 0) {
        // remove the component along the new tangent
        const d = dot(u, t);
        u = norm([u[0] - t[0] * d, u[1] - t[1] * d, u[2] - t[2] * d]);
        w = cross(t, u);
      }
      const { p, r, aux } = pts[k];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const nx = u[0] * ca + w[0] * sa, ny = u[1] * ca + w[1] * sa, nz = u[2] * ca + w[2] * sa;
        this.add(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, aux[0], aux[1], aux[2], aux[3]);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let s = 0; s < sides; s++) {
        const a = start + k * sides + s, b = start + k * sides + ((s + 1) % sides);
        this.quad(a, b, b + sides, a + sides);
      }
    }
    if (capTip) {
      // hemispherical cap
      const last = pts[n - 1], t = tangents[n - 1];
      let prev = start + (n - 1) * sides;
      const rings = 3;
      for (let q = 1; q <= rings; q++) {
        const ph = (q / rings) * (Math.PI / 2);
        const rr = last.r * Math.cos(ph), off = last.r * Math.sin(ph);
        const ring = this.count;
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
          const rx = u[0] * ca + w[0] * sa, ry = u[1] * ca + w[1] * sa, rz = u[2] * ca + w[2] * sa;
          const nx = rx * Math.cos(ph) + t[0] * Math.sin(ph), ny = ry * Math.cos(ph) + t[1] * Math.sin(ph), nz = rz * Math.cos(ph) + t[2] * Math.sin(ph);
          this.add(last.p[0] + rx * rr + t[0] * off, last.p[1] + ry * rr + t[1] * off, last.p[2] + rz * rr + t[2] * off,
            nx, ny, nz, last.aux[0], last.aux[1], last.aux[2], last.aux[3]);
        }
        for (let s = 0; s < sides; s++) {
          const a = prev + s, b = prev + ((s + 1) % sides);
          this.quad(a, b, ring + ((s + 1) % sides), ring + s);
        }
        prev = ring;
      }
    }
  }
  finish(extra = {}) {
    const vertices = new Float32Array(this.v);
    return { vertices, indices: orientTriangles(vertices, CORAL_STRIDE, new Uint32Array(this.i)), ...extra };
  }
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rotateTowards = (dir, rng, maxAngle) => {
  // random direction within a cone around dir
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(dir, ref)), w = cross(dir, u);
  const a = rng.next() * TAU, b = maxAngle * Math.sqrt(rng.next());
  const s = Math.sin(b), c = Math.cos(b);
  return norm([
    dir[0] * c + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * s,
    dir[1] * c + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * s,
    dir[2] * c + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * s,
  ]);
};

// ---- branching staghorn (Acropora) -----------------------------------------------------
export function staghorn(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const branch = (p, dir, len, r, depth) => {
    const segs = Math.max(3, Math.round(len / 0.05));
    const pts = [];
    let d = dir.slice(), q = p.slice();
    const tipR = Math.max(0.011, r * 0.55);
    const terminal = depth === 0 || len < 0.1;
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const rr = r + (tipR - r) * u;
      pts.push({ p: q.slice(), r: rr, aux: [0, terminal ? u * u : u * 0.25, 0, 0] });
      d = norm([d[0] + (rng.next() - 0.5) * 0.18, d[1] + (rng.next() - 0.5) * 0.18 + 0.04, d[2] + (rng.next() - 0.5) * 0.18]);
      q = [q[0] + d[0] * (len / segs), q[1] + d[1] * (len / segs), q[2] + d[2] * (len / segs)];
    }
    m.tube(pts, 8, terminal);
    if (terminal) return;
    const kids = 1 + rng.int(3);
    for (let c = 0; c < kids; c++) {
      const at = Math.floor(segs * (0.45 + rng.next() * 0.5));
      const bp = pts[at].p;
      const nd = rotateTowards(norm([d[0], d[1] + 0.3, d[2]]), rng, 0.45 + rng.next() * 0.35);
      branch(bp, nd, len * (0.55 + rng.next() * 0.3), pts[at].r * 0.85, depth - 1);
    }
    // main axis continues
    branch(q, rotateTowards(d, rng, 0.25), len * 0.7, tipR * 1.05, depth - 1);
  };
  const trunks = 4 + rng.int(4);
  for (let k = 0; k < trunks; k++) {
    const a = rng.next() * TAU, rr = rng.next() * 0.12;
    const dir = rotateTowards([0, 1, 0], rng, 0.75);
    branch([Math.cos(a) * rr, -0.04, Math.sin(a) * rr], dir, 0.32 + rng.next() * 0.2, 0.034, 3);
  }
  return m.finish({ height: 1.0, radius: 0.55 });
}

// ---- finger coral -----------------------------------------------------------------------
export function finger(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const count = 10 + rng.int(12);
  for (let k = 0; k < count; k++) {
    const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * 0.22;
    const base = [Math.cos(a) * rr, -0.03, Math.sin(a) * rr];
    let d = norm([base[0] * 1.2, 1, base[2] * 1.2]);
    const len = 0.22 + rng.next() * 0.25 - rr * 0.4;
    const r = 0.032 + rng.next() * 0.014;
    const pts = [];
    const segs = 8;
    let q = base.slice();
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      pts.push({ p: q.slice(), r: r * (1 - 0.15 * u) * (s === 0 ? 1.3 : 1), aux: [0, u, 0, 0] });
      d = norm([d[0] + (rng.next() - 0.5) * 0.12, d[1], d[2] + (rng.next() - 0.5) * 0.12]);
      q = [q[0] + d[0] * len / segs, q[1] + d[1] * len / segs, q[2] + d[2] * len / segs];
    }
    m.tube(pts, 10, true);
  }
  return m.finish({ height: 0.5, radius: 0.3 });
}

// ---- brain coral dome (grooves are drawn per pixel) -------------------------------------
export function brain(seed) {
  const rng = new Rng(seed);
  const noise = makeNoise(seed);
  const m = new MeshBuilder();
  const rows = 40, cols = 80;
  const squash = 0.62 + rng.next() * 0.15;
  for (let r = 0; r <= rows; r++) {
    const lat = -0.25 + (r / rows) * (Math.PI / 2 + 0.25);
    for (let c = 0; c <= cols; c++) {
      const lon = (c / cols) * TAU;
      let x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const bump = 1 + 0.08 * noise.n3(x * 1.7, y * 1.7, z * 1.7);
      x *= bump; z *= bump; y = y * squash * bump;
      const ny = y / (squash * squash);
      m.add(x * 0.5, y * 0.5, z * 0.5, x, ny, z, 0, 0, 0, 0);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      m.quad(a, a + cols + 1, a + cols + 2, a + 1);
    }
  }
  // top cap
  return m.finish({ height: 0.5 * squash, radius: 0.5 });
}

// ---- mushroom coral (free-living disc) --------------------------------------------------
export function mushroom(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const rings = 14, segs = 56;
  const ripple = 0.015 + rng.next() * 0.02, k = 4 + rng.int(4);
  const top = [];
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU;
      const rr = u * 0.5 * (1 + 0.05 * Math.sin(a * 3 + seed));
      const y = 0.06 * (1 - u * u) + ripple * u * u * Math.sin(a * k + seed) + 0.01;
      top.push(m.add(Math.cos(a) * rr, y, Math.sin(a) * rr, -Math.cos(a) * u * 0.25, 1, -Math.sin(a) * u * 0.25, 0.3 * u, u, a, 0));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      m.quad(top[a], top[a + segs + 1], top[a + segs + 2], top[a + 1]);
    }
  }
  // underside
  const c = m.add(0, 0, 0, 0, -1, 0, 0, 1, 0, 1);
  const rimStart = rings * (segs + 1);
  for (let s = 0; s < segs; s++) m.tri(c, top[rimStart + s], top[rimStart + s + 1]);
  return m.finish({ height: 0.08, radius: 0.5 });
}

// ---- plate / tiered montipora -----------------------------------------------------------
export function plate(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const tiers = 2 + rng.int(3);
  for (let t = 0; t < tiers; t++) {
    const R = (0.55 - t * 0.1) * (0.8 + rng.next() * 0.3);
    const y0 = t * 0.12 + rng.next() * 0.03;
    const ox = (rng.next() - 0.5) * 0.12, oz = t * 0.05;
    const span = Math.PI * (1.1 + rng.next() * 0.4);
    const a0 = Math.PI / 2 - span / 2;
    const rings = 12, segs = 40, th = 0.022;
    const ph = rng.next() * 10;
    const grid = (sideTop) => {
      const start = m.count;
      for (let r = 0; r <= rings; r++) {
        const u = 0.08 + 0.92 * (r / rings);
        for (let s = 0; s <= segs; s++) {
          const a = a0 + (s / segs) * span;
          const edge = R * (1 + 0.1 * Math.sin(a * 5 + ph) + 0.05 * Math.sin(a * 11 + ph * 2));
          const rr = u * edge;
          const y = y0 + 0.05 * u * u * Math.sin(a * 3 + ph) - 0.04 * u * u + (sideTop ? th : 0) * (1 - u * 0.5);
          m.add(ox + Math.cos(a) * rr, y, oz + Math.sin(a) * rr, 0, sideTop ? 1 : -1, 0, 0, u, a, sideTop ? 1 : 0);
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segs; s++) {
          const a = start + r * (segs + 1) + s;
          if (sideTop) m.quad(a, a + segs + 1, a + segs + 2, a + 1);
          else m.quad(a, a + 1, a + segs + 2, a + segs + 1);
        }
      }
      return start;
    };
    const ts = grid(true), bs = grid(false);
    // rim
    const rimT = ts + rings * (segs + 1), rimB = bs + rings * (segs + 1);
    for (let s = 0; s < segs; s++) m.quad(rimT + s, rimT + s + 1, rimB + s + 1, rimB + s);
  }
  return m.finish({ height: 0.35, radius: 0.55 });
}

// ---- gorgonian sea fan ------------------------------------------------------------------
export function fan(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const H = 1.0;
  const grow = (p, ang, len, r, depth) => {
    const segs = 3;
    const pts = [];
    let a = ang, q = p.slice();
    for (let k = 0; k <= segs; k++) {
      const sway = Math.min(1, Math.max(0, q[1] / H));
      pts.push({ p: q.slice(), r: r * (1 - 0.25 * k / segs), aux: [sway, depth / 7, q[1] * 3 + q[0] * 2, 0] });
      a += (rng.next() - 0.5) * 0.25;
      q = [q[0] + Math.sin(a) * len / segs, q[1] + Math.cos(a) * len / segs, q[2] + (rng.next() - 0.5) * 0.01];
    }
    m.tube(pts, 5, depth === 0);
    if (depth === 0) return;
    const spread = 0.35 + rng.next() * 0.25;
    grow(q, a - spread * (0.6 + rng.next() * 0.6), len * (0.7 + rng.next() * 0.15), r * 0.75, depth - 1);
    grow(q, a + spread * (0.6 + rng.next() * 0.6), len * (0.7 + rng.next() * 0.15), r * 0.75, depth - 1);
  };
  grow([0, -0.02, 0], (rng.next() - 0.5) * 0.2, 0.22, 0.03, 6);
  return m.finish({ height: H, radius: 0.6 });
}

// ---- toadstool leather coral ------------------------------------------------------------
export function leather(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const stalkH = 0.28 + rng.next() * 0.12;
  const capR = 0.26 + rng.next() * 0.08;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const u = k / 8;
    pts.push({ p: [Math.sin(u * 2 + seed) * 0.02, u * stalkH, 0], r: 0.085 - 0.02 * u + (k === 0 ? 0.03 : 0), aux: [u * 0.5, 0, 0, 0] });
  }
  m.tube(pts, 18, false);
  const rings = 14, segs = 64, folds = 5 + rng.int(4), ph = rng.next() * 10;
  const surf = (topSide) => {
    const start = m.count;
    for (let r = 0; r <= rings; r++) {
      const u = r / rings;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * TAU;
        const rr = (0.05 + u * capR) * (1 + 0.06 * Math.sin(a * 3 + ph));
        const fold = u * u * 0.06 * Math.sin(a * folds + ph);
        const y = stalkH + 0.06 * (1 - u * u) + fold - u * u * 0.04 + (topSide ? 0.015 : -0.02 * (1 - u));
        m.add(Math.cos(a) * rr, y, Math.sin(a) * rr, 0, topSide ? 1 : -1, 0, 0.5 + 0.5 * u, u, a, topSide ? 1 : 0.5);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = start + r * (segs + 1) + s;
        if (topSide) m.quad(a, a + segs + 1, a + segs + 2, a + 1);
        else m.quad(a, a + 1, a + segs + 2, a + segs + 1);
      }
    }
    return start;
  };
  const t = surf(true), b = surf(false);
  const rt = t + rings * (segs + 1), rb = b + rings * (segs + 1);
  for (let s = 0; s < segs; s++) m.quad(rt + s, rt + s + 1, rb + s + 1, rb + s);
  return m.finish({ height: stalkH + 0.1, radius: capR });
}

// ---- bubble coral (Plerogyra) -----------------------------------------------------------
export function bubble(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  const count = 28 + rng.int(14);
  const placed = [];
  for (let k = 0; k < count * 4 && placed.length < count; k++) {
    const a = rng.next() * TAU, el = Math.acos(1 - rng.next() * 0.95);
    const R = 0.2;
    const c = [Math.sin(el) * Math.cos(a) * R, Math.cos(el) * R * 0.8, Math.sin(el) * Math.sin(a) * R];
    const r = 0.045 + rng.next() * 0.03;
    if (placed.some((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1], p.c[2] - c[2]) < (p.r + r) * 0.8)) continue;
    placed.push({ c, r });
  }
  for (const { c, r } of placed) {
    const ph = rng.next() * TAU;
    const rows = 8, segs = 12;
    const start = m.count;
    for (let i = 0; i <= rows; i++) {
      const th = (i / rows) * Math.PI;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const nx = Math.sin(th) * Math.cos(a), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(a);
        m.add(c[0] + nx * r, c[1] + ny * r * 0.9, c[2] + nz * r, nx, ny, nz, 0.15, 1 - i / rows, ph, r);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let s = 0; s < segs; s++) {
        const a = start + i * segs + s, b = start + i * segs + ((s + 1) % segs);
        m.quad(a, b, b + segs, a + segs);
      }
    }
  }
  return m.finish({ height: 0.3, radius: 0.3 });
}

// ---- bubble-tip anemone -----------------------------------------------------------------
export function anemone(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  // column and oral disc
  const col = [];
  for (let k = 0; k <= 5; k++) {
    const u = k / 5;
    col.push({ p: [0, -0.04 + u * 0.12, 0], r: 0.11 + 0.05 * u * u, aux: [0, 0, 0, 0] });
  }
  m.tube(col, 24, false);
  const disc = m.add(0, 0.085, 0, 0, 1, 0, 0, 0, 0, 0);
  const rimStart = m.count - 1 - 24;
  for (let s = 0; s < 24; s++) m.tri(disc, rimStart + ((s + 1) % 24), rimStart + s);
  const N = 80 + rng.int(20);
  for (let k = 0; k < N; k++) {
    const u = Math.sqrt((k + 0.5) / N);
    const a = k * 2.39996 + rng.next() * 0.3;
    const rr = 0.02 + u * 0.15;
    const base = [Math.cos(a) * rr, 0.07, Math.sin(a) * rr];
    let d = norm([Math.cos(a) * (0.25 + u * 1.3), 1, Math.sin(a) * (0.25 + u * 1.3)]);
    const len = 0.17 + rng.next() * 0.09 - u * 0.03;
    const ph = rng.next() * TAU;
    const pts = [];
    const segs = 7;
    let q = base.slice();
    for (let s = 0; s <= segs; s++) {
      const v = s / segs;
      // bubble-tip: a swelling just below the tip
      const r = 0.012 * (1 - 0.3 * v) + 0.009 * Math.exp(-Math.pow((v - 0.85) / 0.12, 2));
      pts.push({ p: q.slice(), r, aux: [v * v, v, ph, 1] });
      d = norm([d[0] * 1.02, d[1] - 0.06, d[2] * 1.02]);
      q = [q[0] + d[0] * len / segs, q[1] + d[1] * len / segs, q[2] + d[2] * len / segs];
    }
    m.tube(pts, 6, true);
  }
  return m.finish({ height: 0.35, radius: 0.4 });
}

// ---- rubble -----------------------------------------------------------------------------
export function stone(seed) {
  const rng = new Rng(seed);
  const noise = makeNoise(seed);
  const m = new MeshBuilder();
  const rows = 10, segs = 16;
  const sx = 0.7 + rng.next() * 0.6, sy = 0.35 + rng.next() * 0.35, sz = 0.6 + rng.next() * 0.6;
  for (let i = 0; i <= rows; i++) {
    const th = (i / rows) * Math.PI;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU;
      let x = Math.sin(th) * Math.cos(a), y = Math.cos(th), z = Math.sin(th) * Math.sin(a);
      const b = 1 + 0.25 * noise.n3(x * 1.5, y * 1.5, z * 1.5);
      m.add(x * sx * b * 0.5, y * sy * b * 0.5, z * sz * b * 0.5, x / sx, y / sy, z / sz, 0, 0, 0, 0);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * (segs + 1) + s;
      m.quad(a, a + 1, a + segs + 2, a + segs + 1);
    }
  }
  return m.finish({ height: sy * 0.5, radius: 0.5 });
}

export function shell(seed) {
  const rng = new Rng(seed);
  const m = new MeshBuilder();
  // half of a ribbed bivalve, sometimes broken
  const rows = 10, segs = 24;
  const span = Math.PI * (0.65 + rng.next() * 0.35);
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    for (let s = 0; s <= segs; s++) {
      const a = -span / 2 + (s / segs) * span;
      const r = u * 0.5;
      const y = 0.18 * Math.sqrt(Math.max(0, 1 - u * u)) * 0.6 + 0.01 * Math.sin(a * 18) * u;
      m.add(Math.sin(a) * r, y, Math.cos(a) * r - 0.2, Math.sin(a) * u * 0.4, 1, Math.cos(a) * u * 0.4, 0, u, a * 18, 0);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * (segs + 1) + s;
      m.quad(a, a + 1, a + segs + 2, a + segs + 1);
    }
  }
  return m.finish({ height: 0.1, radius: 0.5 });
}

export const GENERATORS = { staghorn, brain, mushroom, plate, fan, leather, bubble, anemone, finger, stone, shell };
