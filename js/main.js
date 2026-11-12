// Virtual marine aquarium: a fixed camera looking through the front glass of a reef tank.
//
// URL options (normal operation needs none):
//   ?info=1                 frame-rate / resolution readout
//   ?shot=name.png&frames=N render N frames at a fixed 1/60 s step, save a PNG via the dev server
//   ?w=1920&h=1080          force the render size (screenshots)
//   ?view=lineup            one fish of every species side by side (model inspection)
//   ?cam=x,y,z,tx,ty,tz     override the camera
//   ?t=seconds              start the clock at a given time
//   ?config=<base64 JSON>   or dotted keys such as fish.population=50 (see js/config.js)
import { TAU, clamp, lerp, perspective, ortho, lookAt, mat4Mul, mat4Invert, hexToRgb, srgbToLinear } from './math.js';
import { resolvePopulation } from './config.js';
import { prepareConfig, createSettings } from './settings.js';
import { createClock } from './clock.js';
import { createWeather } from './weather.js';
import { SPECIES, SPECIES_KEYS } from './species.js';
import { buildFishMesh, FISH_STRIDE } from './fish-mesh.js';
import { CORAL_STRIDE, SOFT_TYPES } from './coral-mesh.js';
import { buildReef, TANK, FISH_BOUNDS } from './reef.js';
import { Aquarium } from './behavior.js';
import { loadGltf, fishMeshFromModel } from './gltf.js';
import { createAquariumAudio } from './audio.js';
import { FRAME_FLOATS, SHADOW_SIZE } from './wgsl/common.js';
import { FISH, FISH_SHADOW } from './wgsl/fish.js';
import { ROCK, ROCK_SHADOW, SAND, CORAL, CORAL_SHADOW, BACKGROUND } from './wgsl/scene.js';
import { PARTICLES, BUBBLES, RAYS, BUBBLES_PER_SOURCE } from './wgsl/fx.js';
import { BLOOM_DOWN, BLOOM_UP, COMPOSITE } from './wgsl/post.js';

const qs = new URLSearchParams(location.search);
const SHOT = qs.get('shot');
const SHOT_FRAMES = Number(qs.get('frames')) || 240;
const FISH_CAP = 80;
const VIEW = qs.get('view') || '';
const BU = GPUBufferUsage, TU = GPUTextureUsage, SS = GPUShaderStage;
const MSAA = 4;
const HDR = 'rgba16float';
const BLOOM_LEVELS = 5;
// a uniform-buffer copy of the time wraps after this long; fish phases live on the CPU
const SHADER_TIME_WRAP = 40000;

function log(msg) {
  console.log(msg);
  if (SHOT || qs.get('log') === '1') fetch('/__log', { method: 'POST', body: String(msg) }).catch(() => {});
}
function fail(msg) {
  const el = document.getElementById('err');
  el.textContent = msg;
  el.style.display = 'flex';
  log('FATAL ' + msg);
  if (SHOT) document.title = 'SHOT DONE';
  throw new Error(msg);
}
window.addEventListener('error', (e) => log('error: ' + e.message + ' @' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => log('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

const linearColor = (hex) => hexToRgb(hex).map(srgbToLinear);

async function main() {
  const { cfg, visitOnly } = prepareConfig();
  if (!navigator.gpu) fail('WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) fail('No WebGPU adapter found.');
  const device = await adapter.requestDevice();
  device.lost.then((i) => log('device lost: ' + i.message));
  device.onuncapturederror = (e) => log('GPU error: ' + e.error.message);

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('webgpu');
  const swapFormat = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: swapFormat, alphaMode: 'opaque', usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC });

  async function shader(code, label) {
    const m = device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    let bad = false;
    for (const msg of info.messages) {
      if (msg.type === 'error') bad = true;
      if (msg.type !== 'info') {
        const line = code.split('\n')[msg.lineNum - 1];
        log(`[${label}] ${msg.type} ${msg.lineNum}:${msg.linePos} ${msg.message}\n    ${line}`);
      }
    }
    if (bad) fail('Shader compile error in ' + label + ' (see console)');
    return m;
  }
  const buffer = (data, usage, label) => {
    const b = device.createBuffer({ label, size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | BU.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };

  // ------------------------------------------------------------------------------------
  // Scene content (CPU)
  // ------------------------------------------------------------------------------------
  const tReef = performance.now();
  const reef = buildReef(cfg.seed);
  log(`reef built in ${(performance.now() - tReef).toFixed(0)} ms`);

  // rock: pos, normal, ao
  const rock = reef.rock;
  const rockV = new Float32Array(rock.count * 7);
  for (let i = 0; i < rock.count; i++) {
    rockV.set(rock.positions.subarray(i * 3, i * 3 + 3), i * 7);
    rockV.set(rock.normals.subarray(i * 3, i * 3 + 3), i * 7 + 3);
    rockV[i * 7 + 6] = rock.ao[i];
  }
  const rockVB = buffer(rockV, BU.VERTEX, 'rock');
  const rockIB = buffer(rock.indices, BU.INDEX, 'rock idx');
  const sandVB = buffer(reef.sand.vertices, BU.VERTEX, 'sand');
  const sandIB = buffer(reef.sand.indices, BU.INDEX, 'sand idx');

  // corals: every variant in one vertex/index buffer, instances grouped per variant
  const coral = reef.corals;
  const groups = new Map();
  for (const inst of coral.instances) {
    const k = inst.name + '#' + inst.variant;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(inst);
  }
  let nV = 0, nI = 0;
  for (const k of groups.keys()) {
    const [name, v] = k.split('#');
    const m = coral.variants[name][Number(v)];
    nV += m.vertices.length / CORAL_STRIDE;
    nI += m.indices.length;
  }
  const coralV = new Float32Array(nV * CORAL_STRIDE), coralI = new Uint32Array(nI);
  const coralInst = new Float32Array(coral.instances.length * 24);
  const coralDraws = [];
  {
    let vo = 0, io = 0, ii = 0;
    for (const [k, list] of groups) {
      const [name, v] = k.split('#');
      const m = coral.variants[name][Number(v)];
      coralV.set(m.vertices, vo * CORAL_STRIDE);
      coralI.set(m.indices, io);
      for (const c of list) {
        const o = ii * 24, s = c.scale, b = c.b;
        coralInst.set([b.r[0] * s, b.r[1] * s, b.r[2] * s, c.type,
          b.u[0] * s, b.u[1] * s, b.u[2] * s, c.sway,
          b.f[0] * s, b.f[1] * s, b.f[2] * s, c.phase,
          c.pos[0], c.pos[1], c.pos[2], c.ao,
          c.colorA[0], c.colorA[1], c.colorA[2], 0,
          c.colorB[0], c.colorB[1], c.colorB[2], 0], o);
        ii++;
      }
      coralDraws.push({ firstIndex: io, indexCount: m.indices.length, baseVertex: vo, firstInstance: ii - list.length, instanceCount: list.length, soft: SOFT_TYPES.has(list[0].type) });
      vo += m.vertices.length / CORAL_STRIDE;
      io += m.indices.length;
    }
  }
  const coralVB = buffer(coralV, BU.VERTEX, 'coral');
  const coralIB = buffer(coralI, BU.INDEX, 'coral idx');
  const coralInstB = buffer(coralInst, BU.VERTEX, 'coral inst');
  log(`corals: ${coral.instances.length} instances, ${coralDraws.length} meshes, ${nV} verts`);

  // fish: one mesh + instance buffer + species uniform per species
  const distribution = VIEW === 'lineup' ? Object.fromEntries(SPECIES_KEYS.map((k) => [k, 0])) : resolvePopulation(cfg);
  for (const k in distribution) distribution[k] = Math.min(distribution[k], 40);
  const speciesBGL = device.createBindGroupLayout({
    label: 'species', entries: [
      { binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const blankTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  device.queue.writeTexture({ texture: blankTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const SCALE_FREQ = { clownfish: 70, blueTang: 110, yellowTang: 120, emperorAngelfish: 80, butterflyfish: 75, royalGramma: 70, moorishIdol: 110, lionfish: 90, damselfish: 60, anthias: 55, triggerfish: 40, morayEel: 0 };
  const STYLE = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
  const fishSlots = {};
  const models = cfg.assets && cfg.assets.models || {};
  for (const key of SPECIES_KEYS) {
    const def = SPECIES[key];
    const count = FISH_CAP;
    let mesh = null, image = null;
    const spec = models[key];
    if (spec) {
      try {
        const opts = typeof spec === 'string' ? { url: spec } : spec;
        const m = fishMeshFromModel(await loadGltf(opts.url), def, opts);
        mesh = m; image = m.image;
        log(`${key}: model ${opts.url} (${m.indices.length / 3} tris${m.clips.length ? ', clips ' + m.clips.join(',') : ''})`);
      } catch (e) {
        log(`${key}: model rejected (${e.message}); using the procedural fish`);
      }
    }
    if (!mesh) mesh = buildFishMesh(def);
    let tex = blankTex;
    if (image) {
      tex = device.createTexture({ size: [image.width, image.height], format: 'rgba8unorm-srgb', usage: TU.TEXTURE_BINDING | TU.COPY_DST | TU.RENDER_ATTACHMENT });
      device.queue.copyExternalImageToTexture({ source: image, flipY: false }, { texture: tex }, [image.width, image.height]);
    }
    const geo = def.geo;
    const u = new Float32Array([
      def.id, STYLE[def.anim.style] ?? 0, def.anim.waveK ?? 0.8, def.anim.finUndulate ?? 0,
      geo.pivot ?? 0.4, geo.tPed ?? 0.8, image ? 1 : 0, geo.pectoral ? geo.pectoral.len : 0.15,
      geo.eye ? geo.eye.t : 0.1, geo.eye ? geo.eye.y : 0.02, SCALE_FREQ[key] ?? 60, 0,
    ]);
    const ub = buffer(u, BU.UNIFORM, key + ' species');
    const data = new Float32Array(count * 20);
    fishSlots[key] = {
      data, count: 0,
      vb: buffer(mesh.vertices, BU.VERTEX, key + ' mesh'),
      ib: buffer(mesh.indices, BU.INDEX, key + ' idx'),
      indexCount: mesh.indices.length,
      inst: device.createBuffer({ label: key + ' inst', size: data.byteLength, usage: BU.VERTEX | BU.COPY_DST }),
      bg: device.createBindGroup({ layout: speciesBGL, entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: linearSampler }] }),
    };
  }

  // ------------------------------------------------------------------------------------
  // Camera, light
  // ------------------------------------------------------------------------------------
  const camBase = { eye: [0, 4.1, 11.6], target: [0, 3.45, -4] };
  if (VIEW === 'lineup') { camBase.eye = [0, 2.6, 4.2]; camBase.target = [0, 2.5, -1.5]; }
  if (qs.get('cam')) {
    const c = qs.get('cam').split(',').map(Number);
    camBase.eye = c.slice(0, 3); camBase.target = c.slice(3, 6);
  }
  let fov = (cfg.camera.fovDegrees || 32) * Math.PI / 180;
  const eye = camBase.eye.slice(), target = camBase.target.slice();
  const view = new Float32Array(16), proj = new Float32Array(16), viewProj = new Float32Array(16), invViewProj = new Float32Array(16);
  const L = [0.22, 1, 0.3];
  { const l = Math.hypot(...L); L[0] /= l; L[1] /= l; L[2] /= l; }
  const lightViewProj = new Float32Array(16);
  {
    const c = [0, 1.8, -3.6];
    const lv = new Float32Array(16), lp = new Float32Array(16);
    lookAt(lv, [c[0] + L[0] * 20, c[1] + L[1] * 20, c[2] + L[2] * 20], c, [0, 0, -1]);
    ortho(lp, -14.5, 14.5, -9, 9, 2, 40);
    mat4Mul(lightViewProj, lp, lv);
  }
  function updateCamera(time, aspect) {
    if (cfg.camera.movementEnabled && VIEW !== 'lineup') {
      // a few centimetres of lateral drift over minutes: felt more than seen
      const s = cfg.camera.movementSpeed;
      const a = Math.sin(time * 0.011 * s) * 0.7 + Math.sin(time * 0.0047 * s + 1.3) * 0.3;
      eye[0] = camBase.eye[0] + a * 0.6;
      eye[1] = camBase.eye[1] + Math.sin(time * 0.0073 * s + 0.4) * 0.08;
      target[0] = camBase.target[0] + a * 0.35;
    }
    lookAt(view, eye, target, [0, 1, 0]);
    perspective(proj, fov, aspect, 0.5, 80);
    mat4Mul(viewProj, proj, view);
    mat4Invert(invViewProj, viewProj);
  }
  const visible = (x, y, z, margin) => {
    const m = viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return false;
    const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return Math.abs(px) < margin && Math.abs(py) < margin;
  };
  updateCamera(0, 16 / 9);

  let sim = new Aquarium(reef, cfg, cfg.seed + 7, visible);
  if (VIEW !== 'lineup') sim.spawn(distribution);
  log(`fish: ${sim.fish.length}`);

  // ------------------------------------------------------------------------------------
  // GPU pipelines
  // ------------------------------------------------------------------------------------
  const frameBGL = device.createBindGroupLayout({
    label: 'frame', entries: [
      { binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: SS.VERTEX | SS.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: SS.VERTEX | SS.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
  const shadowFrameBGL = device.createBindGroupLayout({ label: 'shadow frame', entries: [{ binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'uniform' } }] });
  const raysBGL = device.createBindGroupLayout({ label: 'rays', entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } }] });
  const postBGL = device.createBindGroupLayout({
    label: 'bloom', entries: [
      { binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: SS.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const compBGL = device.createBindGroupLayout({
    label: 'composite', entries: [
      { binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: SS.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const layout = (...bgls) => device.createPipelineLayout({ bindGroupLayouts: bgls });
  const mainLayout = layout(frameBGL), fishLayout = layout(frameBGL, speciesBGL);
  const shadowLayout = layout(shadowFrameBGL), fishShadowLayout = layout(shadowFrameBGL, speciesBGL);
  const raysLayout = layout(frameBGL, raysBGL);

  const attrs = (list) => {
    let off = 0;
    const out = list.map(([loc, fmt]) => {
      const a = { shaderLocation: loc, offset: off, format: fmt };
      off += { float32: 4, float32x2: 8, float32x3: 12, float32x4: 16 }[fmt];
      return a;
    });
    return { arrayStride: off, attributes: out };
  };
  const rockLayout = attrs([[0, 'float32x3'], [1, 'float32x3'], [2, 'float32']]);
  const rockShadowLayout = { arrayStride: 28, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] };
  const coralVLayout = attrs([[0, 'float32x3'], [1, 'float32x3'], [2, 'float32x4']]);
  const coralILayout = { ...attrs([[3, 'float32x4'], [4, 'float32x4'], [5, 'float32x4'], [6, 'float32x4'], [7, 'float32x4'], [8, 'float32x4']]), stepMode: 'instance' };
  const fishVLayout = attrs([[0, 'float32x3'], [1, 'float32x3'], [2, 'float32x2'], [3, 'float32x4'], [4, 'float32x2']]);
  if (fishVLayout.arrayStride !== FISH_STRIDE * 4) fail('fish vertex layout mismatch');
  const fishILayout = { ...attrs([[5, 'float32x4'], [6, 'float32x4'], [7, 'float32x4'], [8, 'float32x4'], [9, 'float32x4']]), stepMode: 'instance' };

  const premult = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const additive = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
  const depthState = (write, compare = 'less') => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: compare });

  async function scenePipe(label, code, pl, buffers, opts = {}) {
    const module = await shader(code, label);
    return device.createRenderPipelineAsync({
      label, layout: pl,
      vertex: { module, entryPoint: 'vs', buffers },
      fragment: { module, entryPoint: 'fs', targets: [{ format: HDR, blend: opts.blend }] },
      primitive: { topology: 'triangle-list', cullMode: opts.cull || 'none' },
      depthStencil: opts.depth || depthState(true),
      multisample: { count: MSAA, alphaToCoverageEnabled: !!opts.a2c },
    });
  }
  async function shadowPipe(label, code, pl, buffers) {
    const module = await shader(code, label);
    return device.createRenderPipelineAsync({
      label, layout: pl,
      vertex: { module, entryPoint: 'vs', buffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5 },
    });
  }
  async function fullscreenPipe(label, code, pl, format, blend) {
    const module = await shader(code, label);
    return device.createRenderPipelineAsync({
      label, layout: pl,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  const [rockPipe, sandPipe, coralPipe, fishPipe, bgPipe, particlePipe, bubblePipe,
    rockShadowPipe, coralShadowPipe, fishShadowPipe, raysPipe, downPipe, upPipe, compPipe] = await Promise.all([
    scenePipe('rock', ROCK, mainLayout, [rockLayout]),
    scenePipe('sand', SAND, mainLayout, [rockLayout]),
    scenePipe('coral', CORAL, mainLayout, [coralVLayout, coralILayout]),
    scenePipe('fish', FISH, fishLayout, [fishVLayout, fishILayout], { a2c: true }),
    scenePipe('background', BACKGROUND, mainLayout, [], { depth: depthState(false, 'less-equal') }),
    scenePipe('particles', PARTICLES, mainLayout, [], { blend: premult, depth: depthState(false) }),
    scenePipe('bubbles', BUBBLES, mainLayout, [], { blend: premult, depth: depthState(false) }),
    shadowPipe('rock shadow', ROCK_SHADOW, shadowLayout, [rockShadowLayout]),
    shadowPipe('coral shadow', CORAL_SHADOW, shadowLayout, [coralVLayout, coralILayout]),
    shadowPipe('fish shadow', FISH_SHADOW, fishShadowLayout, [fishVLayout, fishILayout]),
    fullscreenPipe('rays', RAYS, raysLayout, HDR, additive),
    fullscreenPipe('bloom down', BLOOM_DOWN, layout(postBGL), HDR),
    fullscreenPipe('bloom up', BLOOM_UP, layout(postBGL), HDR, additive),
    fullscreenPipe('composite', COMPOSITE, layout(compBGL), swapFormat),
  ]);

  // ------------------------------------------------------------------------------------
  // Uniforms, shadow maps
  // ------------------------------------------------------------------------------------
  const frameF = new Float32Array(FRAME_FLOATS);
  const frameUB = device.createBuffer({ label: 'frame', size: FRAME_FLOATS * 4, usage: BU.UNIFORM | BU.COPY_DST });
  const staticShadow = device.createTexture({ label: 'static shadow', size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC });
  const dynShadow = device.createTexture({ label: 'shadow', size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_DST });
  const cmpSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const frameBG = device.createBindGroup({ layout: frameBGL, entries: [{ binding: 0, resource: { buffer: frameUB } }, { binding: 1, resource: dynShadow.createView() }, { binding: 2, resource: cmpSampler }] });
  const shadowBG = device.createBindGroup({ layout: shadowFrameBGL, entries: [{ binding: 0, resource: { buffer: frameUB } }] });

  const env = cfg.environment;
  let deep = [0, 0, 0], shallow = [0, 0, 0];
  function refreshWater() {
    const tint = linearColor(env.waterColor);
    deep = tint.map((c) => c * 0.32);
    shallow = tint.map((c, i) => c * 1.05 + [0.02, 0.07, 0.07][i]);
  }
  refreshWater();
  const bubbleSources = () => (cfg.effects.bubblesEnabled && VIEW !== 'lineup' ? reef.bubbleSources.slice(0, 6) : []);
  const drift = [0, 0, 0];
  const current = { x: 0, y: 0, z: 0 };
  let shaderTime = 0;
  function writeFrame(time, W, H) {
    const f = frameF;
    f.set(viewProj, 0); f.set(invViewProj, 16); f.set(lightViewProj, 32);
    f[48] = eye[0]; f[49] = eye[1]; f[50] = eye[2]; f[51] = shaderTime;
    f[52] = L[0]; f[53] = L[1]; f[54] = L[2]; f[55] = 2.4;
    f[56] = deep[0]; f[57] = deep[1]; f[58] = deep[2]; f[59] = env.waterClarity;
    f[60] = shallow[0]; f[61] = shallow[1]; f[62] = shallow[2]; f[63] = env.ambientLightIntensity;
    f[64] = current.x; f[65] = current.y; f[66] = current.z; f[67] = cfg.effects.coralAnimationEnabled ? 1 : 0;
    f[68] = env.causticIntensity; f[69] = cfg.effects.lightRaysEnabled ? env.lightRayIntensity : 0; f[70] = TANK.surfaceY; f[71] = 1;
    f[72] = W; f[73] = H; f[74] = 1 / H; f[75] = proj[5];
    f[76] = drift[0]; f[77] = drift[1]; f[78] = drift[2]; f[79] = 0;
    for (let i = 0; i < 6; i++) {
      const s = bubbleSources()[i];
      f[80 + i * 4] = s ? s[0] : 0; f[81 + i * 4] = s ? s[1] : 0; f[82 + i * 4] = s ? s[2] : 0; f[83 + i * 4] = s ? 1 : 0;
    }
    device.queue.writeBuffer(frameUB, 0, f);
  }

  // static casters (rock and hard corals) are rendered once
  writeFrame(0, 1, 1);
  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: staticShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setBindGroup(0, shadowBG);
    pass.setPipeline(rockShadowPipe);
    pass.setVertexBuffer(0, rockVB); pass.setIndexBuffer(rockIB, 'uint32');
    pass.drawIndexed(rock.indices.length);
    pass.setPipeline(coralShadowPipe);
    pass.setVertexBuffer(0, coralVB); pass.setVertexBuffer(1, coralInstB); pass.setIndexBuffer(coralIB, 'uint32');
    for (const d of coralDraws) if (!d.soft) pass.drawIndexed(d.indexCount, d.instanceCount, d.firstIndex, d.baseVertex, d.firstInstance);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  // ------------------------------------------------------------------------------------
  // Render targets (recreated on resize)
  // ------------------------------------------------------------------------------------
  const bloomParams = Array.from({ length: BLOOM_LEVELS * 2 }, () => device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST }));
  const compUB = device.createBuffer({ size: 32, usage: BU.UNIFORM | BU.COPY_DST });
  const compF = new Float32Array(8);
  let W = 0, H = 0, T = null;
  function makeTargets(w, h) {
    if (T) for (const t of T.all) t.destroy();
    const tex = (label, width, height, format, usage, sampleCount = 1) => device.createTexture({ label, size: [width, height], format, usage, sampleCount });
    const all = [];
    const add = (t) => { all.push(t); return t; };
    const colorMS = add(tex('color ms', w, h, HDR, TU.RENDER_ATTACHMENT, MSAA));
    const depthMS = add(tex('depth ms', w, h, 'depth32float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, MSAA));
    const hdr = add(tex('hdr', w, h, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING));
    const levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      levels.push({ t: add(tex('bloom ' + i, lw, lh, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING)), w: lw, h: lh });
    }
    for (const l of levels) l.view = l.t.createView();
    // downsample i: source = hdr (i = 0) or level i-1, target level i
    const down = levels.map((l, i) => {
      const srcW = i === 0 ? w : levels[i - 1].w, srcH = i === 0 ? h : levels[i - 1].h;
      device.queue.writeBuffer(bloomParams[i], 0, new Float32Array([1 / srcW, 1 / srcH, i === 0 ? 1 : 0, 0]));
      return device.createBindGroup({ layout: postBGL, entries: [{ binding: 0, resource: i === 0 ? hdr.createView() : levels[i - 1].view }, { binding: 1, resource: linearSampler }, { binding: 2, resource: { buffer: bloomParams[i] } }] });
    });
    // upsample i: source = level i+1, added into level i
    const up = levels.slice(0, -1).map((l, i) => {
      const s = levels[i + 1];
      device.queue.writeBuffer(bloomParams[BLOOM_LEVELS + i], 0, new Float32Array([1 / s.w, 1 / s.h, 0, 0]));
      return device.createBindGroup({ layout: postBGL, entries: [{ binding: 0, resource: s.view }, { binding: 1, resource: linearSampler }, { binding: 2, resource: { buffer: bloomParams[BLOOM_LEVELS + i] } }] });
    });
    T = {
      all, colorMSView: colorMS.createView(), depthMSView: depthMS.createView(), hdrView: hdr.createView(), levels, down, up,
      raysBG: device.createBindGroup({ layout: raysBGL, entries: [{ binding: 0, resource: depthMS.createView() }] }),
      compBG: device.createBindGroup({ layout: compBGL, entries: [{ binding: 0, resource: hdr.createView() }, { binding: 1, resource: levels[0].view }, { binding: 2, resource: linearSampler }, { binding: 3, resource: { buffer: compUB } }] }),
    };
    W = w; H = h;
  }

  // ------------------------------------------------------------------------------------
  // Sizing and adaptive quality
  // ------------------------------------------------------------------------------------
  const disp = cfg.display;
  const forcedW = Number(qs.get('w')) || disp.width || 0, forcedH = Number(qs.get('h')) || disp.height || 0;
  let renderScale = disp.maxRenderScale;
  let fpsTarget = disp.targetFps > 60 ? disp.targetFps : disp.targetFps >= 50 ? 60 : 30;
  const maxDim = device.limits.maxTextureDimension2D;
  function resize() {
    let w, h;
    if (forcedW && forcedH) { w = forcedW; h = forcedH; } else {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.round(canvas.clientWidth * dpr * renderScale);
      h = Math.round(canvas.clientHeight * dpr * renderScale);
    }
    w = clamp(w, 16, maxDim); h = clamp(h, 16, maxDim);
    if (w !== W || h !== H) {
      canvas.width = w; canvas.height = h;
      makeTargets(w, h);
    }
  }
  const perf = { ema: 1000 / 60, slowFor: 0, fastFor: 0, cooldown: 0 };
  function adapt(intervalMs, dt) {
    if (!disp.adaptive || SHOT || forcedW) return;
    perf.ema = lerp(perf.ema, intervalMs, 0.05);
    const budget = 1000 / fpsTarget;
    perf.cooldown -= dt;
    if (perf.ema > budget * 1.2) { perf.slowFor += dt; perf.fastFor = 0; } else if (perf.ema < budget * 1.05) { perf.fastFor += dt; perf.slowFor = 0; }
    if (perf.cooldown > 0) return;
    if (perf.slowFor > 2) {
      if (renderScale > disp.minRenderScale + 1e-3) renderScale = Math.max(disp.minRenderScale, renderScale * 0.85);
      else if (fpsTarget === 60) { fpsTarget = 30; log('adaptive: holding 30 FPS'); }
      perf.slowFor = 0; perf.cooldown = 3;
    } else if (perf.fastFor > 10 && renderScale < disp.maxRenderScale) {
      renderScale = Math.min(disp.maxRenderScale, renderScale * 1.08);
      perf.fastFor = 0; perf.cooldown = 4;
    }
  }

  // ------------------------------------------------------------------------------------
  // Lineup view: every species in a row, slowly turning
  // ------------------------------------------------------------------------------------
  function writeLineup(time) {
    const keys = SPECIES_KEYS.filter((k) => fishSlots[k]);
    keys.forEach((key, i) => {
      const s = fishSlots[key], def = SPECIES[key];
      const col = i % 4, row = Math.floor(i / 4);
      const len = key === 'morayEel' ? 0.7 : 0.38;
      const a = 0.35 + Math.sin(time * 0.3 + i) * 0.5;
      const d = s.data;
      d.set([(col - 1.5) * 1.15, 3.6 - row * 0.85, -1.5, len,
        Math.cos(a), 0, -Math.sin(a), (time * TAU * def.anim.tailFreq * 0.5) % (TAU * 1000),
        0, 1, 0, def.anim.tailAmp * 0.7, 0, time * TAU * def.anim.pecFreq, def.anim.pecAmp, 0,
        0.5, 1, 0.3, time * 2]);
      s.count = 1;
    });
  }

  // ------------------------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------------------------
  const hud = document.getElementById('hud');
  let audio = cfg.audio.enabled ? createAquariumAudio(cfg.audio) : null;
  let time = Number(qs.get('t')) || 0, last = performance.now(), lastShown = 0, frameNo = 0, fade = SHOT ? 1 : 0;
  let shooting = false, hudTimer = 0, hudFrames = 0, cpuMs = 0, nextDue = 0;
  const curVec = { x: 0, y: 0, z: 0 };
  const passes = {
    shadow: { colorAttachments: [], depthStencilAttachment: { view: dynShadow.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } },
  };

  function frame(now) {
    if (!shooting) requestAnimationFrame(frame);
    const budget = 1000 / fpsTarget;
    if (!SHOT) {
      // frame deadlines on a fixed grid, so a fast display averages out to the target rate
      if (now < nextDue - 1.5) return;
      nextDue = now - nextDue > budget ? now + budget : nextDue + budget;
    }
    const interval = now - last;
    last = now;
    let dt = SHOT ? 1 / 60 : Math.min(interval / 1000, 0.1);
    adapt(interval, dt);
    resize();
    time += dt;
    shaderTime = time % SHADER_TIME_WRAP;
    fade = Math.min(1, fade + dt * 0.5);

    // slowly wandering current
    const cs = env.currentStrength;
    const ang = 0.35 + 0.6 * Math.sin(time * 0.0131) + 0.3 * Math.sin(time * 0.0317 + 1.1);
    const mag = cs * (0.45 + 0.2 * Math.sin(time * 0.021 + 0.5));
    current.x = Math.cos(ang) * mag; current.y = 0.03 * Math.sin(time * 0.05) * cs; current.z = Math.sin(ang) * mag * 0.4;
    curVec.x = current.x; curVec.y = current.y; curVec.z = current.z;
    drift[0] = (drift[0] + current.x * dt * 0.22 + 22) % 22;
    drift[1] = (drift[1] + current.y * dt * 0.22 + 7.7) % 7.7;
    drift[2] = (drift[2] + current.z * dt * 0.22 + 7.95) % 7.95;

    updateCamera(time, W / H);
    const cpu0 = performance.now();
    if (VIEW === 'lineup') writeLineup(time);
    else {
      const sdt = dt * cfg.fish.speedMultiplier;
      const steps = Math.min(4, Math.ceil(sdt / (1 / 45)));
      for (let i = 0; i < steps; i++) sim.update(sdt / steps, time - sdt + (sdt * (i + 1)) / steps, curVec);
      sim.writeInstances(fishSlots);
    }
    cpuMs = lerp(cpuMs, performance.now() - cpu0, 0.1);
    for (const key in fishSlots) {
      const s = fishSlots[key];
      if (s.count) device.queue.writeBuffer(s.inst, 0, s.data, 0, s.count * 20);
    }
    writeFrame(time, W, H);
    if (audio) audio.update(dt, sim);

    const enc = device.createCommandEncoder();
    // dynamic shadow casters on top of the static map
    enc.copyTextureToTexture({ texture: staticShadow }, { texture: dynShadow }, [SHADOW_SIZE, SHADOW_SIZE]);
    {
      const pass = enc.beginRenderPass(passes.shadow);
      pass.setBindGroup(0, shadowBG);
      pass.setPipeline(coralShadowPipe);
      pass.setVertexBuffer(0, coralVB); pass.setVertexBuffer(1, coralInstB); pass.setIndexBuffer(coralIB, 'uint32');
      for (const d of coralDraws) if (d.soft) pass.drawIndexed(d.indexCount, d.instanceCount, d.firstIndex, d.baseVertex, d.firstInstance);
      pass.setPipeline(fishShadowPipe);
      for (const key in fishSlots) {
        const s = fishSlots[key];
        if (!s.count) continue;
        pass.setBindGroup(1, s.bg);
        pass.setVertexBuffer(0, s.vb); pass.setVertexBuffer(1, s.inst); pass.setIndexBuffer(s.ib, 'uint32');
        pass.drawIndexed(s.indexCount, s.count);
      }
      pass.end();
    }
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: T.colorMSView, resolveTarget: T.hdrView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: T.depthMSView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, frameBG);
      pass.setPipeline(rockPipe);
      pass.setVertexBuffer(0, rockVB); pass.setIndexBuffer(rockIB, 'uint32');
      pass.drawIndexed(rock.indices.length);
      pass.setPipeline(sandPipe);
      pass.setVertexBuffer(0, sandVB); pass.setIndexBuffer(sandIB, 'uint32');
      pass.drawIndexed(reef.sand.indices.length);
      pass.setPipeline(coralPipe);
      pass.setVertexBuffer(0, coralVB); pass.setVertexBuffer(1, coralInstB); pass.setIndexBuffer(coralIB, 'uint32');
      for (const d of coralDraws) pass.drawIndexed(d.indexCount, d.instanceCount, d.firstIndex, d.baseVertex, d.firstInstance);
      pass.setPipeline(fishPipe);
      for (const key in fishSlots) {
        const s = fishSlots[key];
        if (!s.count) continue;
        pass.setBindGroup(1, s.bg);
        pass.setVertexBuffer(0, s.vb); pass.setVertexBuffer(1, s.inst); pass.setIndexBuffer(s.ib, 'uint32');
        pass.drawIndexed(s.indexCount, s.count);
      }
      pass.setPipeline(bgPipe);
      pass.draw(3);
      if (bubbleSources().length) { pass.setPipeline(bubblePipe); pass.draw(6, 6 * BUBBLES_PER_SOURCE); }
      if (cfg.effects.particlesEnabled) { pass.setPipeline(particlePipe); pass.draw(6, cfg.effects.particleCount); }
      pass.end();
    }
    if (cfg.effects.lightRaysEnabled && env.lightRayIntensity > 0) {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: T.hdrView, loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(raysPipe);
      pass.setBindGroup(0, frameBG); pass.setBindGroup(1, T.raysBG);
      pass.draw(3);
      pass.end();
    }
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: T.levels[i].view, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(downPipe); pass.setBindGroup(0, T.down[i]); pass.draw(3); pass.end();
    }
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: T.levels[i].view, loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(upPipe); pass.setBindGroup(0, T.up[i]); pass.draw(3); pass.end();
    }
    compF[0] = env.exposure; compF[1] = env.bloom; compF[2] = frameNo % 1024; compF[3] = 0.16;
    compF[4] = 1.08; compF[5] = 1.0; compF[6] = fade; compF[7] = 0;
    device.queue.writeBuffer(compUB, 0, compF);
    const swapTex = ctx.getCurrentTexture();
    {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: swapTex.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(compPipe); pass.setBindGroup(0, T.compBG); pass.draw(3); pass.end();
    }
    let readBuf = null, bpr = 0;
    frameNo++;
    if (SHOT && frameNo >= SHOT_FRAMES) {
      shooting = true;
      bpr = Math.ceil(W * 4 / 256) * 256;
      readBuf = device.createBuffer({ size: bpr * H, usage: BU.MAP_READ | BU.COPY_DST });
      enc.copyTextureToBuffer({ texture: swapTex }, { buffer: readBuf, bytesPerRow: bpr }, [W, H]);
    }
    device.queue.submit([enc.finish()]);
    if (readBuf) saveShot(readBuf, bpr);

    if (cfg.display.showInfo) {
      hudFrames++;
      hudTimer += dt;
      if (hudTimer > 0.5) {
        hud.textContent = `${(hudFrames / hudTimer).toFixed(0)} fps  ${W}x${H}  scale ${renderScale.toFixed(2)}  target ${fpsTarget}  fish ${sim.fish.length}`;
        if (qs.get('log') === '1' && frameNo % 600 < 40) log(hud.textContent + `  cpu ${cpuMs.toFixed(2)} ms`);
        hudTimer = 0; hudFrames = 0;
      }
    }
    lastShown = now;
  }

  async function saveShot(buf, bpr) {
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const img = new ImageData(W, H);
    const bgra = swapFormat === 'bgra8unorm';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = y * bpr + x * 4, d = (y * W + x) * 4;
        img.data[d] = src[s + (bgra ? 2 : 0)];
        img.data[d + 1] = src[s + 1];
        img.data[d + 2] = src[s + (bgra ? 0 : 2)];
        img.data[d + 3] = 255;
      }
    }
    buf.unmap();
    const oc = new OffscreenCanvas(W, H);
    oc.getContext('2d').putImageData(img, 0, 0);
    const blob = await oc.convertToBlob({ type: 'image/png' });
    await fetch('/__shot?name=' + encodeURIComponent(SHOT), { method: 'POST', body: blob });
    log('shot saved ' + SHOT);
    document.title = 'SHOT DONE';
  }

  // presentation: fullscreen on the first interaction, cursor hidden while idle
  const goFullscreen = (event) => {
    const target = event && event.target;
    if (target instanceof Element && target.closest('#toolbar, #panel, #weather-widget, .place-dialog')) return;
    if (cfg.display.fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    if (audio) audio.resume();
  };
  window.addEventListener('pointerdown', goFullscreen);
  window.addEventListener('keydown', goFullscreen);

  let restockTimer = 0;
  function restock() {
    if (VIEW === 'lineup') return;
    const dist = resolvePopulation(cfg);
    for (const key of SPECIES_KEYS) dist[key] = Math.min(FISH_CAP, dist[key] || 0);
    sim = new Aquarium(reef, cfg, cfg.seed + 7, visible);
    sim.spawn(dist);
  }
  function applyAudio() {
    if (!audio && cfg.audio.enabled) audio = createAquariumAudio(cfg.audio);
    if (!audio) return;
    audio.apply(cfg.audio);
  }
  let widgets = null;
  const settings = createSettings(cfg, visitOnly, (path) => {
    if (path === 'environment.waterColor') refreshWater();
    if (path === 'camera.fovDegrees') fov = cfg.camera.fovDegrees * Math.PI / 180;
    if (path === 'display.targetFps') { fpsTarget = cfg.display.targetFps; nextDue = 0; }
    if (path === 'display.maxRenderScale' || path === 'display.minRenderScale') {
      renderScale = Math.min(cfg.display.maxRenderScale, Math.max(cfg.display.minRenderScale, renderScale));
      if (path === 'display.maxRenderScale') renderScale = cfg.display.maxRenderScale;
      resize();
    }
    if (path === 'display.fullscreen' && !cfg.display.fullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (path.startsWith('audio.')) applyAudio();
    if (path.startsWith('fish.') && VIEW !== 'lineup') {
      clearTimeout(restockTimer);
      restockTimer = setTimeout(restock, 200);
    }
    if (path.startsWith('clock.')) widgets?.clock.apply();
    if (path.startsWith('weather.') || path === 'clock.hour24') {
      widgets?.weather.update(path === 'weather.location' || path === 'weather.unit');
    }
  });
  widgets = {
    clock: createClock(document.getElementById('clock-widget'), cfg),
    weather: createWeather(document.getElementById('weather-widget'), cfg, settings.note),
  };
  widgets.clock.apply();
  widgets.weather.update(cfg.weather.enabled);
  document.getElementById('weather-widget').addEventListener('click', (event) => {
    if (event.target.closest('.weather-place')) settings.openPlace('weather.location');
  });
  let idleTimer = 0;
  window.addEventListener('pointermove', () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
  });
  document.body.classList.add('idle');

  resize();
  requestAnimationFrame(frame);
}

main().catch((e) => { if (!String(e.message).startsWith('WebGPU') && !String(e.message).startsWith('No WebGPU')) log('main failed: ' + (e.stack || e)); });
