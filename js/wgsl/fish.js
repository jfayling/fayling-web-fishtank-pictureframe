// Fish: procedural swimming deformation and per-species colour patterns.
//
// Instance layout (5 x vec4, written by Aquarium.writeInstances):
//   i0 position xyz, body length      i1 heading xyz, tail phase
//   i2 up xyz, tail amplitude         i3 bend, pectoral phase, pectoral amplitude, turn asymmetry
//   i4 colour variant, light reaching the fish, jaw gape, median-fin phase
import { common } from './common.js';

const SPECIES_BLOCK = /* wgsl */ `
struct Species {
  a: vec4f,  // id, swim style, body wave number, median fin undulation
  b: vec4f,  // pivot, peduncle t, textured (0/1), pectoral fin length
  c: vec4f,  // eye t, eye y, scale frequency, unused
};
@group(1) @binding(0) var<uniform> SP: Species;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) buv: vec2f,
  @location(3) aux: vec4f,
  @location(4) tex: vec2f,
  @location(5) i0: vec4f,
  @location(6) i1: vec4f,
  @location(7) i2: vec4f,
  @location(8) i3: vec4f,
  @location(9) i4: vec4f,
};

struct Deformed { p: vec3f, n: vec3f };

fn deform(v: VIn) -> Deformed {
  var p = v.pos;
  var n = v.nrm;
  let part = i32(v.aux.x + 0.5);
  let style = i32(SP.a.y + 0.5);
  let t = v.buv.x;
  let phase = v.i1.w;
  let amp = v.i2.w;
  let bend = v.i3.x;

  // moray lower jaw swings open around its hinge
  if (part == 0 && v.aux.w > 0.0) {
    let ang = -v.i4.z * v.aux.w;
    let h = v.tex;
    let d = p.xy - h;
    let c = cos(ang); let s = sin(ang);
    p = vec3f(h + vec2f(d.x * c - d.y * s, d.x * s + d.y * c), p.z);
  }
  // paired fins row and flap; on a turn the outer fin sweeps harder
  if (part == 4 || part == 5) {
    let u = v.aux.z; let s = v.aux.w; let side = v.aux.y;
    let k = select(1.0, 0.45, part == 5);
    let dist = u * SP.b.w * k;
    let flap = sin(v.i3.y - u * 1.4 + s * 1.2 + select(0.0, 1.3, part == 5)) * v.i3.z;
    let asym = v.i3.w * side;
    p.z += side * dist * (flap * 0.85 + 0.25 + asym * 0.35);
    p.x += dist * flap * 0.3;
    n = normalize(n + vec3f(0.0, 0.0, side * flap * 0.3));
  }
  // dorsal and anal fins: travelling undulation (triggerfish) and a gentle flutter
  if (part == 2 || part == 3) {
    let u = v.aux.z;
    let und = SP.a.w * sin(v.i4.w - t * 22.0) * u;
    let flutter = 0.004 * sin(phase * 0.5 + t * 11.0) * u;
    p.z += und + flutter;
  }
  // caudal fin lags the body wave
  if (part == 1) {
    let u = v.aux.z;
    p.z += sin(phase - 1.1 - v.aux.w * 0.5) * amp * 0.45 * u * u;
  }

  // body wave: amplitude grows from a slight head yaw to the tail
  let tt = clamp(t, 0.0, 1.3);
  var env: f32; var denv: f32;
  if (style == 4) {
    let x = saturate(tt / 0.7);
    env = 0.25 + 0.75 * x * x * (3.0 - 2.0 * x);
    denv = 0.75 * 6.0 * x * (1.0 - x) / 0.7;
  } else {
    env = 0.1 - 0.3 * tt + 1.15 * tt * tt;
    denv = -0.3 + 2.3 * tt;
  }
  let k = SP.a.z * 6.2831853;
  let w = phase - tt * k;
  let dz = amp * env * sin(w);
  let dzdt = amp * (denv * sin(w) - env * k * cos(w));
  // turning curves the whole body into a C
  var db: f32; var dbdx: f32;
  let xb = p.x;
  if (style == 4) {
    let q = max(0.0, xb + 0.12);
    db = bend * q * q * 9.0; dbdx = bend * q * 18.0;
  } else {
    db = bend * xb * xb * 1.4; dbdx = bend * xb * 2.8;
  }
  p.z += dz + db;
  let slope = -dzdt + dbdx; // d(offset)/dx, x = pivot - t
  n = normalize(vec3f(n.x - slope * n.z, n.y, n.z));
  return Deformed(p, n);
}

fn basisRight(fwd: vec3f, up: vec3f) -> vec3f { return normalize(cross(fwd, up)); }
`;

export const FISH = common() + SPECIES_BLOCK + /* wgsl */ `
@group(1) @binding(1) var albedoTex: texture_2d<f32>;
@group(1) @binding(2) var albedoSamp: sampler;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) buv: vec2f,
  @location(3) aux: vec4f,
  @location(4) tex: vec2f,
  @location(5) fwd: vec3f,
  @location(6) up: vec3f,
  @location(7) @interpolate(flat) misc: vec4f,
  @location(8) lp: vec3f,
};

@vertex fn vs(v: VIn) -> VOut {
  let d = deform(v);
  let fwd = normalize(v.i1.xyz);
  let up = normalize(v.i2.xyz);
  let right = basisRight(fwd, up);
  let L = v.i0.w;
  let world = v.i0.xyz + (fwd * d.p.x + up * d.p.y + right * d.p.z) * L;
  var o: VOut;
  o.clip = F.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = normalize(fwd * d.n.x + up * d.n.y + right * d.n.z);
  o.buv = v.buv;
  o.aux = v.aux;
  o.tex = v.tex;
  o.fwd = fwd;
  o.up = up;
  o.misc = vec4f(v.i4.x, v.i4.y, v.i4.z, 0.0);
  o.lp = v.pos;
  return o;
}

struct Mat { col: vec3f, alpha: f32, rough: f32, irid: f32 };

fn band(x: f32, c: f32, hw: f32, aa: f32) -> f32 { return 1.0 - smoothstep(hw - aa, hw + aa, abs(x - c)); }
fn inEllipse(p: vec2f, c: vec2f, r: vec2f, aa: f32) -> f32 { return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, length((p - c) / r)); }
// thin periodic lines with their own antialiasing: fade to the average when too fine to resolve
fn stripes(q: f32, duty: f32) -> f32 {
  let fw = fwidth(q);
  let d = abs(fract(q) - 0.5) * 2.0;
  let s = 1.0 - smoothstep(duty - fw, duty + fw, d);
  return mix(s, duty, saturate(fw * 1.5 - 0.3));
}
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = saturate(dot(pa, ba) / dot(ba, ba));
  return length(pa - ba * h);
}
// fin rays: darker lines along the rays, translucent membrane between them
fn rays(s: f32, n: f32) -> f32 { return stripes(s * n, 0.18); }

const BLACK = vec3f(0.012, 0.012, 0.014);
const WHITE = vec3f(0.86, 0.86, 0.84);

fn clownfish(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let orange = srgb(vec3f(0.98, 0.43, 0.05));
  let y1 = clamp(y / 0.16, -1.0, 1.0);
  let c1 = 0.19 + 0.03 * (1.0 - y1 * y1);
  let c2 = 0.5 - 0.06 * (1.0 - y1 * y1);
  let wm = max(max(band(t, c1, 0.032, aa), band(t, c2, 0.042, aa)), band(t, 0.778, 0.022, aa));
  let em = max(max(band(t, c1, 0.041, aa), band(t, c2, 0.051, aa)), band(t, 0.778, 0.031, aa));
  var col = mix(orange, BLACK, em);
  col = mix(col, WHITE, wm);
  var alpha = 1.0;
  if (part >= 1 && part <= 5) {
    let edge = select(0.78, 0.86, part == 4);
    col = mix(col, BLACK, smoothstep(edge - 0.04, edge, u));
    col = mix(col, WHITE * 0.9, band(u, edge - 0.06, 0.02, 0.02) * 0.5);
    col = mix(col, orange * 0.9, rays(s, 12.0) * 0.25 * (1.0 - u));
    alpha = 0.93 - u * 0.1;
  }
  return Mat(col, alpha, 0.34, 0.15);
}

fn blueTang(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let blue = srgb(vec3f(0.07, 0.3, 0.9));
  let yellow = srgb(vec3f(1.0, 0.82, 0.08));
  var col = blue;
  var alpha = 1.0;
  if (part == 0) {
    let k = clamp((t - 0.1) / 0.66, 0.0, 1.0);
    let ya = 0.07 + 0.065 * sin(k * 2.7);
    let wa = 0.034 - 0.012 * k;
    var blk = band(y, ya, wa, aa) * smoothstep(0.1, 0.13, t);
    let q = length((vec2f(t, y) - vec2f(0.53, 0.035)) / vec2f(0.18, 0.08));
    blk = max(blk, band(q, 1.0, 0.24, aa * 10.0) * smoothstep(0.38, 0.42, t));
    blk = max(blk, smoothstep(0.73, 0.77, t) * (1.0 - smoothstep(0.075, 0.09, abs(y - 0.0))));
    col = mix(blue, BLACK, blk);
    // yellow scalpel at the tail base
    col = mix(col, yellow, inEllipse(vec2f(t, y), vec2f(0.785, 0.0), vec2f(0.018, 0.012), 0.2));
  } else if (part == 1) {
    let v = abs(s * 2.0 - 1.0);
    let core = 1.0 - smoothstep(0.62 - u * 0.35, 0.7 - u * 0.35, v);
    col = mix(BLACK, yellow, core * (1.0 - smoothstep(0.85, 0.95, u)));
    alpha = 0.95;
  } else if (part == 4) {
    col = mix(blue * 0.8, yellow, smoothstep(0.45, 0.65, u));
    alpha = 0.85 - u * 0.2;
  } else {
    col = mix(blue, BLACK, smoothstep(0.5, 0.65, u));
    col = mix(col, srgb(vec3f(0.3, 0.6, 1.0)), band(u, 0.42, 0.04, 0.03) * 0.6);
    alpha = 0.95;
  }
  return Mat(col, alpha, 0.3, 0.35);
}

fn yellowTang(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32, lp: vec3f) -> Mat {
  let yellow = srgb(vec3f(1.0, 0.84, 0.07));
  var col = yellow * (0.92 + 0.12 * vnoise2(vec2f(t, y) * 40.0));
  var alpha = 1.0;
  if (part == 0) {
    col = mix(col, WHITE, inEllipse(vec2f(t, y), vec2f(0.795, -0.005), vec2f(0.014, 0.007), 0.25));
    col *= 1.0 - 0.06 * stripes(y * 55.0, 0.2);
  } else {
    col = yellow * mix(0.95, 0.85, u);
    col = mix(col, yellow * 0.75, rays(s, 22.0) * 0.4);
    alpha = 0.9 - u * 0.15;
  }
  return Mat(col, alpha, 0.36, 0.1);
}

fn emperor(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let navy = srgb(vec3f(0.03, 0.08, 0.36));
  let yel = srgb(vec3f(1.0, 0.8, 0.14));
  let pale = srgb(vec3f(0.62, 0.76, 0.86));
  let bright = srgb(vec3f(0.3, 0.62, 1.0));
  let st = stripes((t - 0.62 * y) / 0.027, 0.42);
  var col = mix(navy, yel, st);
  var alpha = 1.0;
  if (part == 0 || part == 2) {
    // pale face with a dark mask through the eye, then a dark bar behind the gill
    let face = 1.0 - smoothstep(0.2, 0.22, t);
    col = mix(col, pale * (0.85 + 0.15 * stripes(y * 40.0, 0.3)), face);
    let mask = band(t, 0.118, 0.032, aa) * smoothstep(-0.14, -0.1, y);
    col = mix(col, bright, band(t, 0.118, 0.04, aa) * smoothstep(-0.14, -0.1, y) * face);
    col = mix(col, navy * 0.4, mask);
    let bar = band(t, 0.262, 0.032, aa) * (1.0 - smoothstep(0.17, 0.2, abs(y)));
    col = mix(col, bright, band(t, 0.262, 0.04, aa) * (1.0 - smoothstep(0.17, 0.2, abs(y))));
    col = mix(col, navy * 0.35, bar);
    if (part == 2) { col = mix(col, WHITE, smoothstep(0.85, 0.95, u)); alpha = 0.97; }
  } else if (part == 1) {
    col = srgb(vec3f(1.0, 0.68, 0.1));
    alpha = 0.95;
  } else if (part == 3) {
    col = mix(navy, bright, stripes(u * 4.5 + s * 1.5, 0.18));
    alpha = 0.97;
  } else {
    col = mix(navy * 0.6, yel, select(0.0, 0.6, part == 5));
    alpha = 0.8;
  }
  return Mat(col, alpha, 0.32, 0.25);
}

fn butterfly(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let white = vec3f(0.88, 0.88, 0.84);
  let yel = srgb(vec3f(1.0, 0.78, 0.1));
  let line = srgb(vec3f(0.22, 0.18, 0.15));
  var col = white;
  var alpha = 1.0;
  let upper = y > 0.01 + 0.25 * (t - 0.4);
  let q = select(t + y, t - y, upper);
  col = mix(col, line, stripes(q / 0.036, 0.22) * 0.85);
  let rear = smoothstep(0.5, 0.64, t + 0.35 * y);
  col = mix(col, mix(yel, yel * 0.85, stripes(q / 0.036, 0.22) * 0.4), rear);
  if (part == 0) {
    let bar = band(t, 0.142, 0.017, aa) * smoothstep(-0.13, -0.1, y);
    col = mix(col, WHITE, band(t, 0.142, 0.026, aa) * smoothstep(-0.13, -0.1, y));
    col = mix(col, BLACK, bar);
    col = mix(col, white * 0.95, 1.0 - smoothstep(0.05, 0.07, t));
  } else if (part == 2) {
    col = mix(yel, yel * 0.9, u);
    let spot = inEllipse(vec2f(s, u), vec2f(0.8, 0.45), vec2f(0.09, 0.28), 0.15);
    col = mix(col, WHITE, inEllipse(vec2f(s, u), vec2f(0.8, 0.45), vec2f(0.12, 0.36), 0.15));
    col = mix(col, BLACK, spot);
    alpha = 0.97;
  } else if (part == 1) {
    col = mix(yel, BLACK, band(u, 0.72, 0.06, 0.03));
    alpha = select(0.95, 0.35, u > 0.8);
  } else if (part == 3) {
    col = mix(yel, BLACK, band(u, 0.8, 0.04, 0.03));
    alpha = 0.95;
  } else {
    col = white;
    alpha = 0.35;
  }
  return Mat(col, alpha, 0.34, 0.12);
}

fn gramma(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let purple = srgb(vec3f(0.46, 0.07, 0.64));
  let yel = srgb(vec3f(1.0, 0.74, 0.05));
  let m = smoothstep(0.43, 0.52, t + y * 0.15);
  var col = mix(purple, yel, m);
  var alpha = 1.0;
  if (part == 0) {
    let l = band(y, 0.045 - (t - 0.05) * 0.45, 0.004, aa) * (1.0 - smoothstep(0.18, 0.2, t));
    col = mix(col, yel, l);
  } else if (part == 2) {
    col = mix(col, BLACK, inEllipse(vec2f(s, u), vec2f(0.07, 0.6), vec2f(0.08, 0.32), 0.2));
    alpha = 0.92;
  } else if (part == 4) { col = mix(purple, yel, 0.3); alpha = 0.45; }
  else if (part == 5) { col = purple; alpha = 0.95; }
  else { alpha = 0.92; }
  return Mat(col, alpha, 0.36, 0.2);
}

fn idol(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let white = vec3f(0.9, 0.89, 0.82);
  let yel = srgb(vec3f(1.0, 0.84, 0.18));
  let orange = srgb(vec3f(1.0, 0.56, 0.1));
  var col = white;
  var alpha = 1.0;
  let b1 = band(t, 0.27 - 0.13 * y, 0.068, aa);
  let b2 = band(t, 0.695 - 0.06 * y, 0.042, aa);
  if (part == 0 || ((part == 2 || part == 3) && u < 0.45)) {
    let wash = smoothstep(0.36, 0.42, t) * (1.0 - smoothstep(0.6, 0.65, t)) * smoothstep(-0.12, 0.05, y);
    col = mix(col, yel, wash);
    col = mix(col, BLACK, max(b1, b2));
    col = mix(col, WHITE, band(t, 0.72 - 0.06 * y, 0.006, aa) * b2);
    if (part == 0) {
      col = mix(col, orange, smoothstep(0.06, 0.08, t) * (1.0 - smoothstep(0.12, 0.14, t)) * smoothstep(0.0, 0.02, y));
      col = mix(col, BLACK, 1.0 - smoothstep(0.025, 0.035, t));
    }
  } else if (part == 1) {
    col = mix(BLACK, WHITE, smoothstep(0.8, 0.88, u));
    alpha = 0.95;
  } else if (part == 5) {
    col = BLACK;
  } else if (part == 4) {
    col = white; alpha = 0.4;
  } else {
    col = mix(white, yel, 0.2 * (1.0 - u));
    alpha = 0.92;
  }
  return Mat(col, alpha, 0.34, 0.1);
}

fn lionfish(part: i32, t: f32, y: f32, u: f32, s: f32, seg: f32, aa: f32) -> Mat {
  let cream = vec3f(0.9, 0.83, 0.72);
  let maroon = srgb(vec3f(0.48, 0.11, 0.07));
  var col = cream;
  var alpha = 1.0;
  if (part == 0) {
    let q = t * 25.0 + sin(y * 16.0 + t * 5.0) * 0.45 + y * select(5.0, -7.0, t < 0.16);
    let sn = sin(q * 3.14159);
    col = mix(cream, maroon, smoothstep(-0.15, 0.25, sn));
    col = mix(col, maroon * 1.2, band(sn, -0.8, 0.07, 0.05) * 0.8);
  } else if (part == 4 || part == 5 || (part == 2 && seg < 0.5)) {
    let n = select(16.0, 12.0, part == 2);
    let r = stripes(s * n, 0.22);
    let banded = mix(cream, maroon, smoothstep(-0.2, 0.2, sin(u * 26.0)));
    let spots = 1.0 - smoothstep(0.18, 0.26, voronoi2(vec2f(u * 9.0, s * n)).x);
    let membrane = mix(vec3f(0.92, 0.86, 0.82), maroon, spots * 0.7);
    col = mix(membrane, banded, r);
    var ma = select(0.42, 0.5, part == 5);
    if (part == 2) { ma *= 1.0 - smoothstep(0.22, 0.42, u); }
    alpha = mix(ma, 1.0, r);
  } else {
    let spots = 1.0 - smoothstep(0.2, 0.28, voronoi2(vec2f(u * 8.0, s * 14.0)).x);
    col = mix(vec3f(0.9, 0.86, 0.82), maroon, spots * 0.8);
    alpha = mix(0.38, 0.95, max(spots, rays(s, 14.0)));
  }
  return Mat(col, alpha, 0.4, 0.05);
}

fn damsel(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32, variant: f32) -> Mat {
  let blue = srgb(vec3f(0.03, 0.3, 0.98)) * (0.85 + variant * 0.25);
  let tailY = srgb(vec3f(0.95, 0.8, 0.25));
  let yt = select(0.0, 1.0, variant > 0.62);
  var col = blue;
  var alpha = 1.0;
  if (part == 0) {
    col = mix(col, blue * 0.7, smoothstep(0.02, 0.12, y));
    col = mix(col, BLACK, band(y, 0.042 + (t - 0.1) * 0.15, 0.0045, aa) * (1.0 - smoothstep(0.17, 0.19, t)));
    col = mix(col, tailY, yt * smoothstep(0.62, 0.78, t) * 0.8);
  } else if (part == 1) {
    col = mix(blue, tailY, yt);
    alpha = mix(0.85, 0.6, u);
  } else if (part == 4) {
    col = blue * 0.7; alpha = 0.35;
  } else {
    col = mix(blue, BLACK, smoothstep(0.8, 0.95, u) * 0.7);
    col = mix(col, tailY, yt * select(0.0, 0.7, part == 3));
    alpha = 0.9;
  }
  return Mat(col, alpha, 0.26, 0.55);
}

fn anthias(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32, variant: f32) -> Mat {
  let male = variant > 0.68;
  let orange = srgb(vec3f(1.0, 0.5, 0.17));
  let pink = srgb(vec3f(1.0, 0.45, 0.48));
  let magenta = srgb(vec3f(0.85, 0.22, 0.5));
  let lav = srgb(vec3f(0.72, 0.5, 1.0));
  var col = select(mix(orange, pink, smoothstep(0.05, -0.08, y) * 0.5), mix(magenta, orange, smoothstep(0.02, 0.12, y) * 0.5), male);
  var alpha = 1.0;
  if (part == 0) {
    let d = segDist(vec2f(t, y), vec2f(0.07, 0.012), vec2f(0.23, -0.045));
    col = mix(col, lav, (1.0 - smoothstep(0.006 - aa, 0.006 + aa, d)) * (1.0 - smoothstep(0.24, 0.26, t)));
  } else if (part == 1) {
    let v = abs(s * 2.0 - 1.0);
    col = mix(col, srgb(vec3f(0.95, 0.2, 0.25)), smoothstep(0.7, 0.9, v) * 0.8);
    alpha = mix(0.92, 0.7, u);
  } else if (part == 4) {
    col = select(col, srgb(vec3f(0.85, 0.1, 0.25)), male && u < 0.5);
    alpha = 0.6;
  } else {
    col = mix(col, srgb(vec3f(0.9, 0.15, 0.2)), smoothstep(0.75, 0.95, u));
    alpha = 0.9;
  }
  return Mat(col, alpha, 0.3, 0.3);
}

fn trigger(part: i32, t: f32, y: f32, u: f32, s: f32, aa: f32) -> Mat {
  let tan = srgb(vec3f(0.7, 0.62, 0.45));
  let white = vec3f(0.88, 0.87, 0.83);
  let blue = srgb(vec3f(0.14, 0.45, 0.9));
  let orange = srgb(vec3f(1.0, 0.55, 0.12));
  var alpha = 1.0;
  var col: vec3f;
  if (part == 0) {
    let line = -0.02 + 0.04 * sin(t * 4.0);
    col = mix(white, tan, smoothstep(line - 0.015, line + 0.015, y));
    // bands from the eye down and back towards the pectoral
    let q = (t - 0.27) + 0.55 * (0.1 - y);
    let face = smoothstep(0.18, 0.2, t) * (1.0 - smoothstep(0.12, 0.14, y)) * smoothstep(-0.1, -0.06, y);
    var fb = 0.0;
    fb = max(fb, band(q, 0.006, 0.006, aa));
    fb = max(fb, band(q, 0.041, 0.006, aa));
    fb = max(fb, band(q, 0.076, 0.006, aa));
    let fk = band(q, 0.0235, 0.011, aa) + band(q, 0.0585, 0.011, aa);
    col = mix(col, blue, fb * face);
    col = mix(col, BLACK, saturate(fk) * face);
    // lips and the blue line along the cheek
    col = mix(col, orange, 1.0 - smoothstep(0.035, 0.05, t));
    col = mix(col, blue, band(y, -0.012 + (t - 0.04) * 0.12, 0.005, aa) * smoothstep(0.04, 0.06, t) * (1.0 - smoothstep(0.3, 0.33, t)));
    // black side patch with white bars, then black chevrons by the tail
    let sidePatch = inEllipse(vec2f(t, y), vec2f(0.56, -0.07), vec2f(0.15, 0.085), 0.08);
    col = mix(col, mix(BLACK, white, stripes((t + y * 0.7) / 0.05, 0.3)), sidePatch);
    let chev = stripes((t - y * 1.3) / 0.034, 0.5) * smoothstep(0.69, 0.71, t) * (1.0 - smoothstep(0.08, 0.1, abs(y)));
    col = mix(col, BLACK, chev);
    col = mix(col, orange, band(y, 0.0, 0.006, aa) * smoothstep(0.69, 0.71, t));
  } else {
    col = mix(vec3f(0.85, 0.8, 0.7), tan * 0.6, smoothstep(0.8, 0.95, u));
    col = mix(col, tan * 0.7, rays(s, 18.0) * 0.4);
    alpha = select(0.55, 0.8, part == 1);
    if (part == 1) { col = mix(col, BLACK, smoothstep(0.82, 0.9, u)); }
  }
  return Mat(col, alpha, 0.38, 0.05);
}

fn moray(part: i32, t: f32, y: f32, lp: vec3f, aa: f32) -> Mat {
  let pale = srgb(vec3f(0.88, 0.8, 0.5));
  let brown = srgb(vec3f(0.16, 0.1, 0.04));
  let ang = atan2(lp.y, lp.z);
  let freq = select(85.0, 135.0, t < 0.1);
  let p = vec2f(t * freq, ang * 0.042 * freq);
  let c = voronoi2(p);
  let edge = c.y - c.x;
  let spot = smoothstep(0.06, 0.14, edge);
  var col = mix(pale, brown * (0.8 + 0.4 * c.z), spot);
  col = mix(col, pale * 1.05, smoothstep(-0.01, -0.035, lp.y) * 0.35);
  return Mat(col, 1.0, 0.42, 0.0);
}

fn eyeColor(id: i32) -> vec3f {
  switch (id) {
    case 0: { return srgb(vec3f(0.95, 0.5, 0.1)); }
    case 1, 2, 3: { return srgb(vec3f(0.15, 0.17, 0.2)); }
    case 7: { return srgb(vec3f(0.55, 0.12, 0.06)); }
    case 10: { return srgb(vec3f(0.95, 0.45, 0.1)); }
    case 11: { return srgb(vec3f(0.85, 0.72, 0.3)); }
    default: { return srgb(vec3f(0.7, 0.55, 0.2)); }
  }
}

struct FOut { @location(0) color: vec4f };

@fragment fn fs(in: VOut, @builtin(front_facing) front: bool) -> FOut {
  let id = i32(SP.a.x + 0.5);
  let part = i32(in.aux.x + 0.5);
  let t = in.buv.x;
  let y = in.buv.y;
  let aa = max(fwidth(t), fwidth(y)) * 1.2 + 0.0008;
  var u = in.aux.z;
  var s = in.aux.w;
  var seg = 0.0;
  if (part == 2 || part == 3) { seg = floor(s * 0.5); s = s - seg * 2.0; }
  let variant = in.misc.x;

  var m: Mat;
  if (part == 6) {
    let r = in.aux.z;
    let iris = eyeColor(id) * (0.75 + 0.35 * vnoise2(vec2f(in.aux.w * 6.0, r * 8.0)));
    var c = mix(vec3f(0.004), iris, smoothstep(0.38, 0.46, r));
    c = mix(c, vec3f(0.02), smoothstep(0.8, 0.95, r));
    m = Mat(c, 1.0, 0.06, 0.0);
  } else if (SP.b.z > 0.5) {
    let tc = textureSample(albedoTex, albedoSamp, in.tex);
    m = Mat(tc.rgb, tc.a, 0.35, 0.1);
  } else {
    switch (id) {
      case 0: { m = clownfish(part, t, y, u, s, aa); }
      case 1: { m = blueTang(part, t, y, u, s, aa); }
      case 2: { m = yellowTang(part, t, y, u, s, aa, in.lp); }
      case 3: { m = emperor(part, t, y, u, s, aa); }
      case 4: { m = butterfly(part, t, y, u, s, aa); }
      case 5: { m = gramma(part, t, y, u, s, aa); }
      case 6: { m = idol(part, t, y, u, s, aa); }
      case 7: { m = lionfish(part, t, y, u, s, seg, aa); }
      case 8: { m = damsel(part, t, y, u, s, aa, variant); }
      case 9: { m = anthias(part, t, y, u, s, aa, variant); }
      case 10: { m = trigger(part, t, y, u, s, aa); }
      default: { m = moray(part, t, y, in.lp, aa); }
    }
  }
  if (m.alpha < 0.02) { discard; }

  var N = normalize(in.nrm);
  if (!front) { N = -N; }
  var col = m.col;
  let isBody = part == 0;
  if (isBody) {
    // countershading: a lighter belly and slightly darker back
    col *= mix(1.1, 0.9, saturate(in.aux.z * 0.5 + 0.5));
    // gill cover edge and mouth line
    if (id != 11) {
      col *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.006, abs(t - (SP.c.x + 0.085 + 0.25 * y * y)))) * step(abs(y - SP.c.y + 0.02), 0.16);
    }
    // overlapping scales: edges and a small tilt of the normal per scale
    let f = SP.c.z;
    if (f > 0.0) {
      let q = vec2f(t * f, y * f * 1.2);
      let row = floor(q.y);
      let cp = vec2f(fract(q.x + 0.5 * fract(row * 0.5) * 2.0), fract(q.y)) - 0.5;
      let fade = 1.0 - saturate(fwidth(q.x) * 2.5 - 0.5);
      let d = length(cp * vec2f(1.0, 1.25));
      col *= 1.0 - 0.07 * smoothstep(0.32, 0.5, d) * fade;
      N = normalize(N + (in.fwd * -cp.x + in.up * cp.y) * 0.22 * fade * (1.0 - abs(dot(N, in.up))));
    }
    if (!front) { col = srgb(vec3f(0.45, 0.16, 0.16)); }
  }
  let isFin = part >= 1 && part <= 5;
  var sfc: Surface;
  sfc.albedo = col;
  sfc.rough = m.rough;
  sfc.f0 = select(0.04, 0.03, isFin);
  sfc.ao = in.misc.y;
  sfc.translucency = select(0.15, 0.75, isFin);
  sfc.causticK = 0.75 * F.params.w;
  var c = shade(in.world, N, sfc, in.clip.xy) * mix(0.55, 1.0, in.misc.y);
  // iridescent sheen at grazing angles
  let V = normalize(F.camPos.xyz - in.world);
  let ndv = saturate(dot(N, V));
  let irid = 0.5 + 0.5 * cos(6.2831 * (vec3f(0.0, 0.33, 0.67) + ndv * 1.3 + t * 0.5));
  c += irid * m.irid * pow(1.0 - ndv, 2.0) * 0.2 * sunColor() * depthAttenuation(in.world.y) * in.misc.y;
  if (part == 6) {
    // corneal highlight
    c += vec3f(ggx(N, V, F.lightDir.xyz, 0.08, 0.05)) * sunColor() * 0.8;
  }
  c = applyWater(c, in.world);
  var o: FOut;
  o.color = vec4f(c, saturate(m.alpha));
  return o;
}
`;

export const FISH_SHADOW = common({ shadow: true }) + SPECIES_BLOCK + /* wgsl */ `
@vertex fn vs(v: VIn) -> @builtin(position) vec4f {
  let part = i32(v.aux.x + 0.5);
  if (part != 0) { return vec4f(2.0, 2.0, 2.0, 1.0); }
  let d = deform(v);
  let fwd = normalize(v.i1.xyz);
  let up = normalize(v.i2.xyz);
  let right = basisRight(fwd, up);
  let world = v.i0.xyz + (fwd * d.p.x + up * d.p.y + right * d.p.z) * v.i0.w;
  return F.lightViewProj * vec4f(world, 1.0);
}
`;
