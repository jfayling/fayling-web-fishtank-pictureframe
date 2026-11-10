// Bloom (downsample / upsample chain) and the final composite with AgX tone mapping.
const FS_TRI = /* wgsl */ `
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

export const BLOOM_DOWN = FS_TRI + /* wgsl */ `
struct P { texel: vec4f };  // xy = 1 / source size, z = 1 on the first pass (threshold)
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> U: P;
fn tap(uv: vec2f) -> vec3f {
  let c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  if (U.texel.z < 0.5) { return c; }
  // first pass: drop non-finite values and weight by 1/(1+luma) so single-pixel
  // highlights cannot turn into large bloom discs
  let ok = all(c == c) && all(c < vec3f(1e5));
  let s = select(vec3f(0.0), min(c, vec3f(64.0)), ok);
  return s / (1.0 + max(s.r, max(s.g, s.b)) * 0.5);
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let t = U.texel.xy;
  let uv = in.uv;
  var c = tap(uv) * 0.25;
  c += (tap(uv + t * vec2f(-1.0, -1.0)) + tap(uv + t * vec2f(1.0, -1.0)) + tap(uv + t * vec2f(-1.0, 1.0)) + tap(uv + t * vec2f(1.0, 1.0))) * 0.125;
  c += (tap(uv + t * vec2f(-2.0, 0.0)) + tap(uv + t * vec2f(2.0, 0.0)) + tap(uv + t * vec2f(0.0, -2.0)) + tap(uv + t * vec2f(0.0, 2.0))) * 0.0625;
  if (U.texel.z > 0.5) {
    // undo the luma weighting on the average, then a soft knee so only highlights bloom
    var l = max(c.r, max(c.g, c.b));
    c = c / max(1.0 - l * 0.5, 0.05);
    l = max(c.r, max(c.g, c.b));
    c *= smoothstep(0.55, 1.6, l);
  }
  return vec4f(min(c, vec3f(6e4)), 1.0);
}
`;

export const BLOOM_UP = FS_TRI + /* wgsl */ `
struct P { texel: vec4f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> U: P;
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let t = U.texel.xy;
  let uv = in.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(-t.x, 0.0)) + tap(uv + vec2f(t.x, 0.0)) + tap(uv + vec2f(0.0, -t.y)) + tap(uv + vec2f(0.0, t.y))) * 2.0;
  o += tap(uv + vec2f(-t.x, -t.y)) + tap(uv + vec2f(t.x, -t.y)) + tap(uv + vec2f(-t.x, t.y)) + tap(uv + vec2f(t.x, t.y));
  return vec4f(o / 16.0, 1.0);
}
`;

export const COMPOSITE = FS_TRI + /* wgsl */ `
struct P { p: vec4f, q: vec4f };  // p: exposure, bloom, frame, vignette; q: saturation, contrast, fade-in, unused
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> U: P;

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(v: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                  0.0784335999999992, 0.878468636469772, 0.0784336,
                  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var x = clamp(log2(m * max(v, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  x = (x - minEv) / (maxEv - minEv);
  return agxContrast(x);
}
fn agxEotf(v: vec3f) -> vec3f {
  let mi = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                   -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                   -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@fragment fn fs(in: VO) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(hdr));
  var c = textureLoad(hdr, vec2i(in.pos.xy), 0).rgb;
  let b = textureSampleLevel(bloom, samp, in.uv, 0.0).rgb;
  c += b * U.p.y;
  c *= U.p.x;
  let d = (in.uv - 0.5) * vec2f(dims.x / dims.y, 1.0);
  c *= 1.0 - U.p.w * dot(d, d);
  var o = agx(c);
  // AgX look: restore some punch and saturation
  let l = dot(o, vec3f(0.2126, 0.7152, 0.0722));
  o = pow(max(o, vec3f(0.0)), vec3f(U.q.y));
  o = l + U.q.x * (o - l);
  o = agxEotf(o);
  o = pow(max(o, vec3f(0.0)), vec3f(2.2));
  o *= U.q.z;
  let n = ign(in.pos.xy + U.p.z * 5.588) + ign(in.pos.xy * 1.37 + 17.0 + U.p.z * 3.1) - 1.0;
  o = pow(max(o, vec3f(0.0)), vec3f(1.0 / 2.2)) + n / 255.0;
  return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
