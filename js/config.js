// Aquarium configuration. Rendering and behavior code only read this object; nothing in the
// simulation hard-codes these values. Override any key from the URL for development, e.g.
//   ?fish.population=50&effects.bubblesEnabled=false&environment.waterClarity=0.7
// or pass a whole JSON document as ?config=<base64url JSON>.

export const DEFAULT_CONFIG = {
  display: {
    width: 0,              // 0 = follow the window (times devicePixelRatio)
    height: 0,
    targetFps: 60,
    fullscreen: true,      // request fullscreen on the first click or key press
    showButtons: true,     // the settings toolbar; hidden while it stays idle-dim
    showInfo: false,       // frame-rate readout; also forced on for one visit by ?info=1
    adaptive: true,        // lower render scale, then drop to 30 FPS, when frames run long
    maxRenderScale: 1,     // fraction of the device pixel size to render at
    minRenderScale: 0.5,
  },

  environment: {
    waterColor: '#0b5f8c',
    waterClarity: 1.0,     // 1 = clear reef tank; lower is hazier
    ambientLightIntensity: 1.0,
    causticIntensity: 1.0,
    currentStrength: 1.0,
    lightRayIntensity: 1.0,
    bloom: 0.05,
    exposure: 1.0,
  },

  fish: {
    population: 34,
    speedMultiplier: 1.0,
    schoolingEnabled: true,
    collisionAvoidanceEnabled: true,
    speciesDistribution: {
      clownfish: 2,
      blueTang: 2,
      yellowTang: 2,
      emperorAngelfish: 2,
      butterflyfish: 3,
      moorishIdol: 1,
      lionfish: 1,
      royalGramma: 4,
      damselfish: 8,
      anthias: 6,
      triggerfish: 2,
      morayEel: 1,
    },
  },

  effects: {
    bubblesEnabled: true,
    particlesEnabled: true,
    lightRaysEnabled: true,
    coralAnimationEnabled: true,
    particleCount: 1600,
  },

  camera: {
    movementEnabled: false,  // optional, almost imperceptible pan across the reef
    movementSpeed: 1.0,
    fovDegrees: 32,
  },

  audio: {
    enabled: false,          // optional ambient aquarium sound; silent by default
    volume: 0.35,
  },

  assets: {
    // Optional GLB/glTF models per species, e.g. { blueTang: 'models/blue-tang.glb' }.
    // A model replaces the procedural mesh; procedural swimming animation still drives it.
    models: {},
  },

  seed: 20261110,
};

export function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

function coerce(old, s) {
  if (typeof old === 'number') { const n = Number(s); return Number.isFinite(n) ? n : old; }
  if (typeof old === 'boolean') return s === '1' || s === 'true' || s === 'on';
  return s;
}

export function loadConfig(search = location.search) {
  const cfg = deepMerge({}, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const qs = new URLSearchParams(search);
  const packed = qs.get('config');
  if (packed) {
    try {
      const json = atob(packed.replace(/-/g, '+').replace(/_/g, '/'));
      deepMerge(cfg, JSON.parse(json));
    } catch (e) { console.warn('ignored malformed ?config', e); }
  }
  for (const [key, value] of qs) {
    if (!key.includes('.')) continue;
    const path = key.split('.');
    let o = cfg;
    for (let i = 0; i < path.length - 1 && o; i++) o = o[path[i]];
    if (!o || typeof o !== 'object') continue;
    const leaf = path[path.length - 1];
    o[leaf] = leaf in o ? coerce(o[leaf], value) : (Number.isFinite(Number(value)) ? Number(value) : value);
  }
  return cfg;
}

// Scale the species distribution to the configured population, keeping at most one eel
// and at least one of every listed species while there is room.
export function resolvePopulation(cfg) {
  const dist = { ...cfg.fish.speciesDistribution };
  const target = Math.max(0, Math.round(cfg.fish.population));
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (!total || target === total) return dist;
  const out = {};
  const keys = Object.keys(dist).filter((k) => dist[k] > 0);
  let assigned = 0;
  const rema = [];
  for (const k of keys) {
    const exact = (dist[k] * target) / total;
    out[k] = Math.floor(exact);
    rema.push([exact - out[k], k]);
    assigned += out[k];
  }
  rema.sort((a, b) => b[0] - a[0]);
  for (let i = 0; assigned < target && i < rema.length * 4; i++) { out[rema[i % rema.length][1]]++; assigned++; }
  if (out.morayEel > 1) out.morayEel = 1;
  return out;
}
