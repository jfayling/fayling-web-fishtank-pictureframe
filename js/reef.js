// Reef construction. Live rock is a density field of stacked, noise-warped boulders with
// carved caves and passages, meshed with naive surface nets. The same field (plus the
// corals) is the obstacle field the fish steer around. Corals are placed on the rock
// surface by type-specific rules, and rubble and shells are scattered over the sand.
import { Rng, makeNoise, TAU, clamp, lerp, hexToRgb, srgbToLinear } from './math.js';
import { GENERATORS, CORAL_TYPES } from './coral-mesh.js';

export const TANK = { width: 14, height: 7.875, depth: 5, surfaceY: 7.875 };
// The simulated swimming volume. It is wider than the screen so fish can swim out of view.
export const FISH_BOUNDS = { xMin: -8.8, xMax: 8.8, yMin: 0.15, yMax: 6.9, zMin: -4.75, zMax: -0.4 };
export const ISO = 0.25;

// ---- scalar field on a regular grid -------------------------------------------------------
export class Field {
  constructor(x0, y0, z0, h, nx, ny, nz) {
    Object.assign(this, { x0, y0, z0, h, nx, ny, nz });
    this.data = new Float32Array(nx * ny * nz);
  }
  idx(i, j, k) { return (k * this.ny + j) * this.nx + i; }
  sample(x, y, z) {
    const fx = (x - this.x0) / this.h, fy = (y - this.y0) / this.h, fz = (z - this.z0) / this.h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= this.nx - 1 || fy >= this.ny - 1 || fz >= this.nz - 1) return 0;
    const i = fx | 0, j = fy | 0, k = fz | 0;
    const u = fx - i, v = fy - j, w = fz - k;
    const d = this.data, nx = this.nx, sxy = nx * this.ny;
    const o = (k * this.ny + j) * nx + i;
    const c00 = d[o] + (d[o + 1] - d[o]) * u;
    const c10 = d[o + nx] + (d[o + nx + 1] - d[o + nx]) * u;
    const c01 = d[o + sxy] + (d[o + sxy + 1] - d[o + sxy]) * u;
    const c11 = d[o + sxy + nx] + (d[o + sxy + nx + 1] - d[o + sxy + nx]) * u;
    const c0 = c00 + (c10 - c00) * v, c1 = c01 + (c11 - c01) * v;
    return c0 + (c1 - c0) * w;
  }
  gradient(x, y, z, out) {
    const e = this.h;
    out.x = (this.sample(x + e, y, z) - this.sample(x - e, y, z)) / (2 * e);
    out.y = (this.sample(x, y + e, z) - this.sample(x, y - e, z)) / (2 * e);
    out.z = (this.sample(x, y, z + e) - this.sample(x, y, z - e)) / (2 * e);
    return out;
  }
  // Splat an ellipsoid metaball with axes (ax, ay, az) scaled by radii (rx, ry, rz).
  splat(cx, cy, cz, ax, ay, az, rx, ry, rz, weight = 1, warp = null) {
    const R = Math.max(rx, ry, rz) + (warp ? 0.5 : 0);
    const { x0, y0, z0, h, nx, ny, nz } = this;
    const i0 = Math.max(0, Math.floor((cx - R - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((cx + R - x0) / h));
    const j0 = Math.max(0, Math.floor((cy - R - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((cy + R - y0) / h));
    const k0 = Math.max(0, Math.floor((cz - R - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((cz + R - z0) / h));
    const d = this.data;
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        let o = (k * ny + j) * nx + i0;
        for (let i = i0; i <= i1; i++, o++) {
          let px = x0 + i * h - cx, py = y0 + j * h - cy, pz = z0 + k * h - cz;
          if (warp) { px += warp[o * 3]; py += warp[o * 3 + 1]; pz += warp[o * 3 + 2]; }
          const lx = (px * ax[0] + py * ax[1] + pz * ax[2]) / rx;
          const ly = (px * ay[0] + py * ay[1] + pz * ay[2]) / ry;
          const lz = (px * az[0] + py * az[1] + pz * az[2]) / rz;
          const d2 = lx * lx + ly * ly + lz * lz;
          if (d2 < 1) { const q = 1 - d2; d[o] += weight * q * q; }
        }
      }
    }
  }
}

// ---- sand ---------------------------------------------------------------------------------
export function makeSand(seed) {
  const noise = makeNoise(seed + 17);
  return (x, z) => 0.05 + 0.09 * noise.n2(x * 0.28, z * 0.28) + 0.035 * noise.n2(x * 0.9 + 4, z * 0.9 - 2)
    + Math.max(0, -z - 2.5) * 0.045 - Math.max(0, z + 0.6) * 0.05;
}

// ---- reef layout ----------------------------------------------------------------------------
const yawAxes = (yaw) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
};

function layoutRock(rng, style) {
  if (style) return layoutStyled(rng, style);
  const blobs = [];
  const massif = (cx, cz, rx, rz, h, count, smin, smax, flat = 1) => {
    // grounded base layer
    const baseN = Math.ceil(count * 0.3);
    for (let k = 0; k < baseN; k++) {
      const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * 0.85;
      const s = smax * (0.9 + rng.next() * 0.4);
      blobs.push({ x: cx + Math.cos(a) * rr * rx, y: 0.05 + rng.next() * 0.25, z: cz + Math.sin(a) * rr * rz,
        rx: s * 1.2, ry: s * 0.6, rz: s * 1.05, yaw: rng.next() * TAU });
    }
    for (let k = 0; k < count; k++) {
      const a = rng.next() * TAU, rr = Math.sqrt(rng.next());
      const fall = 1 - rr * rr * 0.75;
      const y = Math.pow(rng.next(), 0.75) * h * fall;
      const s = lerp(smax, smin, y / h) * (0.7 + rng.next() * 0.5);
      blobs.push({ x: cx + Math.cos(a) * rr * rx, y, z: cz + Math.sin(a) * rr * rz,
        rx: s * (1 + rng.next() * 0.5), ry: s * (0.55 + rng.next() * 0.45) * flat, rz: s * (0.85 + rng.next() * 0.4), yaw: rng.next() * TAU });
    }
  };
  // main structures framing an open centre
  massif(-4.7, -2.5, 2.2, 1.5, 3.3, 46, 0.35, 0.95);
  massif(-8.6, -3.2, 2.6, 2.2, 4.0, 40, 0.4, 1.1);
  massif(4.5, -2.4, 2.1, 1.6, 3.8, 48, 0.35, 1.0);
  massif(8.8, -3.0, 2.6, 2.2, 3.3, 36, 0.4, 1.1);
  massif(0.0, -4.55, 4.6, 0.75, 2.1, 40, 0.3, 0.8, 0.9);
  massif(1.2, -3.7, 0.8, 0.7, 2.7, 14, 0.25, 0.6);
  // low foreground rocks near the glass
  massif(-1.9, -1.15, 0.6, 0.45, 0.75, 7, 0.22, 0.42);
  massif(2.3, -1.1, 0.55, 0.4, 0.55, 6, 0.2, 0.38);
  // the anemone rock
  blobs.push({ x: -2.6, y: 0.45, z: -1.75, rx: 0.95, ry: 0.55, rz: 0.75, yaw: 0.4 });
  blobs.push({ x: -2.9, y: 0.95, z: -1.95, rx: 0.7, ry: 0.4, rz: 0.6, yaw: 1.3 });
  // solid mass around the moray cave
  blobs.push({ x: 4.5, y: 1.0, z: -2.2, rx: 1.7, ry: 1.25, rz: 1.8, yaw: 0.5 });
  // an arch on the left structure
  blobs.push({ x: -5.6, y: 2.35, z: -2.0, rx: 1.4, ry: 0.42, rz: 0.75, yaw: -0.2 });
  // distant reef, softened by the water
  massif(0, -8.6, 12, 1.6, 3.6, 70, 0.6, 1.5);
  massif(-4.0, -6.6, 2.5, 1.0, 2.5, 22, 0.45, 1.0);
  massif(5.0, -6.9, 2.8, 1.0, 2.8, 24, 0.45, 1.0);
  const tunnels = [
    { a: [-4.3, 0.85, -0.6], b: [-4.9, 1.0, -4.3], r: 0.55 },     // swim-through passage on the left
    { a: [-6.2, 1.55, -1.2], b: [-5.2, 1.6, -3.0], r: 0.5 },      // under the arch
    { a: [3.35, 0.82, -0.5], b: [5.7, 0.95, -3.45], r: 0.3 },     // moray cave
    { a: [2.5, 2.1, -1.1], b: [3.6, 2.1, -2.9], r: 0.5 },         // overhang on the right
    { a: [-0.9, 1.05, -3.6], b: [-0.9, 1.05, -5.7], r: 0.55 },    // window through the back ridge
    { a: [6.2, 1.7, -1.4], b: [6.8, 2.0, -4.0], r: 0.45 },
  ];
  return { blobs, tunnels, moray: { inner: [5.7, 0.95, -3.45], outer: [3.35, 0.82, -0.5] } };
}

// Same blob scatter as the classic reef, aimed by a scene's massif list.
function layoutStyled(rng, style) {
  const blobs = [];
  const massif = (cx, cz, rx, rz, h, count, smin, smax, flat = 1) => {
    const baseN = Math.ceil(count * 0.3);
    for (let k = 0; k < baseN; k++) {
      const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * 0.85;
      const s = smax * (0.9 + rng.next() * 0.4);
      blobs.push({ x: cx + Math.cos(a) * rr * rx, y: 0.05 + rng.next() * 0.25, z: cz + Math.sin(a) * rr * rz,
        rx: s * 1.2, ry: s * 0.6, rz: s * 1.05, yaw: rng.next() * TAU });
    }
    for (let k = 0; k < count; k++) {
      const a = rng.next() * TAU, rr = Math.sqrt(rng.next());
      const fall = 1 - rr * rr * 0.75;
      const y = Math.pow(rng.next(), 0.75) * h * fall;
      const s = lerp(smax, smin, y / h) * (0.7 + rng.next() * 0.5);
      blobs.push({ x: cx + Math.cos(a) * rr * rx, y, z: cz + Math.sin(a) * rr * rz,
        rx: s * (1 + rng.next() * 0.5), ry: s * (0.55 + rng.next() * 0.45) * flat, rz: s * (0.85 + rng.next() * 0.4), yaw: rng.next() * TAU });
    }
  };
  for (const m of style.massifs) massif(...m);
  for (const b of style.blobs) blobs.push(b);
  return { blobs, tunnels: style.tunnels, moray: style.moray };
}

// Rock arrangements for every scene except Day reef, which keeps the original layout.
// massifs: cx, cz, rx, rz, height, blob count, small, large, optional flatness.
// Each one keeps a moray cave and rocks under the anemones.
export const FORMATIONS = {
  lagoon: {
    seed: 12011,
    massifs: [
      [-6.2, -2.2, 1.6, 1.3, 1.5, 28, 0.3, 0.7, 0.75],
      [-1.5, -3.4, 1.8, 1.4, 1.35, 26, 0.28, 0.65, 0.7],
      [3.2, -2.0, 1.5, 1.2, 1.45, 24, 0.28, 0.7, 0.75],
      [7.0, -3.3, 1.8, 1.5, 1.6, 22, 0.3, 0.75, 0.7],
      [0.4, -5.6, 3.2, 1.1, 1.2, 30, 0.35, 0.7, 0.65],
    ],
    blobs: [
      { x: -4.2, y: 0.35, z: -1.7, rx: 0.8, ry: 0.4, rz: 0.65, yaw: 0.4 },
      { x: 1.1, y: 0.4, z: -1.85, rx: 0.75, ry: 0.38, rz: 0.6, yaw: 1.1 },
      { x: 5.4, y: 0.35, z: -1.6, rx: 0.7, ry: 0.36, rz: 0.55, yaw: 0.2 },
      { x: -7.2, y: 0.7, z: -2.4, rx: 1.5, ry: 0.9, rz: 1.4, yaw: 0.6 },
    ],
    tunnels: [
      { a: [-6.2, 0.55, -1.3], b: [-8.0, 0.7, -3.3], r: 0.32 },
    ],
    moray: { inner: [-8.0, 0.7, -3.3], outer: [-6.2, 0.55, -1.3] },
    anemones: [[-4.2, -1.55, 1.15], [1.1, -1.7, 1.2], [5.4, -1.45, 1.05]],
    coral: { staghorn: 8, fan: 3, brain: 16, leather: 6, plate: 6, finger: 8, bubble: 6, staghorn2: 4, finger2: 6, brain2: 10, mushrooms: 16, sandBrain: 6, stones: 80, shells: 40 },
  },
  morning: {
    seed: 33407,
    massifs: [
      [-5.5, -2.6, 2.4, 1.6, 2.2, 40, 0.32, 0.85],
      [0.2, -2.3, 2.8, 1.5, 1.8, 44, 0.3, 0.8, 0.85],
      [5.8, -2.7, 2.3, 1.6, 2.4, 40, 0.32, 0.9],
      [0, -5.2, 5.5, 1.2, 2.8, 48, 0.4, 1.0, 0.9],
      [-3.2, -1.15, 0.7, 0.4, 0.6, 6, 0.2, 0.35],
    ],
    blobs: [
      { x: -2.2, y: 0.5, z: -1.6, rx: 0.85, ry: 0.45, rz: 0.7, yaw: 0.3 },
      { x: 2.4, y: 0.55, z: -1.7, rx: 0.8, ry: 0.42, rz: 0.65, yaw: 1.2 },
      { x: 6.6, y: 0.5, z: -1.9, rx: 0.75, ry: 0.4, rz: 0.6, yaw: 0.5 },
      { x: -6.8, y: 1.1, z: -2.5, rx: 1.6, ry: 1.15, rz: 1.5, yaw: 0.4 },
      { x: 0.2, y: 1.7, z: -2.5, rx: 1.6, ry: 0.35, rz: 0.55, yaw: 0.1 },
    ],
    tunnels: [
      { a: [-5.6, 0.7, -1.2], b: [-7.6, 0.9, -3.5], r: 0.34 },
      { a: [-1.2, 1.15, -2.0], b: [1.4, 1.2, -3.2], r: 0.42 },
    ],
    moray: { inner: [-7.6, 0.9, -3.5], outer: [-5.6, 0.7, -1.2] },
    anemones: [[-2.2, -1.45, 1.2], [2.4, -1.55, 1.15], [6.6, -1.75, 1.05]],
    coral: { staghorn: 26, fan: 6, brain: 8, leather: 8, plate: 8, finger: 20, bubble: 6, staghorn2: 14, finger2: 12, brain2: 6, mushrooms: 8 },
  },
  sunset: {
    seed: 55103,
    massifs: [
      [-7.4, -2.8, 1.8, 1.6, 3.6, 36, 0.4, 1.05],
      [6.2, -2.6, 2.4, 1.8, 4.2, 52, 0.4, 1.15],
      [2.0, -5.4, 2.2, 1.2, 3.2, 28, 0.4, 0.95],
      [-1.0, -1.2, 0.5, 0.4, 0.5, 5, 0.2, 0.35],
    ],
    blobs: [
      { x: 5.4, y: 1.15, z: -2.3, rx: 1.8, ry: 1.35, rz: 1.7, yaw: 0.3 },
      { x: -6.5, y: 2.4, z: -2.2, rx: 1.3, ry: 0.4, rz: 0.7, yaw: -0.3 },
      { x: -3.4, y: 0.45, z: -1.7, rx: 0.8, ry: 0.42, rz: 0.65, yaw: 0.8 },
      { x: 1.6, y: 0.4, z: -2.4, rx: 0.7, ry: 0.38, rz: 0.6, yaw: 0.2 },
      { x: 8.2, y: 0.55, z: -1.8, rx: 0.75, ry: 0.4, rz: 0.6, yaw: 1.0 },
    ],
    tunnels: [
      { a: [4.2, 0.9, -0.7], b: [6.4, 1.05, -3.5], r: 0.32 },
      { a: [5.5, 2.3, -1.2], b: [6.6, 2.4, -3.2], r: 0.48 },
      { a: [-6.0, 1.5, -1.3], b: [-7.2, 1.6, -3.4], r: 0.4 },
    ],
    moray: { inner: [6.4, 1.05, -3.5], outer: [4.2, 0.9, -0.7] },
    anemones: [[-3.4, -1.55, 1.1], [1.6, -2.2, 1.15], [8.2, -1.65, 1.0]],
    coral: { staghorn: 10, fan: 14, brain: 8, leather: 6, plate: 18, finger: 8, bubble: 5, staghorn2: 4, finger2: 4, brain2: 4, mushrooms: 6 },
  },
  moonlight: {
    seed: 77213,
    massifs: [
      [0, -4.3, 6.5, 1.3, 3.4, 55, 0.4, 1.05, 0.95],
      [-7.6, -2.6, 1.7, 1.8, 2.8, 32, 0.35, 0.95],
      [7.6, -2.6, 1.7, 1.8, 2.6, 32, 0.35, 0.95],
      [-2.2, -1.3, 0.7, 0.45, 0.7, 6, 0.2, 0.4],
      [2.6, -1.25, 0.65, 0.4, 0.65, 6, 0.2, 0.38],
    ],
    blobs: [
      { x: -5.5, y: 1.0, z: -2.6, rx: 1.6, ry: 1.2, rz: 1.5, yaw: 0.5 },
      { x: 0.2, y: 2.15, z: -3.6, rx: 1.5, ry: 0.4, rz: 0.7, yaw: 0.15 },
      { x: -2.4, y: 0.45, z: -1.55, rx: 0.8, ry: 0.4, rz: 0.65, yaw: 0.6 },
      { x: 2.8, y: 0.42, z: -1.5, rx: 0.75, ry: 0.38, rz: 0.6, yaw: 1.1 },
      { x: -7.0, y: 0.5, z: -1.8, rx: 0.7, ry: 0.36, rz: 0.55, yaw: 0.2 },
    ],
    tunnels: [
      { a: [-4.4, 0.75, -1.2], b: [-6.4, 0.9, -3.6], r: 0.32 },
      { a: [0.2, 1.3, -2.6], b: [0.2, 1.35, -5.4], r: 0.55 },
    ],
    moray: { inner: [-6.4, 0.9, -3.6], outer: [-4.4, 0.75, -1.2] },
    anemones: [[-2.4, -1.4, 1.1], [2.8, -1.35, 1.15], [-7.0, -1.65, 0.95]],
    coral: { staghorn: 8, fan: 8, brain: 10, leather: 14, plate: 10, finger: 8, bubble: 14, staghorn2: 4, finger2: 4, brain2: 6, mushrooms: 8 },
  },
  deep: {
    seed: 99041,
    massifs: [
      [-6.8, -3.0, 1.5, 2.4, 4.4, 48, 0.45, 1.2],
      [6.8, -3.0, 1.5, 2.4, 4.2, 48, 0.45, 1.15],
      [0, -7.2, 3, 1.2, 3.5, 24, 0.5, 1.1],
      [-2.4, -1.4, 0.45, 0.35, 0.4, 4, 0.18, 0.3],
    ],
    blobs: [
      { x: -6.2, y: 1.2, z: -2.5, rx: 1.7, ry: 1.3, rz: 1.6, yaw: 0.4 },
      { x: -1.5, y: 0.35, z: -2.2, rx: 0.65, ry: 0.32, rz: 0.5, yaw: 0.7 },
      { x: 1.8, y: 0.32, z: -2.6, rx: 0.6, ry: 0.3, rz: 0.5, yaw: 0.2 },
      { x: 6.4, y: 0.45, z: -1.7, rx: 0.7, ry: 0.35, rz: 0.55, yaw: 1.0 },
    ],
    tunnels: [
      { a: [-4.8, 0.85, -0.9], b: [-7.2, 1.05, -3.8], r: 0.34 },
      { a: [-6.5, 2.4, -1.5], b: [-7.2, 2.5, -4.2], r: 0.42 },
    ],
    moray: { inner: [-7.2, 1.05, -3.8], outer: [-4.8, 0.85, -0.9] },
    anemones: [[-1.5, -2.05, 1.0], [1.8, -2.4, 0.95], [6.4, -1.55, 1.05]],
    coral: { staghorn: 6, fan: 6, brain: 6, leather: 4, plate: 8, finger: 5, bubble: 4, staghorn2: 3, finger2: 3, brain2: 3, mushrooms: 4, stones: 220, shells: 40 },
  },
};

export function reefSpec(sceneId, configSeed) {
  const style = FORMATIONS[sceneId];
  if (!style) return { key: 'reef:' + configSeed, seed: configSeed, formation: null };
  return { key: sceneId + ':' + style.seed, seed: style.seed, formation: sceneId };
}

const PALETTES = {
  staghorn: [['#a98bb8', '#e7dcef'], ['#c9b596', '#f0e8d6'], ['#7f9a8a', '#bfe0e3'], ['#9c7c62', '#e6cfae'], ['#8d7fb6', '#b5d6ea']],
  brain: [['#7b6a3f', '#a9c08a'], ['#8a5a3c', '#d9b98a'], ['#5f7a55', '#c7d6a0'], ['#6c5a7a', '#bfa7c9'], ['#9a7b45', '#7fb0a6']],
  mushroom: [['#7c3f63', '#5f9a6d'], ['#a9653a', '#d8a35a'], ['#3f6f74', '#9fd0c0'], ['#6a4b86', '#c08fb4']],
  plate: [['#8a6243', '#d4b089'], ['#7a5a86', '#c7b0d6'], ['#9a7a40', '#e0cc8a'], ['#6f7d5a', '#c4d2a2']],
  fan: [['#7d4a8e', '#a06cb0'], ['#b0663a', '#d6894c'], ['#b89a3e', '#dcc26a'], ['#8b3f55', '#b46a7d']],
  leather: [['#a88f62', '#d4c08e'], ['#8f8a52', '#c4c086'], ['#a68670', '#d6b89c']],
  bubble: [['#d8d2b0', '#f2eedc'], ['#b9cfa8', '#e6f0d4']],
  anemone: [['#9c9a64', '#c77a99'], ['#8a6c52', '#d8879a'], ['#a8885a', '#9fd0a8']],
  finger: [['#9b83b1', '#cdbfe0'], ['#c9b98f', '#efe5c8'], ['#88a27e', '#c8dcb4'], ['#b07a8a', '#e2bcc4']],
  stone: [['#9a958a', '#c9c2b2'], ['#7d786f', '#b0a898'], ['#b0a690', '#ddd3bd']],
  shell: [['#e6dccb', '#a57e5a'], ['#efe6d6', '#c49a74'], ['#ddd2c2', '#8f7a6a']],
};
const lin = (hex) => hexToRgb(hex).map(srgbToLinear);

// ---- construction -------------------------------------------------------------------------
export function buildReef(seed, formation) {
  const style = formation ? FORMATIONS[formation] : null;
  const t0 = performance.now();
  const rng = new Rng(seed);
  const noise = makeNoise(seed);
  const sandHeight = makeSand(seed);
  const h = 0.1;
  const X0 = -13.5, X1 = 13.5, Y0 = -0.7, Y1 = 5.4, Z0 = -10.8, Z1 = -0.1;
  const nx = Math.round((X1 - X0) / h) + 1, ny = Math.round((Y1 - Y0) / h) + 1, nz = Math.round((Z1 - Z0) / h) + 1;
  const field = new Field(X0, Y0, Z0, h, nx, ny, nz);
  const N = nx * ny * nz;

  // low-frequency domain warp, evaluated on a coarse grid and interpolated
  const cw = 0.25, cnx = Math.ceil((X1 - X0) / cw) + 2, cny = Math.ceil((Y1 - Y0) / cw) + 2, cnz = Math.ceil((Z1 - Z0) / cw) + 2;
  const coarse = new Float32Array(cnx * cny * cnz * 3);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    const x = X0 + i * cw, y = Y0 + j * cw, z = Z0 + k * cw;
    const o = ((k * cny + j) * cnx + i) * 3;
    coarse[o] = 0.38 * noise.n3(x * 0.42, y * 0.42, z * 0.42) + 0.14 * noise.n3(x * 1.25 + 7, y * 1.25, z * 1.25);
    coarse[o + 1] = 0.3 * noise.n3(x * 0.42 + 31, y * 0.42, z * 0.42) + 0.12 * noise.n3(x * 1.25 + 3, y * 1.25 + 9, z * 1.25);
    coarse[o + 2] = 0.38 * noise.n3(x * 0.42, y * 0.42 + 57, z * 0.42) + 0.14 * noise.n3(x * 1.25, y * 1.25, z * 1.25 + 5);
  }
  const warp = new Float32Array(N * 3);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const fx = (i * h) / cw, fy = (j * h) / cw, fz = (k * h) / cw;
    const ci = fx | 0, cj = fy | 0, ck = fz | 0, u = fx - ci, v = fy - cj, w = fz - ck;
    const o = ((k * ny + j) * nx + i) * 3;
    for (let c = 0; c < 3; c++) {
      const at = (a, b, d) => coarse[(((ck + d) * cny + cj + b) * cnx + ci + a) * 3 + c];
      const x00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * u, x10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * u;
      const x01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * u, x11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * u;
      const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
      warp[o + c] = y0 + (y1 - y0) * w;
    }
  }

  const layout = layoutRock(rng, style);
  for (const b of layout.blobs) {
    const [ax, ay, az] = yawAxes(b.yaw);
    field.splat(b.x, b.y, b.z, ax, ay, az, b.rx / 0.7071, b.ry / 0.7071, b.rz / 0.7071, 1, warp);
  }
  // craggy detail near the surface, then carve the caves
  const d = field.data;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = (k * ny + j) * nx + i;
    const f = d[o];
    if (f < 0.04 || f > 0.9) continue;
    const x = X0 + i * h, y = Y0 + j * h, z = Z0 + k * h;
    const r1 = 1 - Math.abs(noise.n3(x * 1.9, y * 1.9, z * 1.9));
    const r2 = noise.n3(x * 4.1 + 11, y * 4.1, z * 4.1);
    d[o] = f + 0.2 * (r1 - 0.55) + 0.07 * r2;
  }
  for (const t of layout.tunnels) {
    const [ax, ay, az] = t.a, bx = t.b[0] - ax, by = t.b[1] - ay, bz = t.b[2] - az;
    const L2 = bx * bx + by * by + bz * bz;
    const R = t.r + 0.4;
    const i0 = Math.max(0, Math.floor((Math.min(ax, t.b[0]) - R - X0) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, t.b[0]) + R - X0) / h));
    const j0 = Math.max(0, Math.floor((Math.min(ay, t.b[1]) - R - Y0) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, t.b[1]) + R - Y0) / h));
    const k0 = Math.max(0, Math.floor((Math.min(az, t.b[2]) - R - Z0) / h)), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, t.b[2]) + R - Z0) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = (k * ny + j) * nx + i;
      const px = X0 + i * h + warp[o * 3] * 0.35 - ax, py = Y0 + j * h + warp[o * 3 + 1] * 0.35 - ay, pz = Z0 + k * h + warp[o * 3 + 2] * 0.35 - az;
      const s = clamp((px * bx + py * by + pz * bz) / L2, 0, 1);
      const qx = px - bx * s, qy = py - by * s, qz = pz - bz * s;
      const dd = Math.sqrt(qx * qx + qy * qy + qz * qz) / t.r;
      if (dd < 1.6) d[o] -= 1.6 * Math.max(0, 1 - (dd * dd) / 2.56) ** 2 * (dd < 1 ? 2.5 : 1);
    }
  }
  // nothing above the reef's ceiling or touching the glass
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const z = Z0 + k * h;
    if (z > -0.45 || j === ny - 1) d[(k * ny + j) * nx + i] = Math.min(d[(k * ny + j) * nx + i], 0);
  }
  const tField = performance.now();

  const rock = surfaceNets(field, ISO);
  bakeRockAO(rock, field);
  const tMesh = performance.now();

  // ---- sand ---------------------------------------------------------------------------
  const sand = buildSand(sandHeight, field);

  // ---- corals ---------------------------------------------------------------------------
  const obstacle = new Field(X0, Y0, Z0, h, nx, ny, nz);
  obstacle.data.set(field.data);
  const corals = placeCorals(rng, rock, field, obstacle, sandHeight, style);

  // ---- cave for the moray -------------------------------------------------------------
  const m = layout.moray;
  const dir = [m.outer[0] - m.inner[0], m.outer[1] - m.inner[1], m.outer[2] - m.inner[2]];
  const dl = Math.hypot(...dir);
  const dirOut = dir.map((v) => v / dl);
  let mouth = m.outer.slice();
  for (let s = 0.5; s < dl; s += 0.02) {
    const p = [m.inner[0] + dirOut[0] * s, m.inner[1] + dirOut[1] * s, m.inner[2] + dirOut[2] * s];
    // the mouth is where rock stops surrounding the tunnel
    let solid = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * TAU;
      solid += field.sample(p[0] + Math.cos(ang) * 0.45 * dirOut[2], p[1] + Math.sin(ang) * 0.45, p[2] - Math.cos(ang) * 0.45 * dirOut[0]) > ISO ? 1 : 0;
    }
    if (solid < 4) { mouth = p; break; }
  }

  // ---- points of interest for behavior ------------------------------------------------
  const shelter = [], ledges = [];
  const vp = rock.positions, vn = rock.normals, ao = rock.ao;
  for (let i = 0; i < rock.count; i += 3) {
    const x = vp[i * 3], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
    if (x < FISH_BOUNDS.xMin + 0.5 || x > FISH_BOUNDS.xMax - 0.5 || z < FISH_BOUNDS.zMin + 0.3 || z > FISH_BOUNDS.zMax - 0.3) continue;
    const nX = vn[i * 3], nY = vn[i * 3 + 1], nZ = vn[i * 3 + 2];
    if (nZ < -0.4) continue;
    if (ao[i] > 0.22 && ao[i] < 0.6 && y > 0.4) shelter.push([x + nX * 0.4, y + nY * 0.4, z + nZ * 0.4]);
    if ((nY < -0.25 || ao[i] < 0.45) && y > 0.4 && y < 3.2) ledges.push([x + nX * 0.28, y + nY * 0.28, z + nZ * 0.28]);
  }
  const bubbleSources = [];
  for (let tries = 0; tries < 4000 && bubbleSources.length < 5; tries++) {
    const i = rng.int(rock.count);
    const y = vp[i * 3 + 1], x = vp[i * 3], z = vp[i * 3 + 2];
    if (vn[i * 3 + 1] > 0.75 && y > 1.2 && Math.abs(x) < 6.2 && z > -4.6 && z < -1.2 && ao[i] < 0.8 &&
      bubbleSources.every((b) => Math.hypot(b[0] - x, b[2] - z) > 2.2)) bubbleSources.push([x, y, z]);
  }

  console.log(`reef: field ${(tField - t0).toFixed(0)} ms, mesh ${(tMesh - tField).toFixed(0)} ms (${rock.count} verts), total ${(performance.now() - t0).toFixed(0)} ms`);
  return {
    field, obstacle, sandHeight, rock, sand, corals,
    moray: { mouth, dirOut, inner: m.inner },
    shelter, ledges, bubbleSources,
  };
}

// ---- naive surface nets -----------------------------------------------------------------------
function surfaceNets(field, iso) {
  const { nx, ny, nz, x0, y0, z0, h, data } = field;
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = data[((k + (c >> 2)) * ny + j + ((c >> 1) & 1)) * nx + i + (c & 1)];
          corner[c] = v;
          if (v > iso) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of E) {
          const va = corner[a], vb = corner[b];
          if ((va > iso) === (vb > iso)) continue;
          const t = (iso - va) / (vb - va);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
          cnt++;
        }
        cellV[(k * cny + j) * cnx + i] = pos.length / 3;
        pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h);
      }
    }
  }
  const idx = [];
  const cell = (i, j, k) => cellV[(k * cny + j) * cnx + i];
  const emit = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cnz; k++) {
    for (let j = 1; j < cny; j++) {
      for (let i = 1; i < cnx; i++) {
        const v0 = data[(k * ny + j) * nx + i] > iso;
        if (i < cnx && (data[(k * ny + j) * nx + i + 1] > iso) !== v0)
          emit(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !v0);
        if ((data[(k * ny + j + 1) * nx + i] > iso) !== v0)
          emit(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !v0);
        if ((data[((k + 1) * ny + j) * nx + i] > iso) !== v0)
          emit(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !v0);
      }
    }
  }
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const g = { x: 0, y: 0, z: 0 };
  for (let v = 0; v < count; v++) {
    field.gradient(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], g);
    const l = Math.hypot(g.x, g.y, g.z) || 1;
    normals[v * 3] = -g.x / l; normals[v * 3 + 1] = -g.y / l; normals[v * 3 + 2] = -g.z / l;
  }
  return { positions, normals, indices: new Uint32Array(idx), count, ao: new Float32Array(count) };
}

function bakeRockAO(rock, field) {
  const dirs = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    dirs.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  const dists = [0.18, 0.42, 0.9, 1.7];
  const { positions: p, normals: nn, ao, count } = rock;
  for (let v = 0; v < count; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const nX = nn[v * 3], nY = nn[v * 3 + 1], nZ = nn[v * 3 + 2];
    let occ = 0, tot = 0;
    for (const dd of dirs) {
      const c = dd[0] * nX + dd[1] * nY + dd[2] * nZ;
      if (c < 0.15) continue;
      for (let q = 0; q < dists.length; q++) {
        const s = dists[q], w = c / (1 + q * 0.6);
        const f = field.sample(x + (dd[0] + nX * 0.3) * s, y + (dd[1] + nY * 0.3) * s, z + (dd[2] + nZ * 0.3) * s);
        occ += w * clamp(f / (ISO * 1.4), 0, 1);
        tot += w;
      }
    }
    // overhead light reaching down into caves and under ledges
    let sky = 0;
    for (const s of [0.4, 0.9, 1.8, 3.2]) sky += clamp(field.sample(x + nX * 0.15, y + s, z + nZ * 0.15) / ISO, 0, 1);
    ao[v] = clamp(1 - 1.5 * (occ / Math.max(1e-6, tot)), 0.04, 1) * (1 - 0.17 * sky);
  }
}

function buildSand(sandHeight, field) {
  const X0 = -18, X1 = 18, Z0 = -13, Z1 = 2.5;
  const cols = 220, rows = 110;
  const verts = new Float32Array((cols + 1) * (rows + 1) * 7);
  const idx = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = X0 + ((X1 - X0) * c) / cols, z = Z0 + ((Z1 - Z0) * r) / rows;
      verts[o++] = x; verts[o++] = sandHeight(x, z); verts[o++] = z;
      const e = 0.05;
      const dx = (sandHeight(x + e, z) - sandHeight(x - e, z)) / (2 * e), dz = (sandHeight(x, z + e) - sandHeight(x, z - e)) / (2 * e);
      const nl = Math.hypot(dx, 1, dz);
      verts[o++] = -dx / nl; verts[o++] = 1 / nl; verts[o++] = -dz / nl;
      // occlusion from nearby rock, so sand darkens where it meets the reef
      let occ = 0;
      const y = sandHeight(x, z);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * TAU;
        occ += clamp(field.sample(x + Math.cos(ang) * 0.35, y + 0.12, z + Math.sin(ang) * 0.35) / ISO, 0, 1) * 0.6;
        occ += clamp(field.sample(x + Math.cos(ang) * 0.8, y + 0.4, z + Math.sin(ang) * 0.8) / ISO, 0, 1) * 0.35;
      }
      occ += clamp(field.sample(x, y + 0.8, z) / ISO, 0, 1) * 2 + clamp(field.sample(x, y + 1.6, z) / ISO, 0, 1) * 1.5;
      verts[o++] = clamp(1 - occ / 9, 0.12, 1);
    }
  }
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c;
    idx[k++] = a; idx[k++] = a + cols + 1; idx[k++] = a + cols + 2;
    idx[k++] = a; idx[k++] = a + cols + 2; idx[k++] = a + 1;
  }
  return { vertices: verts, indices: idx };
}

// ---- coral placement ------------------------------------------------------------------------
function placeCorals(rng, rock, field, obstacle, sandHeight, style) {
  const variants = {};   // type name -> [mesh, ...]
  const VCOUNT = { staghorn: 4, brain: 3, mushroom: 3, plate: 3, fan: 3, leather: 3, bubble: 2, anemone: 2, finger: 3, stone: 5, shell: 3 };
  for (const [name, n] of Object.entries(VCOUNT)) {
    variants[name] = [];
    for (let v = 0; v < n; v++) variants[name].push(GENERATORS[name](rng.int(1e9)));
  }
  const instances = [];
  const placed = [];
  const { positions: P, normals: Nn, ao: AO, count } = rock;
  const cand = [];
  for (let i = 0; i < count; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < -10 || x > 10 || z < -5.4 || z > -0.5 || y < sandHeight(x, z) + 0.1) continue;
    cand.push(i);
  }
  const free = (x, y, z, r) => placed.every((q) => Math.hypot(q[0] - x, q[1] - y, q[2] - z) > (q[3] + r) * 0.8);
  const anemones = [];

  function basis(up, fwdHint) {
    const ul = Math.hypot(...up);
    const u = up.map((v) => v / ul);
    let f = fwdHint;
    const dp = f[0] * u[0] + f[1] * u[1] + f[2] * u[2];
    f = [f[0] - u[0] * dp, f[1] - u[1] * dp, f[2] - u[2] * dp];
    const fl = Math.hypot(...f) || 1;
    f = f.map((v) => v / fl);
    const r = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    return { r, u, f };
  }
  function add(name, variant, pos, b, scale, opts = {}) {
    const mesh = variants[name][variant];
    const type = CORAL_TYPES[name];
    const pal = rng.pick(PALETTES[name]);
    const jitter = () => 0.9 + rng.next() * 0.2;
    const ca = lin(pal[0]).map((c) => c * jitter()), cb = lin(pal[1]).map((c) => c * jitter());
    const ao = opts.ao ?? 1;
    instances.push({ name, type, variant, pos, b, scale, colorA: ca, colorB: cb, ao, phase: rng.next() * TAU, sway: opts.sway ?? 1 });
    const H = mesh.height * scale, R = mesh.radius * scale;
    placed.push([pos[0] + b.u[0] * H * 0.5, pos[1] + b.u[1] * H * 0.5, pos[2] + b.u[2] * H * 0.5, Math.max(R, H * 0.5)]);
    if (name === 'anemone') { anemones.push({ pos: [pos[0], pos[1] + 0.15 * scale, pos[2]], radius: R }); return; }
    if (name === 'stone' || name === 'shell' || name === 'mushroom') return;
    if (name === 'fan') obstacle.splat(pos[0] + b.u[0] * H * 0.5, pos[1] + b.u[1] * H * 0.5, pos[2] + b.u[2] * H * 0.5, b.r, b.u, b.f, R * 0.95, H * 0.6, 0.18 * scale, 0.9);
    else obstacle.splat(pos[0] + b.u[0] * H * 0.4, pos[1] + b.u[1] * H * 0.4, pos[2] + b.u[2] * H * 0.4, b.r, b.u, b.f, R * 0.95, H * 0.75, R * 0.95, 0.9);
  }
  function scatter(name, n, test, scaleRange, orient, spacing = 1) {
    let made = 0;
    for (let tries = 0; tries < 6000 && made < n; tries++) {
      const i = cand[rng.int(cand.length)];
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const nrm = [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]];
      if (!test(x, y, z, nrm, AO[i])) continue;
      const scale = scaleRange[0] + rng.next() * (scaleRange[1] - scaleRange[0]);
      const v = rng.int(variants[name].length);
      const mesh = variants[name][v];
      const R = Math.max(mesh.radius, mesh.height * 0.5) * scale * spacing;
      if (!free(x, y, z, R)) continue;
      const b = orient(nrm);
      add(name, v, [x - nrm[0] * 0.03, y - nrm[1] * 0.03, z - nrm[2] * 0.03], b, scale, { ao: AO[i] });
      made++;
    }
  }
  const upish = (k) => (n) => basis([n[0] * k, n[1] * k + (1 - k), n[2] * k], [Math.cos(rng.next() * TAU), 0, Math.sin(rng.next() * TAU)]);
  const n = {
    staghorn: 18, fan: 9, brain: 12, leather: 9, plate: 13, finger: 15, bubble: 8,
    staghorn2: 10, finger2: 10, brain2: 8, mushrooms: 10, sandBrain: 2, stones: 170, shells: 70,
  };
  if (style && style.coral) Object.assign(n, style.coral);
  const anemoneSpots = style && style.anemones
    ? style.anemones
    : [[-2.55, -1.6, 1.25], [5.3, -1.9, 1.0], [-6.6, -1.6, 0.95]];

  // anemones first: the clownfish host sits on the anemone rock in clear view
  const topAt = (tx, tz, rad) => {
    let best = -1, by = -1e9;
    for (const i of cand) {
      const x = P[i * 3], z = P[i * 3 + 2];
      if (Math.hypot(x - tx, z - tz) > rad || Nn[i * 3 + 1] < 0.6) continue;
      if (P[i * 3 + 1] > by) { by = P[i * 3 + 1]; best = i; }
    }
    return best;
  };
  for (const [tx, tz, s] of anemoneSpots) {
    const i = topAt(tx, tz, 0.6);
    if (i < 0) continue;
    const nrm = [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]];
    add('anemone', rng.int(2), [P[i * 3], P[i * 3 + 1] - 0.03, P[i * 3 + 2]], upish(0.35)(nrm), s, { ao: AO[i] });
  }
  scatter('staghorn', n.staghorn, (x, y, z, nrm, ao) => nrm[1] > 0.7 && ao > 0.48 && y > 0.9, [1.0, 1.6], upish(0.3));
  scatter('fan', n.fan, (x, y, z, nrm, ao) => nrm[1] > 0.55 && z < -2.2 && y > 1.2 && ao > 0.5, [1.0, 1.7],
    (nrm) => basis([nrm[0] * 0.15, 1, nrm[2] * 0.15], [Math.sin((rng.next() - 0.5) * 1.0), 0, Math.cos((rng.next() - 0.5) * 1.0)]), 0.8);
  scatter('brain', n.brain, (x, y, z, nrm, ao) => nrm[1] > 0.7 && ao > 0.45, [0.6, 1.1], upish(0.5));
  scatter('leather', n.leather, (x, y, z, nrm, ao) => nrm[1] > 0.72 && ao > 0.48, [1.0, 1.6], upish(0.3));
  scatter('plate', n.plate, (x, y, z, nrm, ao) => nrm[1] > -0.15 && nrm[1] < 0.5 && nrm[2] > 0.2 && ao > 0.35 && y > 0.6, [0.7, 1.2],
    (nrm) => basis([0, 1, 0], [nrm[0], 0, nrm[2]]));
  scatter('finger', n.finger, (x, y, z, nrm, ao) => nrm[1] > 0.62 && ao > 0.42, [0.95, 1.5], upish(0.4));
  scatter('bubble', n.bubble, (x, y, z, nrm, ao) => nrm[1] > 0.3 && ao > 0.3 && ao < 0.8, [0.95, 1.4], upish(0.6));
  // second, smaller generation filling the gaps
  scatter('staghorn', n.staghorn2, (x, y, z, nrm, ao) => nrm[1] > 0.6 && ao > 0.4, [0.6, 0.9], upish(0.4), 0.7);
  scatter('finger', n.finger2, (x, y, z, nrm, ao) => nrm[1] > 0.5 && ao > 0.4, [0.6, 0.9], upish(0.5), 0.7);
  scatter('brain', n.brain2, (x, y, z, nrm, ao) => nrm[1] > 0.55 && ao > 0.4, [0.35, 0.55], upish(0.6), 0.8);
  // mushroom clusters on low ledges
  for (let c = 0; c < n.mushrooms; c++) {
    for (let tries = 0; tries < 500; tries++) {
      const i = cand[rng.int(cand.length)];
      const y = P[i * 3 + 1];
      if (Nn[i * 3 + 1] < 0.6 || y > 2.6 || AO[i] < 0.4) continue;
      const cx = P[i * 3], cz = P[i * 3 + 2];
      let made = 0;
      for (let k = 0; k < 40 && made < 6; k++) {
        const j = cand[rng.int(cand.length)];
        if (Math.hypot(P[j * 3] - cx, P[j * 3 + 2] - cz) > 0.5 || Nn[j * 3 + 1] < 0.5) continue;
        const nrm = [Nn[j * 3], Nn[j * 3 + 1], Nn[j * 3 + 2]];
        const s = 0.14 + rng.next() * 0.1;
        if (!free(P[j * 3], P[j * 3 + 1], P[j * 3 + 2], s * 0.4)) continue;
        add('mushroom', rng.int(3), [P[j * 3], P[j * 3 + 1] - 0.01, P[j * 3 + 2]], upish(0.8)(nrm), s, { ao: AO[j] });
        made++;
      }
      break;
    }
  }
  // brain corals and rubble on the sand
  const onSand = (name, n, sr, nearRock) => {
    let made = 0;
    for (let tries = 0; tries < n * 30 && made < n; tries++) {
      const x = (rng.next() - 0.5) * 22, z = -0.5 - rng.next() * 6.5;
      const y = sandHeight(x, z);
      const f = field.sample(x, y + 0.08, z);
      if (f > ISO * 0.6) continue;
      if (nearRock && field.sample(x, y + 0.3, z) + field.sample(x + 0.6, y + 0.3, z) + field.sample(x - 0.6, y + 0.3, z) + field.sample(x, y + 0.3, z + 0.6) + field.sample(x, y + 0.3, z - 0.6) < 0.05 && rng.next() < 0.6) continue;
      const s = sr[0] + rng.next() * (sr[1] - sr[0]);
      const v = rng.int(variants[name].length);
      const yaw = rng.next() * TAU;
      const tilt = name === 'shell' ? 0.5 : 0.15;
      const b = basis([(rng.next() - 0.5) * tilt, 1, (rng.next() - 0.5) * tilt], [Math.cos(yaw), 0, Math.sin(yaw)]);
      if (name === 'brain' && !free(x, y, z, s * 0.5)) continue;
      add(name, v, [x, y - variants[name][v].height * s * (name === 'stone' ? 0.45 : 0.1), z], b, s, { ao: clamp(1 - f * 2, 0.3, 1) });
      made++;
    }
  };
  onSand('brain', n.sandBrain, [0.5, 0.75], true);
  onSand('stone', n.stones, [0.06, 0.24], true);
  onSand('shell', n.shells, [0.05, 0.1], false);

  return { variants, instances, anemones };
}
