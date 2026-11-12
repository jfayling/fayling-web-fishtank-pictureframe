// Optional ambient sound (audio.enabled): what you hear standing beside a tank —
// soft airstone hiss and surface bubble pops. No underwater rumble. All synthesised.
// Browsers only start audio after a user gesture, so playback begins on the first
// click or key press. Layer levels and tone come from cfg.audio and can change live.
import { clamp, lerp } from './math.js';

const DEFAULTS = {
  enabled: false,
  volume: 0.35,
  hissEnabled: false,
  hissVolume: 1,
  hissTone: 0.5,
  bubblesEnabled: true,
  bubbleVolume: 1,
  bubbleRate: 1,
  bubblePitch: 0.5,
  bubblePlink: 0.35,
};

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function createAquariumAudio(initial = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ac = new Ctx();
  const master = ac.createGain();
  master.connect(ac.destination);

  const params = { ...DEFAULTS };

  // Shared noise buffer (pink-ish) for the continuous hiss and discrete pops.
  const len = Math.floor(ac.sampleRate * 2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + 0.029 * w;
    b1 = 0.99 * b1 + 0.02 * w;
    b2 = 0.96 * b2 + 0.08 * w;
    data[i] = (b0 * 0.55 + b1 * 0.3 + b2 * 0.15) * 2.2;
  }

  function noiseSource() {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  // Soft airstone / filter-return hiss. Two bands, no low end.
  const hissBus = ac.createGain();
  hissBus.connect(master);

  const fizz = noiseSource();
  const fizzBp = ac.createBiquadFilter();
  fizzBp.type = 'bandpass';
  fizzBp.Q.value = 0.65;
  const fizzHp = ac.createBiquadFilter();
  fizzHp.type = 'highpass';
  const fizzGain = ac.createGain();
  fizz.connect(fizzHp).connect(fizzBp).connect(fizzGain).connect(hissBus);
  fizz.start();

  const fizz2 = noiseSource();
  const fizz2Bp = ac.createBiquadFilter();
  fizz2Bp.type = 'bandpass';
  fizz2Bp.Q.value = 0.9;
  const fizz2Gain = ac.createGain();
  fizz2.connect(fizz2Bp).connect(fizz2Gain).connect(hissBus);
  fizz2.start();

  const bubbleBus = ac.createGain();
  bubbleBus.connect(master);

  function read(cfg) {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'enabled' || key.endsWith('Enabled')) params[key] = src[key] !== undefined ? !!src[key] : params[key];
      else if (src[key] !== undefined) params[key] = num(src[key], params[key]);
    }
    params.hissVolume = clamp(params.hissVolume, 0, 2);
    params.hissTone = clamp(params.hissTone, 0, 1);
    params.bubbleVolume = clamp(params.bubbleVolume, 0, 2);
    params.bubbleRate = clamp(params.bubbleRate, 0, 3);
    params.bubblePitch = clamp(params.bubblePitch, 0, 1);
    params.bubblePlink = clamp(params.bubblePlink, 0, 1);
    params.volume = clamp(params.volume, 0, 1);
  }

  function shapeHiss(t) {
    const tone = params.hissTone;
    const flutter = Math.sin(t * 0.17);
    fizzBp.frequency.value = lerp(1200, 3200, tone) + lerp(180, 520, tone) * flutter;
    fizzHp.frequency.value = lerp(400, 1400, tone);
    fizz2Bp.frequency.value = lerp(1800, 5000, tone) + 180 * Math.sin(t * 0.11);
    fizzGain.gain.value = 0.055 + 0.025 * (0.5 + 0.5 * Math.sin(t * 0.31));
    fizz2Gain.gain.value = 0.025 + 0.015 * (0.5 + 0.5 * Math.sin(t * 0.23 + 1.2));
    hissBus.gain.value = params.hissEnabled ? params.hissVolume : 0;
  }

  // Surface bubble pop: a short noise burst (wet "plip"), sometimes a glassy ring.
  function pop() {
    const t = ac.currentTime;
    const pitch = params.bubblePitch;
    const dur = (0.028 + Math.random() * 0.05) * lerp(1.7, 0.75, pitch);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = lerp(400, 2400, pitch) + Math.random() * lerp(800, 4800, pitch);
    bp.Q.value = 1.2 + Math.random() * 2.5;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = lerp(280, 1200, pitch);
    const g = ac.createGain();
    const peak = 0.045 + Math.random() * 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    src.connect(hp).connect(bp).connect(g).connect(bubbleBus);
    src.start(t);
    src.stop(t + dur + 0.02);

    if (Math.random() < params.bubblePlink) {
      const o = ac.createOscillator();
      const og = ac.createGain();
      const f0 = lerp(400, 1400, pitch) + Math.random() * lerp(400, 2800, pitch);
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(90, f0 * lerp(0.5, 0.72, pitch)), t + dur);
      const ping = 0.012 + Math.random() * 0.018;
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(ping, t + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0003, t + dur * 0.9);
      o.connect(og).connect(bubbleBus);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  let nextPop = 0.4;
  let burstLeft = 0;

  const api = {
    resume() { if (ac.state !== 'running') ac.resume(); },
    apply(cfg) {
      read(cfg);
      master.gain.value = params.enabled ? params.volume : 0;
      shapeHiss(ac.currentTime);
      bubbleBus.gain.value = params.bubblesEnabled ? params.bubbleVolume : 0;
      if (params.enabled) api.resume();
    },
    update(dt) {
      if (ac.state !== 'running' || !params.enabled || params.volume <= 0) return;
      shapeHiss(ac.currentTime);
      bubbleBus.gain.value = params.bubblesEnabled ? params.bubbleVolume : 0;

      if (!params.bubblesEnabled || params.bubbleVolume <= 0 || params.bubbleRate <= 0) {
        nextPop = 0.25;
        burstLeft = 0;
        return;
      }
      nextPop -= dt;
      if (nextPop > 0) return;
      pop();
      const rate = params.bubbleRate;
      if (burstLeft > 0) {
        burstLeft--;
        nextPop = (0.04 + Math.random() * 0.1) / rate;
      } else if (Math.random() < Math.min(0.85, 0.2 + 0.25 * rate)) {
        burstLeft = 2 + Math.floor(Math.random() * 6);
        nextPop = (0.05 + Math.random() * 0.1) / rate;
      } else {
        nextPop = (0.15 + Math.random() * 0.55) / rate;
      }
    },
  };

  read(initial);
  master.gain.value = params.enabled ? params.volume : 0;
  shapeHiss(0);
  bubbleBus.gain.value = params.bubblesEnabled ? params.bubbleVolume : 0;
  return api;
}
