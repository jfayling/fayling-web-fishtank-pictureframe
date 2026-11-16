// Renders frames of the running aquarium in headless Chrome and saves them under shots/.
// Uses the page's own ?shot mode: a fixed 1/60 s step, read back from the swap chain, so the
// pictures are exactly what the renderer draws (no DOM overlays).
//
//   node tools/capture.mjs <name.png> [--frames 600] [--seq 1] [--step 1] [--w 1920] [--h 1080]
//                          [--query "&scene=lagoon"] [--page aquarium.html] [--timeout 180]
//
// --seq K --step S saves K frames S frames apart as name-0000.png, name-0001.png, ...
// Chrome is found through CHROME_PATH or the usual install locations; it needs a GPU.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) || 'shot.png';
const opt = (key, fallback) => {
  const i = args.indexOf('--' + key);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const frames = Number(opt('frames', 600));
const seq = Number(opt('seq', 1));
const step = Number(opt('step', 1));
const w = Number(opt('w', 1920)), h = Number(opt('h', 1080));
const query = opt('query', '');
const page = opt('page', '');
const timeout = Number(opt('timeout', 180)) * 1000;
const port = Number(opt('port', 8090));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('Chrome not found; set CHROME_PATH');
  process.exit(1);
}

const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const expected = seq > 1
  ? Array.from({ length: seq }, (_, i) => name.replace(/(\.png)?$/i, `-${String(i).padStart(4, '0')}.png`))
  : [name];
for (const f of expected) fs.rmSync(path.join(shots, f), { force: true });

const server = spawn(process.execPath, [path.join(root, 'server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.on('data', (d) => {
  const text = String(d);
  if (/FATAL|error|failed|lost|gpu|fish:|reef built/i.test(text)) process.stdout.write(text);
});
await new Promise((resolve) => setTimeout(resolve, 600));

const url = `http://localhost:${port}/${page}?shot=${encodeURIComponent(name)}&frames=${frames}&seq=${seq}&step=${step}&w=${w}&h=${h}${query}`;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist',
  `--user-data-dir=${userDir}`, `--window-size=${w},${h}`, '--no-first-run', '--mute-audio', url,
], { stdio: 'ignore' });

const start = Date.now();
const done = () => expected.every((f) => fs.existsSync(path.join(shots, f)));
while (!done() && Date.now() - start < timeout) await new Promise((resolve) => setTimeout(resolve, 500));
await new Promise((resolve) => setTimeout(resolve, 500));
chrome.kill();
server.kill();
setTimeout(() => fs.rmSync(userDir, { recursive: true, force: true }), 1500);

const saved = expected.filter((f) => fs.existsSync(path.join(shots, f))).length;
console.log(`${saved}/${expected.length} frames saved in ${((Date.now() - start) / 1000).toFixed(1)} s  (${url})`);
process.exitCode = saved === expected.length ? 0 : 1;
