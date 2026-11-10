// Suspended particles, bubble streams, and volumetric light shafts. Particles and bubbles
// are generated entirely on the GPU from their instance index and the time.
import { common } from './common.js';

export const BUBBLES_PER_SOURCE = 40;

const QUAD = /* wgsl */ `
fn quadCorner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  return c[vi];
}
// world size of one pixel at distance d
fn pixelWorld(d: f32) -> f32 { return d * 2.0 / (F.screen.w * F.screen.y); }
`;

export const PARTICLES = common() + QUAD + /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec4f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let id = f32(ii);
  let h = vec3f(hash11(id * 1.37 + 0.1), hash11(id * 2.11 + 3.3), hash11(id * 3.77 + 7.7));
  let h2 = hash11(id * 5.31 + 1.9);
  let t = F.camPos.w;
  let box0 = vec3f(-11.0, 0.05, -8.0);
  let size = vec3f(22.0, 7.7, 7.95);
  var p = h * size;
  p += F.drift.xyz;
  p += vec3f(sin(t * 0.07 + id) * 0.25 + t * 0.004, -t * (0.004 + h2 * 0.01) + sin(t * 0.05 + id * 1.7) * 0.2, cos(t * 0.06 + id * 2.3) * 0.25);
  p = box0 + fract(p / size) * size;
  let toCam = F.camPos.xyz - p;
  let dist = length(toCam);
  let fwd = toCam / dist;
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let r = mix(0.005, 0.017, h.x * h.x);
  let rr = max(r, pixelWorld(dist) * 0.9);
  let c = quadCorner(vi);
  let world = p + (right * c.x + up * c.y) * rr;
  var o: VOut;
  o.clip = F.viewProj * vec4f(world, 1.0);
  o.uv = c;
  // drifting flecks occasionally catch the light
  let sparkle = pow(saturate(sin(t * (0.3 + h2 * 0.6) + id * 3.1) * 0.5 + 0.5), 12.0);
  let lit = (0.35 + 0.9 * sparkle) * depthAttenuation(p.y);
  let d = waterDistance(p);
  let fog = exp(-d * 0.11 / max(F.deep.w, 0.2));
  let a = 0.42 * (r / rr) * (r / rr) * fog * smoothstep(0.6, 1.6, dist) * (1.0 - smoothstep(-0.25, -0.05, p.z));
  let col = applyWater(vec3f(0.78, 0.86, 0.84) * lit * F.lightDir.w * 0.6, p);
  o.col = vec4f(col, a);
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  let a = in.col.a * (1.0 - smoothstep(0.2, 1.0, d));
  return vec4f(in.col.rgb * a, a);
}
`;

export const BUBBLES = common() + QUAD + /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec4f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let stream = ii / ${BUBBLES_PER_SOURCE}u;
  let k = f32(ii % ${BUBBLES_PER_SOURCE}u);
  let src = F.src[stream];
  o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
  o.uv = vec2f(0.0);
  o.col = vec4f(0.0);
  if (src.w < 0.5) { return o; }
  let seed = k + f32(stream) * 101.0;
  let h = vec3f(hash11(seed * 1.73 + 0.3), hash11(seed * 2.91 + 5.1), hash11(seed * 4.37 + 9.2));
  let t = F.camPos.w;
  let rise = mix(0.42, 0.72, h.x);
  let y0 = src.y + 0.04;
  let height = F.params.z - y0 + 0.2;
  let period = height / rise;
  let cyc = t / period + (k + h.y * 0.6) / ${BUBBLES_PER_SOURCE}.0;
  let spawn = floor(cyc);
  let ph = fract(cyc);
  // streams start and stop over minutes; a bubble keeps going once released
  let env = smoothstep(0.42, 0.62, vnoise2(vec2f((spawn * period) * 0.012, f32(stream) * 3.7)));
  if (hash11(spawn * 7.13 + seed) > env * 0.95) { return o; }
  let wob = sin(ph * 22.0 + h.z * 6.28) * 0.025 * (0.3 + ph);
  var p = vec3f(src.x + wob, y0 + ph * height, src.z + cos(ph * 19.0 + h.y * 6.28) * 0.02 * (0.3 + ph));
  p += F.current.xyz * ph * 0.6;
  let r = mix(0.007, 0.024, h.z * h.z) * (1.0 + ph * 0.3);
  let toCam = F.camPos.xyz - p;
  let dist = length(toCam);
  let fwd = toCam / dist;
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let rr = max(r, pixelWorld(dist) * 1.2);
  let c = quadCorner(vi);
  o.clip = F.viewProj * vec4f(p + (right * c.x + up * c.y) * rr, 1.0);
  o.uv = c;
  let lit = sunColor() * depthAttenuation(p.y);
  let d = waterDistance(p);
  let fog = exp(-d * 0.09 / max(F.deep.w, 0.2));
  o.col = vec4f(lit, (r / rr) * fog * smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.9, 1.0, ph)));
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  // thin bright rim, a specular point, and a nearly clear centre
  let rim = smoothstep(0.62, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
  let spot = 1.0 - smoothstep(0.0, 0.28, length(in.uv - vec2f(-0.35, 0.4)));
  let a = (rim * 0.55 + spot * 0.8 + 0.05) * in.col.a;
  let c = (in.col.rgb * 0.5 + vec3f(0.25, 0.32, 0.35)) * (rim * 0.8 + spot * 1.6 + 0.1);
  return vec4f(c * in.col.a, a);
}
`;

// Light shafts: march the view ray through the water, testing each sample against the
// shadow map so rock and coral cut the beams, and modulating the light by a slowly moving
// pattern projected down from the surface.
export const RAYS = common() + /* wgsl */ `
@group(1) @binding(0) var sceneDepth: texture_depth_multisampled_2d;
struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}
fn shaft(q: vec3f, t: f32) -> f32 {
  let L = F.lightDir.xyz;
  let below = max(F.params.z - q.y, 0.0);
  let s = q.xz + L.xz / max(L.y, 0.25) * below;
  let n = vnoise2(s * 0.5 + vec2f(t * 0.025, -t * 0.018)) * 0.62 + vnoise2(s * 1.25 + vec2f(-t * 0.04, t * 0.03)) * 0.38;
  return smoothstep(0.42, 0.85, n);
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let pix = vec2i(in.pos.xy);
  let depth = textureLoad(sceneDepth, pix, 0);
  let w = F.invViewProj * vec4f(in.ndc, depth, 1.0);
  let world = w.xyz / w.w;
  let ro = F.camPos.xyz;
  var rd = world - ro;
  var tEnd = length(rd);
  rd /= tEnd;
  if (depth >= 1.0) { tEnd = 60.0; }
  let tStart = max(0.0, -ro.z / min(rd.z, -1e-3));
  tEnd = min(tEnd, tStart + 20.0);
  if (tEnd <= tStart) { return vec4f(0.0); }
  let N = 22;
  let dt = (tEnd - tStart) / f32(N);
  let jit = ign(in.pos.xy + vec2f(F.camPos.w * 37.0 % 64.0, 0.0));
  let t = F.camPos.w;
  var acc = 0.0;
  for (var i = 0; i < N; i++) {
    let tt = tStart + (f32(i) + jit) * dt;
    let q = ro + rd * tt;
    if (q.y > F.params.z) { continue; }
    let lq = F.lightViewProj * vec4f(q, 1.0);
    let uv = lq.xy * vec2f(0.5, -0.5) + 0.5;
    let vis = textureSampleCompareLevel(shadowMap, shadowSamp, uv, lq.z - 0.002);
    let below = F.params.z - q.y;
    let att = exp(-below * 0.1) * exp(-(tt - tStart) * 0.055);
    acc += vis * shaft(q, t) * att;
  }
  acc *= dt;
  // mild forward scattering towards the light
  let g = 0.45;
  let mu = dot(rd, F.lightDir.xyz);
  let phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.25 + 0.15;
  let col = acc * phase * sunColor() * mix(vec3f(0.55, 0.85, 0.95), vec3f(1.0), 0.35) * F.params.y * 0.035;
  return vec4f(col, 0.0);
}
`;
