// Named looks for the tank. A scene sets the water and the sun, and (except Day reef
// and Custom) a different rock and coral layout. Day reef is the original reef.

export const SCENE_FIELDS = [
  ['waterColor', 'environment.waterColor'],
  ['waterClarity', 'environment.waterClarity'],
  ['ambientLightIntensity', 'environment.ambientLightIntensity'],
  ['causticIntensity', 'environment.causticIntensity'],
  ['currentStrength', 'environment.currentStrength'],
  ['lightRayIntensity', 'environment.lightRayIntensity'],
  ['bloom', 'environment.bloom'],
  ['exposure', 'environment.exposure'],
  ['sunColor', 'environment.sunColor'],
  ['sunIntensity', 'environment.sunIntensity'],
  ['lightX', 'environment.lightX'],
  ['lightY', 'environment.lightY'],
  ['lightZ', 'environment.lightZ'],
  ['lightRays', 'effects.lightRaysEnabled'],
];

export const SCENES = [
  {
    id: 'reef',
    name: 'Day reef',
    waterColor: '#0b5f8c',
    waterClarity: 1,
    ambientLightIntensity: 1,
    causticIntensity: 1,
    currentStrength: 1,
    lightRayIntensity: 1,
    bloom: 0.05,
    exposure: 1,
    sunColor: '#fffbf3',
    sunIntensity: 2.4,
    lightX: 0.22,
    lightY: 1,
    lightZ: 0.3,
    lightRays: true,
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    waterColor: '#128e9c',
    waterClarity: 1.35,
    ambientLightIntensity: 1.15,
    causticIntensity: 1.65,
    currentStrength: 0.6,
    lightRayIntensity: 0.7,
    bloom: 0.06,
    exposure: 1.1,
    sunColor: '#fff6e4',
    sunIntensity: 2.7,
    lightX: 0.06,
    lightY: 1,
    lightZ: 0.1,
    lightRays: true,
  },
  {
    id: 'morning',
    name: 'Morning',
    waterColor: '#1d6f96',
    waterClarity: 1.05,
    ambientLightIntensity: 0.95,
    causticIntensity: 0.8,
    currentStrength: 0.7,
    lightRayIntensity: 1.4,
    bloom: 0.09,
    exposure: 1.02,
    sunColor: '#ffc396',
    sunIntensity: 2.05,
    lightX: 0.7,
    lightY: 0.5,
    lightZ: 0.22,
    lightRays: true,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    waterColor: '#163e62',
    waterClarity: 0.9,
    ambientLightIntensity: 0.6,
    causticIntensity: 0.35,
    currentStrength: 0.45,
    lightRayIntensity: 1.7,
    bloom: 0.16,
    exposure: 1.08,
    sunColor: '#ff7a2e',
    sunIntensity: 2.35,
    lightX: 0.95,
    lightY: 0.36,
    lightZ: 0.16,
    lightRays: true,
  },
  {
    id: 'moonlight',
    name: 'Moonlight',
    waterColor: '#0c2344',
    waterClarity: 0.85,
    ambientLightIntensity: 0.5,
    causticIntensity: 0.2,
    currentStrength: 0.3,
    lightRayIntensity: 0.4,
    bloom: 0.1,
    exposure: 0.95,
    sunColor: '#b7d0ff',
    sunIntensity: 1.15,
    lightX: 0.42,
    lightY: 0.85,
    lightZ: 0.18,
    lightRays: true,
  },
  {
    id: 'deep',
    name: 'Deep water',
    waterColor: '#042430',
    waterClarity: 0.55,
    ambientLightIntensity: 0.45,
    causticIntensity: 0.08,
    currentStrength: 0.2,
    lightRayIntensity: 0.15,
    bloom: 0.03,
    exposure: 0.9,
    sunColor: '#6aadc4',
    sunIntensity: 0.75,
    lightX: 0.04,
    lightY: 1,
    lightZ: 0.02,
    lightRays: true,
  },
];

export function sceneById(id) {
  return SCENES.find((scene) => scene.id === id);
}

export function sceneValueEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  return a === b;
}

function assignScenePath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = value;
}

// skip is a set of paths to leave alone (a file or URL named them itself).
export function copyScene(cfg, id, skip) {
  const scene = sceneById(id);
  if (!scene) return false;
  for (const [key, path] of SCENE_FIELDS) {
    if (skip && skip.has(path)) continue;
    assignScenePath(cfg, path, scene[key]);
  }
  return true;
}
