// Shared WGSL: the per-frame uniform block, noise, caustics, shadows, water absorption and
// fog, and the underwater lighting model. Shadow-pass shaders get only the uniform block.

export const FRAME_FLOATS = 116;
// Half the old map. The comparison kernel is sized so the penumbra stays the same
// width on the sand; hardware filtering hides the coarser texels.
export const SHADOW_SIZE = 1024;
// Projected caustic field, sampled by every shaded pixel instead of recomputed there.
export const CAUSTIC_SIZE = 1024;

const FRAME = /* wgsl */ `
diagnostic(off, derivative_uniformity);
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,     // xyz camera, w time (s)
  lightDir: vec4f,   // xyz towards the light, w sun intensity
  deep: vec4f,       // rgb deep water, w clarity
  shallow: vec4f,    // rgb shallow water, w ambient intensity
  current: vec4f,    // xyz water current, w coral animation (0/1)
  params: vec4f,     // x caustics, y light rays, z surface height, w fish shimmer
  screen: vec4f,     // w, h, 1/h, projection y scale
  drift: vec4f,      // xyz accumulated current displacement (wrapped), w unused
  src: array<vec4f, 6>, // bubble sources: xyz, w = enabled
  sun: vec4f,        // rgb linear sun colour; intensity is lightDir.w
  aux: vec4f,        // xy = scene pixels per light-shaft pixel
  sRange: vec4f,     // xy min, zw max of the caustic projection domain
};
@group(0) @binding(0) var<uniform> F: Frame;
`;

const NOISE = /* wgsl */ `
fn hash11(p: f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }
fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
fn hash22(p: vec2f) -> vec2f {
  let n = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(n) * 43758.5453);
}
fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i); let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0)); let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = hash31(i); let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0)); let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0)); let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0)); let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// rotation used between noise octaves so lattice axes never line up
const ROT3 = mat3x3f(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
fn fbm3(p: vec3f) -> f32 {
  return vnoise3(p) * 0.5 + vnoise3(p * 2.03 + 11.7) * 0.25 + vnoise3(p * 4.11 + 3.1) * 0.125 + vnoise3(p * 8.17 + 7.3) * 0.0625;
}
// Voronoi cell distances: x = nearest, y = second nearest, z = cell id hash
fn voronoi2(p: vec2f) -> vec3f {
  let ip = floor(p); let fp = fract(p);
  var d1 = 8.0; var d2 = 8.0; var id = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = hash22(ip + g);
      let r = g + o - fp;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash21(ip + g); } else if (d < d2) { d2 = d; }
    }
  }
  return vec3f(sqrt(d1), sqrt(d2), id);
}
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn srgb(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
`;

const CAUSTIC_FN = /* wgsl */ `
// Animated Voronoi edge network: bright filaments where neighbouring cells meet, the way
// light focused by surface waves draws on the reef.
fn causticEdge(p: vec2f, t: f32) -> f32 {
  let ip = floor(p); let fp = fract(p);
  var d1 = 8.0; var d2 = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let h = hash22(ip + g);
      let o = 0.5 + 0.38 * sin(vec2f(t * (0.55 + h.x * 0.45), t * (0.5 + h.y * 0.5)) + h * 6.2831);
      let r = g + o - fp;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
fn causticEdges(s: vec2f, t: f32) -> vec2f {
  let warp = vec2f(vnoise2(s * 0.31 + vec2f(t * 0.045, 0.0)), vnoise2(s * 0.31 + vec2f(17.0, -t * 0.04))) - 0.5;
  let uv = s * 1.15 + warp * 1.6;
  return vec2f(causticEdge(uv, t * 0.8), causticEdge(uv * 1.71 + vec2f(3.1, 7.7), t * 1.05));
}
`;

// One projected field per frame. Shading only looks it up and applies the depth blur,
// which depends on the point being lit and so stays in the material shader.
const CAUSTICS = /* wgsl */ `
@group(0) @binding(3) var causticMap: texture_2d<f32>;
@group(0) @binding(4) var causticSamp: sampler;
fn causticsAt(P: vec3f) -> f32 {
  let depth = max(F.params.z - P.y, 0.0);
  let L = F.lightDir.xyz;
  let s = P.xz + L.xz / max(L.y, 0.25) * depth;
  let uv = (s - F.sRange.xy) / max(F.sRange.zw - F.sRange.xy, vec2f(1e-4));
  let e = textureSampleLevel(causticMap, causticSamp, uv, 0.0).rg;
  let blur = mix(0.12, 0.3, saturate(depth / 8.0));
  let c1 = 1.0 - smoothstep(0.0, blur, e.r);
  let c2 = 1.0 - smoothstep(0.0, blur * 1.4, e.g);
  return c1 * 0.7 + c2 * 0.45;
}
`;

const CAUSTIC_FS_TRI = /* wgsl */ `
struct COut { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> COut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: COut;
  o.pos = vec4f(p, 0.0, 1.0);
  return o;
}
@fragment fn fs(in: COut) -> @location(0) vec4f {
  let uv = in.pos.xy / vec2f(${CAUSTIC_SIZE}.0);
  let s = mix(F.sRange.xy, F.sRange.zw, uv);
  return vec4f(causticEdges(s, F.camPos.w), 0.0, 1.0);
}
`;

const LIGHTING = /* wgsl */ `
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSamp: sampler_comparison;

const POISSON = array<vec2f, 8>(
  vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621), vec2f(0.519, 0.767),
  vec2f(0.962, -0.195), vec2f(0.185, -0.893), vec2f(-0.322, -0.933), vec2f(0.507, 0.064));

fn shadowAt(P: vec3f, N: vec3f, px: vec2f) -> f32 {
  let q = F.lightViewProj * vec4f(P + N * 0.05, 1.0);
  let uv = q.xy * vec2f(0.5, -0.5) + 0.5;
  let z = q.z - 0.0016;
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0)) && q.z < 1.0;
  let a = ign(px) * 6.2831;
  let rot = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
  // 1.1/1024 matches the old 2.2/2048 world-space radius.
  let r = 1.1 / ${SHADOW_SIZE}.0;
  var s = 0.0;
  for (var i = 0; i < 8; i++) {
    s += textureSampleCompareLevel(shadowMap, shadowSamp, uv + rot * POISSON[i] * r, z);
  }
  return select(1.0, s / 8.0, inside);
}

fn sunColor() -> vec3f { return F.sun.rgb * F.lightDir.w; }

// Light lost on the way down from the surface (red goes first).
fn depthAttenuation(y: f32) -> vec3f {
  let d = max(F.params.z - y, 0.0);
  return exp(-vec3f(0.11, 0.035, 0.022) * d / max(F.deep.w, 0.2));
}

// Background water seen along a view direction: brighter towards the surface.
fn waterColor(dir: vec3f) -> vec3f {
  let h = saturate(dir.y * 1.9 + 0.48);
  var c = mix(F.deep.rgb, F.shallow.rgb, h * h * (3.0 - 2.0 * h));
  let glow = pow(max(dot(dir, F.lightDir.xyz), 0.0), 5.0);
  c += F.shallow.rgb * glow * 0.25;
  return c;
}

// Length of the view ray that runs through water (the camera is outside the glass at z > 0).
fn waterDistance(P: vec3f) -> f32 {
  let v = P - F.camPos.xyz;
  let frac = saturate(-P.z / max(F.camPos.z - P.z, 1e-3));
  return length(v) * frac;
}

fn applyWater(col: vec3f, P: vec3f) -> vec3f {
  let d = waterDistance(P);
  let dir = normalize(P - F.camPos.xyz);
  let k = 1.0 / max(F.deep.w, 0.2);
  let absorb = exp(-vec3f(0.075, 0.03, 0.022) * d * k);
  let fog = 1.0 - exp(-d * 0.074 * k);
  return mix(col * absorb, waterColor(dir), fog);
}

fn hemiAmbient(N: vec3f) -> vec3f {
  let up = F.shallow.rgb * 1.35 + vec3f(0.05, 0.07, 0.08);
  let down = vec3f(0.30, 0.34, 0.33) * 0.55 + F.deep.rgb * 0.4;
  return mix(down, up, N.y * 0.5 + 0.5) * F.shallow.w;
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32, f0: f32) -> f32 {
  let H = normalize(V + L);
  let nh = max(dot(N, H), 0.0); let nl = max(dot(N, L), 0.0); let nv = max(dot(N, V), 1e-3);
  let a = rough * rough; let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (3.14159 * dd * dd);
  let k = a * 0.5;
  let G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  let Fr = f0 + (1.0 - f0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  return D * G * Fr / max(4.0 * nv, 1e-3);
}

struct Surface {
  albedo: vec3f,
  rough: f32,
  f0: f32,
  ao: f32,
  translucency: f32,
  causticK: f32,
};

fn shade(P: vec3f, N: vec3f, s: Surface, px: vec2f) -> vec3f {
  let V = normalize(F.camPos.xyz - P);
  let L = F.lightDir.xyz;
  let sh = shadowAt(P, N, px);
  let caus = causticsAt(P) * F.params.x * s.causticK;
  let direct = sunColor() * depthAttenuation(P.y) * sh * (0.6 + caus * 0.8);
  let nl = dot(N, L);
  let wrap = saturate((nl + 0.25) / 1.25);
  var c = s.albedo * wrap * direct;
  c += s.albedo * saturate(-nl) * s.translucency * direct;
  c += s.albedo * hemiAmbient(N) * s.ao;
  c += vec3f(ggx(N, V, L, s.rough, s.f0)) * direct * saturate(nl * 4.0);
  let fr = s.f0 + (1.0 - s.f0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  c += waterColor(reflect(-V, N)) * fr * 0.35 * s.ao * (1.0 - s.rough * 0.6);
  return c;
}
`;

export function common({ shadow = false } = {}) {
  return FRAME + NOISE + (shadow ? '' : CAUSTICS + LIGHTING);
}

// Full-screen pass that fills the caustic map. Same edge function the materials used to run per pixel.
export const CAUSTIC_BAKE = FRAME + NOISE + CAUSTIC_FN + CAUSTIC_FS_TRI;
