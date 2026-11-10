// Optional ambient sound (audio.enabled): a low filtered water hum and sparse bubble
// "blips", all synthesised. Browsers only start audio after a user gesture, so playback
// begins on the first click or key press.
export function createAquariumAudio(volume = 0.35) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ac = new Ctx();
  const master = ac.createGain();
  master.gain.value = volume;
  master.connect(ac.destination);

  // two seconds of brown noise, looped
  const len = ac.sampleRate * 2;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { b = (b + (Math.random() * 2 - 1) * 0.02) * 0.998; d[i] = b * 3.5; }
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 380;
  const humGain = ac.createGain();
  humGain.gain.value = 0.5;
  noise.connect(low).connect(humGain).connect(master);
  noise.start();

  let nextBlip = 2;
  function blip() {
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    const f0 = 500 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random()), t + 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }
  return {
    resume() { if (ac.state !== 'running') ac.resume(); },
    update(dt) {
      if (ac.state !== 'running') return;
      humGain.gain.value = 0.45 + 0.08 * Math.sin(ac.currentTime * 0.07);
      nextBlip -= dt;
      if (nextBlip <= 0) {
        blip();
        nextBlip = Math.random() < 0.3 ? 0.08 + Math.random() * 0.2 : 1.5 + Math.random() * 6;
      }
    },
  };
}
