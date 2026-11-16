// Static checks run by CI and before every GitHub Pages deploy (no browser or GPU needed).
//   node tools/validate.mjs           check the sources, the standalone bundles and the README
//   node tools/validate.mjs _site     also check an assembled Pages site
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = process.argv[2] ? path.resolve(root, process.argv[2]) : null;
const PAGES = 'https://jfayling.github.io/fayling-web-fishtank-pictureframe/';
const problems = [];
const ok = [];
const check = (cond, good, bad) => (cond ? ok.push(good) : problems.push(bad));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function parses(source, label) {
  const file = path.join(os.tmpdir(), `fishtank-validate-${process.pid}.mjs`);
  fs.writeFileSync(file, source);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  fs.unlinkSync(file);
  check(r.status === 0, `${label}: script parses`, `${label}: script does not parse\n${r.stderr}`);
}

// ---- standalone bundles -------------------------------------------------------------------
for (const name of ['aquarium.html', 'aquarium.min.html']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) { problems.push(`${name} is missing; run npm run build`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  check(!/<script[^>]+src=/i.test(html), `${name}: no external scripts`, `${name}: still loads an external script`);
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  check(scripts.length === 1, `${name}: one inline module`, `${name}: expected one inline module script, found ${scripts.length}`);
  if (scripts.length) parses(scripts[0][1], name);
  check(html.includes('id="c"') && html.includes('navigator.gpu'), `${name}: canvas and WebGPU entry present`, `${name}: canvas or WebGPU entry missing`);
  const local = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"/g)].map((m) => m[1]);
  for (const ref of local) check(fs.existsSync(path.join(root, ref)), `${name}: ${ref} exists`, `${name}: references missing file ${ref}`);
}
const music = read('js/music.js').match(/new Audio\('([^']+)'\)/);
check(music && fs.existsSync(path.join(root, music[1])), 'music file present', 'js/music.js points at a missing file');

// ---- sharing metadata ----------------------------------------------------------------------
const index = read('index.html');
const meta = (attr, key) => (index.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`)) || [])[1];
for (const [attr, key] of [['name', 'description'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:image'],
  ['property', 'og:url'], ['name', 'twitter:card'], ['name', 'twitter:image']]) {
  check(!!meta(attr, key), `meta ${key}`, `index.html is missing <meta ${attr}="${key}">`);
}
check(index.includes(`<link rel="canonical" href="${PAGES}">`), 'canonical URL', 'index.html canonical URL is missing or wrong');
for (const key of ['og:image', 'twitter:image']) {
  const url = meta(key.startsWith('og') ? 'property' : 'name', key) || '';
  const rel = url.startsWith(PAGES) ? url.slice(PAGES.length) : null;
  check(rel && fs.existsSync(path.join(root, rel)), `${key} resolves to ${rel}`, `${key} (${url}) does not map to a file deployed to Pages`);
}

// ---- README links --------------------------------------------------------------------------
const readme = read('README.md');
const links = [...readme.matchAll(/\]\(([^)\s]+)\)|<img[^>]+src="([^"]+)"/g)].map((m) => m[1] || m[2]);
for (const link of links) {
  if (/^(https?:|mailto:|#)/.test(link)) continue;
  const target = decodeURIComponent(link.split('#')[0]);
  check(fs.existsSync(path.join(root, target)), `README: ${target}`, `README links to missing file ${target}`);
}

// ---- assembled Pages site ------------------------------------------------------------------
if (site) {
  for (const f of ['index.html', 'aquarium.html', 'aquarium.min.html', '.nojekyll', 'media/track001.mp3',
    'docs/social-preview.png', 'docs/hero.png', 'docs/preview.gif']) {
    check(fs.existsSync(path.join(site, f)), `site: ${f}`, `Pages site is missing ${f}`);
  }
  const page = fs.existsSync(path.join(site, 'index.html')) ? fs.readFileSync(path.join(site, 'index.html'), 'utf8') : '';
  check(page === read('aquarium.min.html'), 'site: index.html is the standalone build', 'site index.html is not aquarium.min.html');
}

console.log(`${ok.length} checks passed`);
if (problems.length) {
  console.error(problems.map((p) => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
