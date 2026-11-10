// Reef environment: live rock, sand, corals (with sway), and the water background.
import { common } from './common.js';

// ---- live rock -------------------------------------------------------------------------------
export const ROCK = common() + /* wgsl */ `
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ao: f32 };
struct VOut { @builtin(position) clip: vec4f, @location(0) world: vec3f, @location(1) nrm: vec3f, @location(2) ao: f32 };

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.clip = F.viewProj * vec4f(v.pos, 1.0);
  o.world = v.pos; o.nrm = v.nrm; o.ao = v.ao;
  return o;
}

fn rockHeight(p: vec3f) -> f32 {
  let q1 = ROT3 * p;
  let q2 = ROT3 * q1;
  let q3 = ROT3 * q2;
  return vnoise3(p * 2.6) * 0.9 + vnoise3(q1 * 6.0) * 0.5 + vnoise3(q2 * 14.0 + 3.7) * 0.32 + vnoise3(q3 * 33.0 + 9.1) * 0.18;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let P = in.world;
  var N = normalize(in.nrm);
  // porous live-rock relief
  let e = 0.01;
  let h0 = rockHeight(P);
  let g = vec3f(rockHeight(P + vec3f(e, 0.0, 0.0)) - h0, rockHeight(P + vec3f(0.0, e, 0.0)) - h0, rockHeight(P + vec3f(0.0, 0.0, e)) - h0) / e;
  let detailFade = 1.0 - saturate((waterDistance(P) - 3.0) / 12.0);
  N = normalize(N - (g - N * dot(g, N)) * 0.06 * (0.4 + 0.6 * detailFade));

  let n1 = fbm3(P * 0.9);
  var col = mix(srgb(vec3f(0.40, 0.35, 0.28)), srgb(vec3f(0.58, 0.52, 0.42)), n1);
  // muted pink-purple coralline crusts, broken up into small patches
  let corN = fbm3(P * 2.1 + 5.0) + (vnoise3(P * 9.0) - 0.5) * 0.25;
  let cor = smoothstep(0.52, 0.6, corN) * saturate(N.y * 0.5 + 0.7);
  col = mix(col, mix(srgb(vec3f(0.5, 0.36, 0.44)), srgb(vec3f(0.62, 0.46, 0.55)), vnoise3(P * 11.0)), cor * 0.7);
  // green-brown turf algae on top surfaces
  let turf = smoothstep(0.48, 0.64, fbm3(P * 2.4 + 11.0)) * smoothstep(0.4, 0.9, N.y);
  col = mix(col, mix(srgb(vec3f(0.3, 0.34, 0.18)), srgb(vec3f(0.4, 0.34, 0.21)), vnoise3(P * 5.0)), turf * 0.7);
  // small encrusting coral colonies with polyp dimples
  let encN = vnoise3(P * 2.3 + 23.0) + (vnoise3(P * 8.0) - 0.5) * 0.18;
  let enc = smoothstep(0.74, 0.8, encN) * saturate(N.y + 0.8);
  let pick = vnoise3(P * 0.6 + 41.0);
  let encCol = mix(mix(srgb(vec3f(0.62, 0.46, 0.32)), srgb(vec3f(0.5, 0.42, 0.52)), smoothstep(0.35, 0.5, pick)),
                   srgb(vec3f(0.44, 0.52, 0.4)), smoothstep(0.62, 0.75, pick));
  let polyp = smoothstep(0.55, 0.75, vnoise3(P * 70.0));
  col = mix(col, encCol * (0.85 + 0.3 * polyp), enc * 0.85);
  // pores and pitted crevices
  let pore = smoothstep(0.66, 0.86, vnoise3(ROT3 * P * 27.0 + 1.3)) * smoothstep(0.35, 0.65, vnoise3(P * 3.0 + 4.0)) * (1.0 - enc);
  col *= 1.0 - pore * 0.32;
  // darker pitted crevices following the relief
  col *= mix(0.72, 1.0, smoothstep(0.25, 0.6, vnoise3(P * 5.5 + 2.0) * 0.6 + h0 * 0.25));
  col *= 0.7 + 0.3 * saturate(h0 * 0.6);

  var s: Surface;
  s.albedo = col;
  s.rough = 0.86;
  s.f0 = 0.03;
  s.ao = pow(in.ao, 1.4) * (1.0 - pore * 0.4);
  s.translucency = 0.0;
  s.causticK = 0.8;
  var c = shade(P, N, s, in.clip.xy);
  c = applyWater(c, P);
  return vec4f(c, 1.0);
}
`;

export const ROCK_SHADOW = common({ shadow: true }) + /* wgsl */ `
@vertex fn vs(@location(0) pos: vec3f) -> @builtin(position) vec4f { return F.lightViewProj * vec4f(pos, 1.0); }
`;

// ---- sand ------------------------------------------------------------------------------------
export const SAND = common() + /* wgsl */ `
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) ao: f32 };
struct VOut { @builtin(position) clip: vec4f, @location(0) world: vec3f, @location(1) nrm: vec3f, @location(2) ao: f32 };

@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.clip = F.viewProj * vec4f(v.pos, 1.0);
  o.world = v.pos; o.nrm = v.nrm; o.ao = v.ao;
  return o;
}

fn ripple(p: vec2f) -> f32 {
  let w = vnoise2(p * 0.45) * 7.0 + vnoise2(p * 1.3) * 1.5;
  return sin(dot(p, vec2f(0.78, 0.62)) * 8.5 + w);
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let P = in.world;
  var N = normalize(in.nrm);
  let q = P.xz;
  let e = 0.02;
  let r0 = ripple(q);
  let gr = vec2f(ripple(q + vec2f(e, 0.0)) - r0, ripple(q + vec2f(0.0, e)) - r0) / e;
  let rippleK = 0.0045 * smoothstep(0.35, 0.6, vnoise2(q * 0.25 + 3.0));
  N = normalize(N - vec3f(gr.x, 0.0, gr.y) * rippleK);
  // grain: individual grains near the glass, an even tone further back
  let fine = 1.0 - saturate(length(fwidth(q * 160.0)) - 0.5);
  let grain = mix(0.5, hash21(floor(q * 160.0)), fine);
  let grain2 = mix(0.5, hash21(floor(q * 55.0) + 7.0), 1.0 - saturate(length(fwidth(q * 55.0)) - 0.5));
  var col = srgb(vec3f(0.76, 0.7, 0.58)) * (0.9 + 0.12 * vnoise2(q * 2.5));
  col = mix(col, srgb(vec3f(0.62, 0.57, 0.47)), smoothstep(0.55, 0.8, vnoise2(q * 0.6 + 9.0)) * 0.5);
  col *= 0.86 + 0.16 * grain + 0.1 * grain2;
  // crushed coral fragments
  let frag = step(0.985, hash21(floor(q * 70.0) + 3.0)) * fine;
  col = mix(col, srgb(vec3f(0.85, 0.6, 0.62)), frag * 0.6);
  col = mix(col, srgb(vec3f(0.55, 0.5, 0.45)), step(0.992, hash21(floor(q * 90.0) + 11.0)) * fine * 0.7);
  var s: Surface;
  s.albedo = col;
  s.rough = 0.9;
  s.f0 = 0.03;
  s.ao = in.ao;
  s.translucency = 0.0;
  s.causticK = 0.9;
  var c = shade(P, N, s, in.clip.xy);
  // occasional grain glints
  let glint = step(0.997, hash21(floor(q * 220.0) + floor(F.camPos.w * 0.5))) * fine;
  c += vec3f(glint) * 0.5 * sunColor() * depthAttenuation(P.y) * causticsAt(P);
  c = applyWater(c, P);
  return vec4f(c, 1.0);
}
`;

// ---- corals ----------------------------------------------------------------------------------
const CORAL_VS = /* wgsl */ `
struct VIn {
  @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) aux: vec4f,
  @location(3) c0: vec4f, @location(4) c1: vec4f, @location(5) c2: vec4f, @location(6) c3: vec4f,
  @location(7) ca: vec4f, @location(8) cb: vec4f,
};
fn isSoft(t: i32) -> bool { return t == 4 || t == 5 || t == 6 || t == 7; }

fn coralWorld(v: VIn) -> vec3f {
  let type_ = i32(v.c0.w + 0.5);
  let M = mat3x3f(v.c0.xyz, v.c1.xyz, v.c2.xyz);
  var lp = v.pos;
  let tt = F.camPos.w;
  let anim = F.current.w;
  if (type_ == 6) { lp += v.nrm * 0.005 * sin(tt * 0.55 + v.aux.z) * anim; }
  if (type_ == 2) { lp.y *= 1.0 + 0.05 * sin(tt * 0.4 + v.c2.w) * anim; }
  var world = v.c3.xyz + M * lp;
  if (isSoft(type_) && anim > 0.5) {
    let w = v.aux.x * v.c1.w;
    let ph = v.aux.z + v.c2.w;
    let cur = F.current.xyz;
    var off = cur * (0.65 + 0.35 * sin(tt * 0.31 + ph * 0.3));
    off += vec3f(sin(tt * 0.77 + ph + world.x * 0.6), 0.25 * sin(tt * 0.55 + ph * 1.7), cos(tt * 0.63 + ph * 1.3 + world.z * 0.5)) * 0.45;
    var amp = 0.045;
    if (type_ == 4) { amp = 0.07; } else if (type_ == 5) { amp = 0.035; } else if (type_ == 6) { amp = 0.0; }
    world += off * w * amp * length(v.c1.xyz);
  }
  return world;
}
`;

export const CORAL = common() + CORAL_VS + /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) aux: vec4f,
  @location(3) lp: vec3f,
  @location(4) @interpolate(flat) ca: vec4f,
  @location(5) @interpolate(flat) cb: vec4f,
  @location(6) @interpolate(flat) info: vec4f, // type, ao, phase, scale
};

@vertex fn vs(v: VIn) -> VOut {
  let M = mat3x3f(v.c0.xyz, v.c1.xyz, v.c2.xyz);
  let world = coralWorld(v);
  var o: VOut;
  o.clip = F.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = normalize(M * v.nrm);
  o.aux = v.aux;
  o.lp = v.pos;
  o.ca = v.ca; o.cb = v.cb;
  o.info = vec4f(v.c0.w, v.c3.w, v.c2.w, length(v.c1.xyz));
  return o;
}

fn stripesC(q: f32, duty: f32) -> f32 {
  let fw = fwidth(q);
  let d = abs(fract(q) - 0.5) * 2.0;
  return mix(1.0 - smoothstep(duty - fw, duty + fw, d), duty, saturate(fw * 1.5 - 0.3));
}

@fragment fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let type_ = i32(in.info.x + 0.5);
  var N = normalize(in.nrm);
  if (!front) { N = -N; }
  let lp = in.lp;
  let A = in.ca.rgb; let B = in.cb.rgb;
  var col = A;
  var rough = 0.65;
  var transl = 0.1;
  var ao = mix(0.55, 1.0, in.info.y);
  let near = 1.0 - saturate((waterDistance(in.world) - 2.0) / 10.0);
  switch (type_) {
    case 0, 8: {
      // staghorn and finger: pale growing tips, corallite pits
      let tip = in.aux.y;
      col = mix(A, B, smoothstep(select(0.5, 0.6, type_ == 8), 1.0, tip));
      let d = vnoise3(lp * select(70.0, 95.0, type_ == 8));
      let pit = smoothstep(0.62, 0.78, d) * near;
      col *= 1.0 - pit * 0.35;
      N = normalize(N + (vec3f(vnoise3(lp * 80.0 + 1.0), vnoise3(lp * 80.0 + 2.0), vnoise3(lp * 80.0 + 3.0)) - 0.5) * 0.35 * near);
      ao *= mix(0.6, 1.0, smoothstep(0.0, 0.5, tip + lp.y * 0.6));
      rough = 0.62;
    }
    case 1: {
      // brain coral: meandering valleys traced as contour lines of a warped noise field
      let wp = lp * 5.5 + vec3f(vnoise3(lp * 2.0), vnoise3(lp * 2.0 + 5.0), vnoise3(lp * 2.0 + 9.0)) * 1.2;
      let n = fbm3(wp);
      let val = abs(fract(n * 6.0) - 0.5) * 2.0;
      let valley = 1.0 - smoothstep(0.25, 0.6, val);
      let septa = stripesC((wp.x + wp.y * 0.7 + wp.z * 0.4) * 6.0, 0.3) * (1.0 - valley);
      col = mix(A, B, valley);
      col *= 1.0 - septa * 0.18 * near;
      let gx = dpdx(valley); let gy = dpdy(valley);
      N = normalize(N + (normalize(dpdx(in.world)) * gx + normalize(dpdy(in.world)) * gy) * 2.5 * near);
      ao *= 1.0 - valley * 0.35;
      rough = 0.55;
    }
    case 2: {
      // mushroom: radial septa, a pale mouth and fleshy speckles
      let r = in.aux.y;
      let septa = stripesC(in.aux.z * 28.0 / 6.2831, 0.35);
      col = mix(A, A * 1.25, septa * 0.4);
      col = mix(col, B, smoothstep(0.6, 0.8, vnoise3(lp * 18.0)) * 0.6);
      col = mix(col, B * 1.2, 1.0 - smoothstep(0.05, 0.12, r));
      if (in.aux.w > 0.5) { col = A * 0.5; }
      rough = 0.4; transl = 0.3;
    }
    case 3: {
      // plating coral: growth rings, lighter growing edge, polyp pores
      let r = in.aux.y;
      let rings = stripesC(r * 13.0, 0.3);
      col = mix(A, B, smoothstep(0.78, 1.0, r));
      col *= 0.9 + 0.1 * rings;
      col *= 1.0 - smoothstep(0.65, 0.8, vnoise3(lp * 85.0)) * 0.3 * near;
      if (in.aux.w < 0.5) { col *= 0.6; ao *= 0.6; }
      rough = 0.6;
    }
    case 4: {
      // gorgonian fan: polyp speckles along the branches
      col = mix(A, B, smoothstep(0.55, 0.8, vnoise3(lp * 120.0)) * 0.8);
      rough = 0.7; transl = 0.35;
    }
    case 5: {
      // toadstool leather: extended polyps make the cap look furry
      if (in.aux.w > 0.75) {
        let fuzz = vnoise3(lp * 110.0);
        col = mix(A, B, smoothstep(0.45, 0.85, fuzz));
        N = normalize(N + (vec3f(fuzz, vnoise3(lp * 110.0 + 4.0), vnoise3(lp * 110.0 + 8.0)) - 0.5) * 0.6 * near);
      } else if (in.aux.w > 0.25) {
        col = A * 0.75;
      } else {
        col = mix(B, A, 0.3) * (0.95 + 0.1 * stripesC(lp.y * 40.0, 0.4));
      }
      rough = 0.7; transl = 0.3;
    }
    case 6: {
      // bubble coral vesicles: pearly and translucent
      col = mix(A, B, in.aux.y);
      rough = 0.28; transl = 0.85;
      let V = normalize(F.camPos.xyz - in.world);
      col *= 0.85 + 0.35 * pow(1.0 - saturate(dot(N, V)), 2.0);
    }
    case 7: {
      if (in.aux.w > 0.5) {
        // tentacle with a bubble tip
        col = mix(A, B, smoothstep(0.55, 0.92, in.aux.y));
        transl = 0.6; rough = 0.45;
      } else {
        col = A * 0.65 * (0.9 + 0.2 * stripesC(atan2(lp.z, lp.x) * 4.0, 0.4));
        rough = 0.5; transl = 0.3;
      }
    }
    case 9: {
      col = mix(A, B, fbm3(lp * 7.0 + in.info.z));
      col *= 0.85 + 0.3 * vnoise3(lp * 40.0);
      rough = 0.9;
    }
    default: {
      // shell: radial ribs and concentric growth bands
      let ribs = 0.5 + 0.5 * sin(in.aux.z);
      let bands = stripesC(in.aux.y * 7.0 + in.info.z, 0.25);
      col = mix(A, B, bands * 0.55) * (0.88 + 0.12 * ribs);
      rough = 0.45;
    }
  }
  var s: Surface;
  s.albedo = col;
  s.rough = rough;
  s.f0 = 0.035;
  s.ao = ao;
  s.translucency = transl;
  s.causticK = 1.0;
  var c = shade(in.world, N, s, in.clip.xy);
  c = applyWater(c, in.world);
  return vec4f(c, 1.0);
}
`;

export const CORAL_SHADOW = common({ shadow: true }) + CORAL_VS + /* wgsl */ `
@vertex fn vs(v: VIn) -> @builtin(position) vec4f { return F.lightViewProj * vec4f(coralWorld(v), 1.0); }
`;

// ---- water background -------------------------------------------------------------------------
export const BACKGROUND = common() + /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let w = F.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let dir = normalize(w.xyz / w.w - F.camPos.xyz);
  var c = waterColor(dir);
  // faint shimmer of the surface far above
  let t = F.camPos.w;
  let sh = vnoise2(dir.xz / max(dir.y + 0.6, 0.2) * 3.0 + vec2f(t * 0.05, t * 0.03));
  c *= 1.0 + 0.06 * (sh - 0.5) * smoothstep(-0.1, 0.3, dir.y);
  return vec4f(c, 1.0);
}
`;
