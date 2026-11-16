// Builds the README and social images from frames captured with tools/capture.mjs.
// Only resizes, crops and encodes real frames; nothing is painted in except the social
// preview's title strip.
//
//   npm install --no-save sharp gifenc
//   node tools/capture.mjs hero.png --frames 600 --query "&clock.enabled=false&weather.enabled=false"
//   node tools/capture.mjs anim.png --frames 540 --seq 120 --step 3 --query "&clock.enabled=false&weather.enabled=false"
//   node tools/capture.mjs lineup.png --frames 240 --query "&view=lineup&clock.enabled=false&weather.enabled=false"
//   node tools/capture.mjs scene-lagoon.png --frames 900 --query "&clock.enabled=false&weather.enabled=false&scene=lagoon"   (and the other scenes)
//   node tools/make-previews.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'shots');
const docs = path.join(root, 'docs');
fs.mkdirSync(docs, { recursive: true });
const shot = (name) => path.join(shots, name);
const report = (file) => console.log(path.relative(root, file).padEnd(28), (fs.statSync(file).size / 1024).toFixed(0).padStart(6), 'KB');

// hero: the default Day reef scene, full frame
const heroSrc = process.env.HERO || 'hero.png';
{
  const out = path.join(docs, 'hero.png');
  await sharp(shot(heroSrc)).resize(1600, 900).png({ palette: true, quality: 92, effort: 10, dither: 0.6 }).toFile(out);
  report(out);
}

// scene gallery
const scenes = ['reef', 'lagoon', 'morning', 'sunset', 'moonlight', 'deep'];
for (const id of scenes) {
  const src = id === 'reef' ? shot(heroSrc) : shot(`scene-${id}.png`);
  if (!fs.existsSync(src)) { console.log('skip scene', id); continue; }
  const out = path.join(docs, `scene-${id}.jpg`);
  await sharp(src).resize(800, 450).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  report(out);
}

// every species side by side (?view=lineup)
if (fs.existsSync(shot('lineup.png'))) {
  const out = path.join(docs, 'species-lineup.jpg');
  await sharp(shot('lineup.png')).resize(1200, 675).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
  report(out);
}

// social preview, 1280x640 (GitHub's recommended size), with a title strip
{
  const out = path.join(docs, 'social-preview.png');
  const base = await sharp(shot(heroSrc)).extract({ left: 0, top: 60, width: 1920, height: 960 }).resize(1280, 640).toBuffer();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#03121b" stop-opacity="0.78"/><stop offset="1" stop-color="#03121b" stop-opacity="0"/>
    </linearGradient></defs>
    <rect width="1280" height="190" fill="url(#g)"/>
    <text x="56" y="86" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="52" font-weight="300" letter-spacing="3" fill="#f7f4ee">REEF AQUARIUM</text>
    <text x="58" y="128" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#d9eef5" fill-opacity="0.9">Real-time procedural fish tank in raw WebGPU · no game engine</text>
  </svg>`);
  await sharp(base).composite([{ input: svg }]).png({ palette: true, quality: 90, effort: 10 }).toFile(out);
  report(out);
}

// animated preview: a crop of the busiest part of the frame, real-time speed
{
  const skip = Number(process.env.GIF_SKIP || 2);
  const frames = fs.readdirSync(shots).filter((f) => /^anim-\d{4}\.png$/.test(f)).sort().filter((_, i) => i % skip === 0);
  if (!frames.length) throw new Error('no anim-*.png frames in shots/');
  const W = Number(process.env.GIF_W || 640), H = Math.round(W * 9 / 16);
  const crop = { left: 480, top: 270, width: 1440, height: 810 };
  const delay = 50 * skip; // frames were captured 3 sim steps (50 ms) apart, so playback is real time
  const raw = [];
  for (const f of frames) {
    raw.push(await sharp(shot(f)).extract(crop).resize(W, H).ensureAlpha().raw().toBuffer());
  }
  // One palette from a sample of frames keeps the water from flickering between frames.
  // Entry 255 is reserved as transparent: a pixel within `still` of what is already on screen
  // is left as is, so the encoder only stores what moved (fish, sway, particles, caustics).
  const still = Number(process.env.GIF_STILL || 20);
  const sample = Buffer.concat(raw.filter((_, i) => i % Math.ceil(raw.length / 8) === 0));
  const palette = quantize(new Uint8Array(sample.buffer, sample.byteOffset, sample.length), 255, { format: 'rgb565' });
  while (palette.length < 255) palette.push([0, 0, 0]);
  palette.push([0, 0, 0]);
  const clear = 255;
  const shown = new Int16Array(W * H * 3).fill(-1000);
  const gif = GIFEncoder();
  raw.forEach((buf, i) => {
    const index = applyPalette(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), palette.slice(0, 255), 'rgb565');
    for (let p = 0; p < W * H; p++) {
      const c = palette[index[p]];
      const s = p * 3;
      const d = Math.abs(c[0] - shown[s]) + Math.abs(c[1] - shown[s + 1]) + Math.abs(c[2] - shown[s + 2]);
      if (d < still) index[p] = clear;
      else { shown[s] = c[0]; shown[s + 1] = c[1]; shown[s + 2] = c[2]; }
    }
    gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay, repeat: i === 0 ? 0 : undefined,
      transparent: true, transparentIndex: clear, dispose: 1 });
  });
  gif.finish();
  const out = path.join(docs, 'preview.gif');
  fs.writeFileSync(out, gif.bytes());
  report(out);
  console.log(`preview.gif: ${frames.length} frames, ${W}x${H}, ${(frames.length * delay / 1000).toFixed(1)} s`);
}
