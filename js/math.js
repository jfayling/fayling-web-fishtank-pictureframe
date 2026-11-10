// Small math library: seeded random numbers, gradient noise, vectors, and column-major
// 4x4 matrices laid out the way WGSL reads them.

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- random numbers ---------------------------------------------------------------------
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  pick(arr) { return arr[this.int(arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  normal() {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  // weighted choice over an object { key: weight }
  weighted(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = this.next() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return Object.keys(weights)[0];
  }
}

// ---- gradient noise ---------------------------------------------------------------------
export function makeNoise(seed) {
  const rng = new Rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = rng.int(i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function grad(h, x, y, z) { const g = (h % 12) * 3; return G[g] * x + G[g + 1] * y + G[g + 2] * z; }
  // classic Perlin noise in about [-1, 1]
  function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    const l1 = lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u);
    const l2 = lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u);
    const l3 = lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u);
    const l4 = lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u);
    return lerp(lerp(l1, l2, v), lerp(l3, l4, v), w);
  }
  function fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 0.5, s = 0, f = 1;
    for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); f *= lac; a *= gain; }
    return s;
  }
  return { n3, fbm3, n2: (x, y) => n3(x, y, 0.5 + seed * 0.013) };
}

// ---- vectors (plain objects mutated in place to avoid per-frame garbage) -----------------
export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  len() { return Math.hypot(this.x, this.y, this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.len(); if (l > 1e-9) this.scale(1 / l); return this; }
  clampLen(m) { const l = this.len(); if (l > m) this.scale(m / l); return this; }
  distTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distSq(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  crossOf(a, b) {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
  subOf(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
}

// ---- matrices (column-major Float32Array(16)) --------------------------------------------
export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = far / (near - far); out[11] = -1;
  out[14] = (far * near) / (near - far);
  return out;
}
export function ortho(out, l, r, b, t, n, f) {
  out.fill(0);
  out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = 1 / (n - f);
  out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = n / (n - f); out[15] = 1;
  return out;
}
export function lookAt(out, eye, target, up) {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  let l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
  let sx = fy * up[2] - fz * up[1], sy = fz * up[0] - fx * up[2], sz = fx * up[1] - fy * up[0];
  l = Math.hypot(sx, sy, sz); sx /= l; sy /= l; sz /= l;
  const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
  out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  out[15] = 1;
  return out;
}
export function mat4Mul(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
export function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// Smooth curve through [t, value] control points (cubic Hermite, Catmull-Rom tangents,
// clamped so the curve does not overshoot between neighbouring points).
export function curve(points) {
  const n = points.length;
  const tan = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[Math.min(n - 1, i + 1)];
    let m = (p1[1] - p0[1]) / Math.max(1e-6, p1[0] - p0[0]);
    if (i > 0 && i < n - 1) {
      const dl = points[i][1] - points[i - 1][1], dr = points[i + 1][1] - points[i][1];
      if (dl * dr <= 0) m = 0;
    }
    tan[i] = m;
  }
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    if (t >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (i < n - 2 && t > points[i + 1][0]) i++;
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    const h = t1 - t0, s = (t - t0) / h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * tan[i] + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * tan[i + 1];
  };
}

// Reverse any triangle whose counter-clockwise face normal points against its vertex normals,
// so front_facing in the shaders means "the side the normals point to".
export function orientTriangles(vertices, stride, indices) {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * stride, b = indices[t + 1] * stride, c = indices[t + 2] * stride;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const sx = vertices[a + 3] + vertices[b + 3] + vertices[c + 3];
    const sy = vertices[a + 4] + vertices[b + 4] + vertices[c + 4];
    const sz = vertices[a + 5] + vertices[b + 5] + vertices[c + 5];
    if (nx * sx + ny * sy + nz * sz < 0) { const k = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = k; }
  }
  return indices;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
