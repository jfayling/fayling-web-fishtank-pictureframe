// Assembles the static GitHub Pages site in _site/ from a fresh build.
// The root page is the self-contained aquarium.min.html, so the live demo is exactly the
// standalone file people can download; media/ and docs/ sit next to it at the same
// relative paths the page and the social metadata use.
//   npm run build && node tools/assemble-site.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to = from) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(out, to));
};
copy('aquarium.min.html', 'index.html');
copy('aquarium.html');
copy('aquarium.min.html');
for (const f of fs.readdirSync(path.join(root, 'media'))) copy(`media/${f}`);
for (const f of fs.readdirSync(path.join(root, 'docs'))) if (/\.(png|jpe?g|gif|webp)$/i.test(f)) copy(`docs/${f}`);
copy('LICENSE');
fs.writeFileSync(path.join(out, '.nojekyll'), '');

let bytes = 0, files = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else { bytes += fs.statSync(p).size; files++; }
});
walk(out);
console.log(`assembled ${path.relative(root, out)}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
