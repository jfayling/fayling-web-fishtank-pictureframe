// Settings panel, modelled on fayling-web-ocean-pictureframe: a dim toolbar, a collapsible
// panel built from a schema, and persistence in localStorage. A share link, a JSON file,
// and "reset" round-trip the same values. Only values that differ from the defaults are
// stored. URL overrides (?s=, ?config=, dotted keys, ?info=1) are applied on top.
import { DEFAULT_CONFIG, deepMerge, loadConfig, resolvePopulation } from './config.js';
import { SPECIES, SPECIES_KEYS } from './species.js';
import { acceptedPlace, rememberChoice, resolvePlace, suggestPlaces } from './place.js';

const SETTINGS_KEY = 'fishtank-settings-v1';

const SPECIES_SETTINGS = SPECIES_KEYS.map((key) => [
  'fish.speciesDistribution.' + key, SPECIES[key].name, 0, key === 'morayEel' ? 1 : 16, 1,
]);

const SECTIONS = [
  { title: 'General', groups: [{ settings: [
    ['display.showButtons', 'Onscreen buttons', 'toggle', 'Show', 'Hide'],
    ['display.showInfo', 'Onscreen information', 'toggle', 'Show', 'Hide'],
    ['display.fullscreen', 'Fullscreen on click', 'toggle', 'On', 'Off'],
    ['display.adaptive', 'Adaptive quality', 'toggle', 'On', 'Off'],
    ['display.targetFps', 'Target frame rate', 30, 60, 1],
    ['display.maxRenderScale', 'Render scale', 0.5, 1, 0.05],
    ['display.minRenderScale', 'Minimum scale', 0.35, 1, 0.05],
  ] }] },
  { title: 'Tank', groups: [{ settings: [
    ['environment.waterColor', 'Water color', 'color'],
    ['environment.waterClarity', 'Clarity', 0.3, 2, 0.01],
    ['environment.ambientLightIntensity', 'Ambient light', 0, 2, 0.01],
    ['environment.causticIntensity', 'Caustics', 0, 2, 0.01],
    ['environment.currentStrength', 'Current', 0, 2, 0.01],
    ['environment.lightRayIntensity', 'Light rays', 0, 2, 0.01],
    ['environment.bloom', 'Bloom', 0, 0.3, 0.005],
    ['environment.exposure', 'Exposure', 0.3, 2, 0.01],
  ] }] },
  { title: 'Fish', groups: [
    { settings: [
      ['fish.population', 'Population', 0, 80, 1],
      ['fish.speedMultiplier', 'Speed', 0.2, 2, 0.05],
      ['fish.schoolingEnabled', 'Schooling', 'toggle', 'On', 'Off'],
      ['fish.collisionAvoidanceEnabled', 'Collision avoidance', 'toggle', 'On', 'Off'],
    ] },
    { title: 'Species', settings: SPECIES_SETTINGS },
  ] },
  { title: 'Effects', groups: [{ settings: [
    ['effects.bubblesEnabled', 'Bubbles', 'toggle', 'On', 'Off'],
    ['effects.particlesEnabled', 'Particles', 'toggle', 'On', 'Off'],
    ['effects.particleCount', 'Particle count', 0, 4000, 50],
    ['effects.lightRaysEnabled', 'Light rays', 'toggle', 'On', 'Off'],
    ['effects.coralAnimationEnabled', 'Coral sway', 'toggle', 'On', 'Off'],
  ] }] },
  { title: 'Camera', groups: [{ settings: [
    ['camera.movementEnabled', 'Slow pan', 'toggle', 'On', 'Off'],
    ['camera.movementSpeed', 'Pan speed', 0, 3, 0.05],
    ['camera.fovDegrees', 'Field of view', 20, 50, 1],
  ] }] },
  { title: 'Sound', groups: [
    { settings: [
      ['audio.enabled', 'Playback', 'toggle', 'On', 'Off'],
      ['audio.volume', 'Master volume', 0, 1, 0.01],
    ] },
    { title: 'Hiss', settings: [
      ['audio.hissEnabled', 'Enable', 'toggle', 'On', 'Off'],
      ['audio.hissVolume', 'Volume', 0, 2, 0.01],
      ['audio.hissTone', 'Tone', 0, 1, 0.01],
    ] },
    { title: 'Bubbles', settings: [
      ['audio.bubblesEnabled', 'Enable', 'toggle', 'On', 'Off'],
      ['audio.bubbleVolume', 'Volume', 0, 2, 0.01],
      ['audio.bubbleRate', 'Rate', 0, 3, 0.05],
      ['audio.bubblePitch', 'Pitch', 0, 1, 0.01],
      ['audio.bubblePlink', 'Plink', 0, 1, 0.01],
    ] },
  ] },
  { title: 'Widgets', groups: [
    { title: 'Clock', groups: [
      { title: 'Display', settings: [
        ['clock.enabled', 'Clock', 'toggle', 'On', 'Off'],
        ['clock.hour24', '24-hour time', 'toggle', 'On', 'Off'],
        ['clock.seconds', 'Show seconds', 'toggle', 'Show', 'Hide'],
        ['clock.date', 'Show date', 'toggle', 'Show', 'Hide'],
      ] },
      { title: 'Appearance', settings: [
        ['clock.style', 'Style', 'select', [
          ['modern', 'Modern'],
          ['mono', 'Monospace'],
          ['classic', 'Classic'],
        ]],
        ['clock.position', 'Position', 'select', [
          ['top-left', 'Top left'],
          ['top-center', 'Top center'],
          ['top-right', 'Top right'],
          ['bottom-left', 'Bottom left'],
          ['bottom-center', 'Bottom center'],
          ['bottom-right', 'Bottom right'],
        ]],
        ['clock.size', 'Size (px)', 32, 144, 1],
        ['clock.color', 'Color', 'color'],
        ['clock.opacity', 'Opacity', 0.2, 1, 0.01],
        ['clock.background', 'Background', 0, 0.8, 0.01],
      ] },
    ] },
    { title: 'Weather', groups: [
      { title: 'Location and updates', settings: [
        ['weather.enabled', 'Weather widget', 'toggle', 'Show', 'Hide'],
        ['weather.location', 'Location', 'text', 'Lisbon, Portugal'],
        ['weather.refresh', 'Refresh (minutes)', 5, 60, 5],
        ['weather.unit', 'Units', 'select', [
          ['fahrenheit', 'Fahrenheit / mph'],
          ['celsius', 'Celsius / km/h'],
        ]],
        ['weather.position', 'Position', 'select', [
          ['top-left', 'Top left'],
          ['top-right', 'Top right'],
          ['bottom-left', 'Bottom left'],
          ['bottom-right', 'Bottom right'],
        ]],
      ] },
      { title: 'Information', settings: [
        ['weather.temperature', 'Current temperature', 'toggle', 'Show', 'Hide'],
        ['weather.feels', 'Feels like', 'toggle', 'Show', 'Hide'],
        ['weather.precipitation', 'Precipitation', 'toggle', 'Show', 'Hide'],
        ['weather.humidity', 'Humidity', 'toggle', 'Show', 'Hide'],
        ['weather.wind', 'Wind', 'toggle', 'Show', 'Hide'],
        ['weather.forecast', 'Next 3 hours', 'toggle', 'Show', 'Hide'],
        ['weather.alerts', 'U.S. weather alerts', 'toggle', 'Show', 'Hide'],
      ] },
    ] },
  ] },
];

const SPEC = new Map();
function eachSetting(groups, visit) {
  for (const group of groups || []) {
    for (const setting of group.settings || []) visit(setting);
    eachSetting(group.groups, visit);
  }
}
for (const section of SECTIONS) eachSetting(section.groups, (setting) => SPEC.set(setting[0], setting));

const clone = (v) => JSON.parse(JSON.stringify(v));
const partsOf = (path) => path.split('.');
export function getPath(obj, path) {
  return partsOf(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = partsOf(path);
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = value;
}
function hasPath(obj, path) {
  const parts = partsOf(path);
  let o = obj;
  for (const p of parts) {
    if (!o || typeof o !== 'object' || !Object.hasOwn(o, p)) return false;
    o = o[p];
  }
  return true;
}

function booleanSetting(raw) {
  if (typeof raw === 'boolean') return raw;
  if (raw === 1 || raw === 0) return Boolean(raw);
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'off') return false;
  return undefined;
}
function coerce(spec, raw) {
  if (!spec) return undefined;
  if (spec[2] === 'toggle') return booleanSetting(raw);
  if (spec[2] === 'color') return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : undefined;
  if (spec[2] === 'select') return spec[3].some((option) => option[0] === raw) ? raw : undefined;
  if (spec[2] === 'text') return acceptedPlace(raw) || undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(spec[3], Math.max(spec[2], n));
}

function readStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}
function decodeBase64Url(value) {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

// Apply saved settings, then a shared link, then explicit URL overrides. Keys that came
// from the URL are not written back until the user edits them.
export function prepareConfig(search = location.search) {
  const cfg = clone(DEFAULT_CONFIG);
  const visitOnly = new Set();
  const url = new URLSearchParams(search);
  applyDocument(cfg, readStorage());
  if (url.has('s')) {
    const shared = decodeBase64Url(url.get('s'));
    if (shared && typeof shared === 'object' && !Array.isArray(shared)) {
      for (const path of SPEC.keys()) setPath(cfg, path, getPath(DEFAULT_CONFIG, path));
      applyDocument(cfg, shared);
    }
  }
  let packed = null;
  if (url.has('config')) {
    try { packed = JSON.parse(atob(url.get('config').replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { /* ignored; loadConfig reports it when used directly */ }
    applyDocument(cfg, packed, visitOnly);
  }
  // dotted keys that are not panel settings (models, and anything added later)
  const urlCfg = loadConfig(search);
  let speciesFromUrl = false;
  let populationFromUrl = false;
  for (const [key, value] of url) {
    if (!key.includes('.')) continue;
    if (SPEC.has(key)) {
      const coerced = coerce(SPEC.get(key), value);
      if (coerced === undefined) continue;
      setPath(cfg, key, coerced);
      visitOnly.add(key);
      if (key === 'fish.population') populationFromUrl = true;
      if (key.startsWith('fish.speciesDistribution.')) speciesFromUrl = true;
    } else {
      const fromUrl = getPath(urlCfg, key);
      if (fromUrl !== undefined) setPath(cfg, key, fromUrl);
    }
  }
  if (packed && hasPath(packed, 'fish.population')) populationFromUrl = true;
  if (packed && hasPath(packed, 'fish.speciesDistribution')) speciesFromUrl = true;
  if (url.get('info') === '1') { cfg.display.showInfo = true; visitOnly.add('display.showInfo'); }
  if (url.has('shot')) {
    cfg.display.showButtons = false;
    cfg.clock.enabled = false;
    cfg.weather.enabled = false;
    visitOnly.add('display.showButtons');
    visitOnly.add('clock.enabled');
    visitOnly.add('weather.enabled');
  }
  // ?fish.population=50 scales the mix. A URL that names species instead is the mix itself.
  if (speciesFromUrl && !populationFromUrl) cfg.fish.population = Object.values(cfg.fish.speciesDistribution).reduce((a, b) => a + b, 0);
  settleFish(cfg);
  return { cfg, visitOnly };
}

// The species sliders are the fish you actually get. A stored population that does not
// match their sum is scaled back onto them once, here.
function settleFish(cfg) {
  const counts = resolvePopulation(cfg);
  for (const key of Object.keys(counts)) {
    const spec = SPEC.get('fish.speciesDistribution.' + key);
    if (spec) counts[key] = Math.min(spec[3], Math.max(spec[2], counts[key]));
  }
  cfg.fish.speciesDistribution = counts;
  cfg.fish.population = Object.values(counts).reduce((a, b) => a + b, 0);
}

function applyDocument(cfg, data, locked) {
  if (!data) return;
  for (const path of SPEC.keys()) {
    let raw;
    if (Object.hasOwn(data, path)) raw = data[path];
    else if (hasPath(data, path)) raw = getPath(data, path);
    else continue;
    const value = coerce(SPEC.get(path), raw);
    if (value === undefined) continue;
    setPath(cfg, path, value);
    if (locked) locked.add(path);
  }
  // seed and model paths are not panel settings, but a settings file may carry them
  if (Number.isFinite(Number(data.seed))) cfg.seed = Number(data.seed);
  if (data.assets && typeof data.assets === 'object') deepMerge(cfg.assets, data.assets);
}

export function createSettings(cfg, visitOnly, onChange) {
  const panel = document.getElementById('panel');
  const panelBody = document.getElementById('panel-body');
  const settingsBtn = document.getElementById('settings');
  const controls = new Map();
  // proportions behind the population slider; species edits replace one entry
  let mix = clone(cfg.fish.speciesDistribution);
  let shareUrlInput = null;

  function setPanelOpen(open) {
    panel.classList.toggle('hidden', !open);
    settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) settingsBtn.classList.add('on'); else settingsBtn.classList.remove('on');
  }
  function togglePanel() { setPanelOpen(panel.classList.contains('hidden')); }
  settingsBtn.addEventListener('click', (event) => { event.stopPropagation(); togglePanel(); });
  document.getElementById('close-settings').addEventListener('click', (event) => {
    event.stopPropagation();
    setPanelOpen(false);
  });

  function snapshot() {
    const changed = {};
    for (const path of SPEC.keys()) {
      if (visitOnly.has(path)) continue;
      const value = getPath(cfg, path);
      if (value !== getPath(DEFAULT_CONFIG, path)) setPath(changed, path, value);
    }
    return changed;
  }
  function remember() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot())); } catch { /* unavailable */ }
    if (shareUrlInput && !shareUrlInput.hidden) shareUrlInput.value = shareUrl();
  }
  function shareUrl() {
    const url = new URL(location.href);
    url.hash = '';
    const params = url.searchParams;
    for (const key of [...params.keys()]) if (key === 's' || SPEC.has(key) || key === 'config' || key === 'info') params.delete(key);
    params.set('s', encodeBase64Url(JSON.stringify(snapshot())));
    return url.href;
  }

  function paint(path) {
    const control = controls.get(path);
    if (!control) return;
    const value = getPath(cfg, path);
    if (control.kind === 'bool') {
      control.input.checked = value;
      control.output.textContent = value ? control.onText : control.offText;
    } else if (control.kind === 'color' || control.kind === 'select') control.input.value = value;
    else if (control.kind === 'text') control.input.value = value;
    else {
      control.input.value = String(value);
      control.output.textContent = control.input.value;
    }
  }
  function lock(path, locked) {
    const control = controls.get(path);
    if (!control) return;
    control.input.disabled = locked;
    control.row.classList.toggle('disabled', locked);
  }
  function refreshLocks() {
    const quiet = !cfg.audio.enabled;
    lock('audio.volume', quiet);
    lock('audio.hissEnabled', quiet);
    lock('audio.hissVolume', quiet || !cfg.audio.hissEnabled);
    lock('audio.hissTone', quiet || !cfg.audio.hissEnabled);
    lock('audio.bubblesEnabled', quiet);
    lock('audio.bubbleVolume', quiet || !cfg.audio.bubblesEnabled);
    lock('audio.bubbleRate', quiet || !cfg.audio.bubblesEnabled);
    lock('audio.bubblePitch', quiet || !cfg.audio.bubblesEnabled);
    lock('audio.bubblePlink', quiet || !cfg.audio.bubblesEnabled);
    lock('camera.movementSpeed', !cfg.camera.movementEnabled);
    lock('effects.particleCount', !cfg.effects.particlesEnabled);
    lock('environment.lightRayIntensity', !cfg.effects.lightRaysEnabled);
  }
  function paintSound() {
    const button = document.getElementById('sound');
    const on = cfg.audio.enabled;
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('on', on);
    button.textContent = on ? 'Sound on' : 'Sound off';
  }
  function applyChrome() {
    document.getElementById('hud').style.display = cfg.display.showInfo ? 'block' : 'none';
    document.getElementById('toolbar').style.display = cfg.display.showButtons ? '' : 'none';
    panel.style.top = cfg.display.showButtons ? '50px' : '10px';
    panel.style.maxHeight = cfg.display.showButtons ? 'calc(100vh - 60px)' : 'calc(100vh - 20px)';
  }

  function commit(path, raw) {
    const spec = SPEC.get(path);
    const value = coerce(spec, raw);
    if (value === undefined) return false;
    visitOnly.delete(path);
    if (path === 'fish.population') {
      cfg.fish.population = value;
      cfg.fish.speciesDistribution = clone(mix);
      settleFish(cfg);
      for (const key of SPECIES_KEYS) paint('fish.speciesDistribution.' + key);
      paint('fish.population');
    } else if (path.startsWith('fish.speciesDistribution.')) {
      const key = path.slice('fish.speciesDistribution.'.length);
      mix[key] = value;
      cfg.fish.speciesDistribution[key] = value;
      cfg.fish.population = Object.values(cfg.fish.speciesDistribution).reduce((a, b) => a + b, 0);
      paint(path);
      paint('fish.population');
    } else {
      setPath(cfg, path, value);
      paint(path);
      if (controlKind(path) === 'text') refreshPlaceLabel(path);
    }
    refreshLocks();
    paintSound();
    applyChrome();
    remember();
    onChange(path);
    return true;
  }

  function setDisclosure(item, open) {
    item.querySelector(':scope > button').setAttribute('aria-expanded', String(open));
    item.querySelector(':scope > div').hidden = !open;
  }
  function addDisclosure(parent, title, kind) {
    const item = document.createElement('div');
    item.className = kind;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind + '-toggle';
    button.textContent = title;
    button.setAttribute('aria-expanded', 'false');
    const body = document.createElement('div');
    body.className = kind + '-body';
    body.hidden = true;
    item.append(button, body);
    parent.appendChild(item);
    button.addEventListener('click', () => {
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      for (const sibling of parent.children) {
        if (sibling.classList.contains(kind)) setDisclosure(sibling, sibling === item && willOpen);
      }
    });
    return body;
  }
  function addSlider(parent, path, label, min, max, step) {
    const row = document.createElement('label');
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('output');
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'range', min, max, step, value: getPath(cfg, path) });
    val.textContent = inp.value;
    inp.addEventListener('input', () => commit(path, Number(inp.value)));
    row.append(name, inp, val);
    parent.appendChild(row);
    controls.set(path, { input: inp, output: val, row, kind: 'number' });
  }
  function addToggle(parent, path, label, onText, offText) {
    const row = document.createElement('label');
    row.className = 'toggle';
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('output');
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = getPath(cfg, path);
    val.textContent = inp.checked ? onText : offText;
    inp.addEventListener('change', () => commit(path, inp.checked));
    const choice = document.createElement('span');
    choice.className = 'choice';
    choice.append(inp, val);
    row.append(name, choice);
    parent.appendChild(row);
    controls.set(path, { input: inp, output: val, row, kind: 'bool', onText, offText });
  }
  function addSelect(parent, path, label, options) {
    const row = document.createElement('label');
    row.className = 'select';
    const name = document.createElement('span'); name.textContent = label;
    const inp = document.createElement('select');
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      inp.appendChild(option);
    }
    inp.value = getPath(cfg, path);
    inp.addEventListener('change', () => commit(path, inp.value));
    row.append(name, inp);
    parent.appendChild(row);
    controls.set(path, { input: inp, row, kind: 'select' });
  }
  function addPlace(parent, path, label) {
    const row = document.createElement('div');
    row.className = 'place';
    const name = document.createElement('span');
    name.textContent = label;
    const display = document.createElement('span');
    display.className = 'place-value';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-pick';
    button.textContent = '...';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', `Choose ${label.toLowerCase()}`);
    button.addEventListener('click', () => openPlaceDialog(path));
    let stored = getPath(cfg, path);
    display.textContent = stored;
    display.title = stored;
    Object.defineProperty(button, 'value', {
      configurable: true,
      get() { return stored; },
      set(next) {
        stored = String(next ?? '');
        display.textContent = stored;
        display.title = stored;
      },
    });
    row.append(name, display, button);
    parent.appendChild(row);
    controls.set(path, { input: button, display, row, kind: 'text' });
  }
  function addColor(parent, path, label) {
    const row = document.createElement('label');
    row.className = 'color';
    const name = document.createElement('span'); name.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = getPath(cfg, path);
    inp.addEventListener('input', () => commit(path, inp.value));
    row.append(name, inp);
    parent.appendChild(row);
    controls.set(path, { input: inp, row, kind: 'color' });
  }
  function controlKind(path) {
    const kind = SPEC.get(path)?.[2];
    if (kind === 'toggle') return 'bool';
    if (kind === 'color' || kind === 'select' || kind === 'text') return kind;
    return kind == null ? '' : 'number';
  }
  function addSetting(host, setting) {
    if (setting[2] === 'toggle') addToggle(host, setting[0], setting[1], setting[3], setting[4]);
    else if (setting[2] === 'select') addSelect(host, setting[0], setting[1], setting[3]);
    else if (setting[2] === 'color') addColor(host, setting[0], setting[1]);
    else if (setting[2] === 'text') addPlace(host, setting[0], setting[1]);
    else addSlider(host, ...setting);
  }
  function addGroups(parent, groups, kind) {
    let first = null;
    for (const group of groups || []) {
      const host = group.title ? addDisclosure(parent, group.title, kind) : parent;
      if (group.title && !first) first = host;
      for (const setting of group.settings || []) addSetting(host, setting);
      addGroups(host, group.groups, 'subgroup');
    }
    if (first) setDisclosure(first.parentElement, true);
  }
  function addShortcuts(parent) {
    const wrap = document.createElement('div');
    wrap.className = 'shortcuts';
    const heading = document.createElement('h3');
    heading.textContent = 'Shortcuts';
    const list = document.createElement('dl');
    for (const [key, action] of [
      ['F1', 'Show settings'],
      ['Esc', 'Close settings'],
      ['H', 'Show or hide settings'],
      ['M', 'Turn sound on or off'],
      ['T', 'Show or hide the clock'],
      ['F', 'Show or hide the weather'],
    ]) {
      const term = document.createElement('dt'); term.textContent = key;
      const detail = document.createElement('dd'); detail.textContent = action;
      list.append(term, detail);
    }
    wrap.append(heading, list);
    parent.appendChild(wrap);
  }

  const sectionBodies = [];
  for (const section of SECTIONS) {
    const body = addDisclosure(panelBody, section.title, 'section');
    sectionBodies.push(body);
    addGroups(body, section.groups, 'group');
    if (section.title === 'General') addShortcuts(body);
  }
  setDisclosure(sectionBodies[0].parentElement, true);

  const io = document.createElement('div');
  io.className = 'io';
  const exportBtn = button('Export');
  const importBtn = button('Import');
  const shareBtn = button('Share link');
  const resetBtn = button('Reset to defaults');
  shareUrlInput = document.createElement('input');
  shareUrlInput.type = 'text';
  shareUrlInput.className = 'share-url';
  shareUrlInput.readOnly = true;
  shareUrlInput.hidden = true;
  shareUrlInput.spellcheck = false;
  shareUrlInput.setAttribute('aria-label', 'Share URL');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  io.append(exportBtn, importBtn, shareBtn, resetBtn, shareUrlInput, fileInput);
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  panelBody.append(io, status);

  let statusToken = 0;
  function note(text) {
    status.textContent = text;
    const token = ++statusToken;
    setTimeout(() => { if (token === statusToken) status.textContent = ''; }, 4000);
  }
  function button(text) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    return el;
  }
  function exportSettings() {
    const exported = {};
    for (const path of SPEC.keys()) setPath(exported, path, getPath(cfg, path));
    const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aquarium-settings.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    note('Exported settings');
  }
  function importSettings(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) { note('Settings file must be a JSON object'); return; }
    let count = 0;
    const fish = [];
    for (const path of SPEC.keys()) {
      const raw = Object.hasOwn(data, path) ? data[path] : hasPath(data, path) ? getPath(data, path) : undefined;
      if (raw === undefined) continue;
      const value = coerce(SPEC.get(path), raw);
      if (value === undefined) continue;
      visitOnly.delete(path);
      setPath(cfg, path, value);
      count++;
      if (path.startsWith('fish.')) fish.push(path);
    }
    mix = clone(cfg.fish.speciesDistribution);
    settleFish(cfg);
    for (const path of SPEC.keys()) paint(path);
    refreshPlaceLabels();
    refreshLocks();
    paintSound();
    applyChrome();
    remember();
    for (const path of SPEC.keys()) if (!path.startsWith('fish.')) onChange(path);
    if (fish.length) onChange('fish.population');
    note(count ? `Imported ${count} setting${count === 1 ? '' : 's'}` : 'No recognized settings');
  }
  function resetAll() {
    for (const path of SPEC.keys()) {
      visitOnly.delete(path);
      setPath(cfg, path, getPath(DEFAULT_CONFIG, path));
    }
    mix = clone(cfg.fish.speciesDistribution);
    for (const path of SPEC.keys()) paint(path);
    refreshPlaceLabels();
    refreshLocks();
    paintSound();
    applyChrome();
    remember();
    for (const path of SPEC.keys()) onChange(path);
    note('Reset to defaults');
  }

  exportBtn.addEventListener('click', exportSettings);
  importBtn.addEventListener('click', () => fileInput.click());
  shareBtn.addEventListener('click', async () => {
    shareUrlInput.hidden = false;
    shareUrlInput.value = shareUrl();
    shareUrlInput.focus();
    shareUrlInput.select();
    try { await navigator.clipboard.writeText(shareUrlInput.value); note('Share link copied'); }
    catch { note('Share link selected'); }
  });
  shareUrlInput.addEventListener('focus', () => shareUrlInput.select());
  resetBtn.addEventListener('click', resetAll);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try { importSettings(JSON.parse(await file.text())); }
    catch { note('Could not read that settings file'); }
    finally { fileInput.value = ''; }
  });

  document.getElementById('sound').addEventListener('click', (event) => {
    event.stopPropagation();
    commit('audio.enabled', !cfg.audio.enabled);
  });

  const placeDialog = document.createElement('div');
  placeDialog.className = 'place-dialog';
  placeDialog.hidden = true;
  const placeSheet = document.createElement('div');
  placeSheet.className = 'sheet';
  placeSheet.setAttribute('role', 'dialog');
  placeSheet.setAttribute('aria-modal', 'true');
  const placeTitle = document.createElement('h2');
  placeTitle.id = 'place-dialog-title';
  placeTitle.textContent = 'Weather location';
  placeSheet.setAttribute('aria-labelledby', placeTitle.id);
  const placeInput = document.createElement('input');
  placeInput.type = 'text';
  placeInput.maxLength = 80;
  placeInput.spellcheck = false;
  placeInput.autocomplete = 'off';
  placeInput.placeholder = 'Toledo';
  placeInput.setAttribute('aria-label', 'Location search');
  const placeChoices = document.createElement('div');
  placeChoices.className = 'choices';
  placeChoices.setAttribute('role', 'listbox');
  const placeHintLine = document.createElement('p');
  placeHintLine.className = 'hint';
  const placeCancel = document.createElement('button');
  placeCancel.type = 'button';
  placeCancel.textContent = 'Cancel';
  const placeActions = document.createElement('div');
  placeActions.className = 'actions';
  placeActions.append(placeCancel);
  const placeSearch = document.createElement('div');
  placeSearch.className = 'search';
  placeSearch.append(placeInput, placeChoices, placeHintLine, placeActions);
  placeSheet.append(placeTitle, placeSearch);
  placeDialog.append(placeSheet);
  document.body.append(placeDialog);

  let placeDialogPath = '';
  let suggestToken = 0;
  let suggestTimer = 0;

  async function refreshPlaceLabel(path) {
    const control = controls.get(path);
    if (!control?.display) return;
    const query = getPath(cfg, path);
    try {
      const place = await resolvePlace(query);
      if (getPath(cfg, path) !== query) return;
      control.display.textContent = place.name || query;
      control.display.title = place.name || query;
    } catch {
      if (getPath(cfg, path) !== query) return;
      control.display.textContent = query;
      control.display.title = query;
    }
  }
  function refreshPlaceLabels() {
    for (const path of SPEC.keys()) if (controlKind(path) === 'text') refreshPlaceLabel(path);
  }
  function closePlaceDialog() {
    if (placeDialog.hidden) return false;
    placeDialog.hidden = true;
    suggestToken += 1;
    const opener = controls.get(placeDialogPath)?.input;
    if (opener) opener.focus();
    return true;
  }
  function selectedChoice() {
    return placeChoices.querySelector('.place-choice[aria-selected="true"]');
  }
  function selectChoice(choiceButton) {
    for (const choice of placeChoices.querySelectorAll('.place-choice')) {
      choice.setAttribute('aria-selected', choice === choiceButton ? 'true' : 'false');
    }
    choiceButton?.scrollIntoView({ block: 'nearest' });
  }
  function chooseListedPlace(choiceButton) {
    const choice = choiceButton?.placeChoice;
    if (!choice || !placeDialogPath) return;
    rememberChoice(choice);
    if (!commit(placeDialogPath, choice.value)) {
      note('That place could not be saved');
      return;
    }
    closePlaceDialog();
  }
  function renderPlaceChoices(choices) {
    placeChoices.replaceChildren();
    for (const choice of choices) {
      const choiceButton = document.createElement('button');
      choiceButton.type = 'button';
      choiceButton.className = 'place-choice';
      choiceButton.setAttribute('role', 'option');
      choiceButton.textContent = choice.label;
      choiceButton.placeChoice = choice;
      choiceButton.addEventListener('click', () => chooseListedPlace(choiceButton));
      placeChoices.append(choiceButton);
    }
    selectChoice(placeChoices.querySelector('.place-choice'));
  }
  async function searchPlaceDialog() {
    const query = placeInput.value.trim();
    const token = ++suggestToken;
    if (query.length < 2) {
      placeChoices.replaceChildren();
      placeHintLine.textContent = 'Type a city, such as Toledo';
      return;
    }
    placeHintLine.textContent = 'Searching…';
    placeChoices.replaceChildren();
    try {
      const choices = await suggestPlaces(query);
      if (token !== suggestToken || placeDialog.hidden) return;
      renderPlaceChoices(choices);
      placeHintLine.textContent = choices.length ? 'Choose a place' : 'No matching places';
    } catch (error) {
      if (token !== suggestToken || placeDialog.hidden) return;
      placeChoices.replaceChildren();
      placeHintLine.textContent = error.message || 'Could not search for that place';
    }
  }
  function openPlaceDialog(path) {
    placeDialogPath = path;
    const shown = controls.get(path)?.display?.textContent || getPath(cfg, path);
    placeInput.value = shown;
    placeChoices.replaceChildren();
    placeHintLine.textContent = shown.trim().length < 2 ? 'Type a city, such as Toledo' : 'Searching…';
    placeDialog.hidden = false;
    placeInput.focus();
    placeInput.select();
    searchPlaceDialog();
  }
  placeInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(searchPlaceDialog, 250);
  });
  placeInput.addEventListener('keydown', (event) => {
    const buttons = [...placeChoices.querySelectorAll('.place-choice')];
    const current = buttons.indexOf(selectedChoice());
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!buttons.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      selectChoice(buttons[(current + step + buttons.length) % buttons.length]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseListedPlace(selectedChoice() || buttons[0]);
    }
  });
  placeCancel.addEventListener('click', closePlaceDialog);
  placeDialog.addEventListener('click', (event) => {
    if (event.target === placeDialog) closePlaceDialog();
  });

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const field = event.target instanceof Element && event.target.closest('input, textarea, select');
    if (event.code === 'Escape' && closePlaceDialog()) return;
    if (event.code === 'Escape') setPanelOpen(false);
    if (event.code === 'F1') { event.preventDefault(); setPanelOpen(true); }
    if (field || event.ctrlKey || event.metaKey || event.altKey || !placeDialog.hidden) return;
    if (event.code === 'KeyH') togglePanel();
    if (event.code === 'KeyM') commit('audio.enabled', !cfg.audio.enabled);
    if (event.code === 'KeyT') commit('clock.enabled', !cfg.clock.enabled);
    if (event.code === 'KeyF') commit('weather.enabled', !cfg.weather.enabled);
  });

  refreshLocks();
  paintSound();
  applyChrome();
  refreshPlaceLabels();
  return { note, openPlace: openPlaceDialog };
}
