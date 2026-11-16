# Building and deploying

The aquarium has no runtime dependencies. Node.js (18 or newer) is only needed to bundle the
standalone files and to run the dev server.

## Development

```sh
npm ci
npm start                 # http://localhost:8080, serves index.html and the ES modules in js/
node server.mjs 9000      # another port
```

Edit any file in `js/` and reload; nothing has to be rebuilt while developing.

## Standalone files

```sh
npm run build
```

| File | Contents |
| --- | --- |
| `aquarium.html` | Readable bundle: `index.html` with every module inlined in one `<script type="module">` |
| `aquarium.min.html` | Minified bundle: WGSL comments and whitespace stripped, JS minified with esbuild |

Both open straight from disk (`file://`) in a WebGPU browser and need no server. The only
file they load at run time is `media/track001.mp3`, for the optional background music. Keep the
`media/` folder next to the HTML file to have music; without it the aquarium runs silently.

The build checks that the combined script parses. Every module shares one scope in the bundle,
so two modules declaring the same top-level name would break the page. Sources are read with
LF line endings, so the output is byte-identical on Windows, macOS and Linux. CI rebuilds the
bundles and fails if the committed copies are stale, so **commit `aquarium.html` and
`aquarium.min.html` together with source changes**.

## Validation

```sh
npm run validate          # bundles, sharing metadata, README links
npm run site              # build + assemble _site/ + validate the assembled Pages site
```

## GitHub Pages

`.github/workflows/pages.yml` deploys on every push to `main` (and on manual dispatch):

1. `npm ci` and `npm run build`
2. fail if the committed standalone bundles differ from the fresh build
3. `node tools/assemble-site.mjs _site`: `aquarium.min.html` becomes `index.html`, next to
   `aquarium.html`, `aquarium.min.html`, `media/`, the images in `docs/` and `LICENSE`
4. `node tools/validate.mjs _site`
5. upload and deploy with `actions/deploy-pages`

The live site is the same single file people download, so whatever works on Pages works from
disk. GitHub Pages serves over HTTPS, which WebGPU requires (except on `localhost` and
`file://`).

**One-time setting:** in the repository, open **Settings → Pages → Build and deployment** and
set **Source** to **GitHub Actions**. Or use the CLI:

```sh
gh api -X POST repos/jfayling/fayling-web-fishtank-pictureframe/pages -f build_type=workflow
```

## Screenshots and the README previews

`tools/capture.mjs` renders frames in headless Chrome through the dev server, using the page's
own `?shot=` mode. That mode runs a fixed 1/60 s step and reads the frame back from the swap
chain, so the images are exactly what the renderer draws, without DOM overlays. It needs a
machine with a GPU.

```sh
node tools/capture.mjs reef.png --frames 600
node tools/capture.mjs fish.png --query "&view=lineup"
node tools/capture.mjs anim.png --frames 540 --seq 120 --step 3     # anim-0000.png ... anim-0119.png
```

`tools/make-previews.mjs` turns captured frames into `docs/hero.png`, `docs/preview.gif`,
`docs/social-preview.png`, the scene thumbnails and the species lineup. Its header lists the
exact capture commands. It needs two image libraries that are deliberately not dependencies of
the project:

```sh
npm install --no-save sharp gifenc
node tools/make-previews.mjs
```

`shot.ps1` is the original Windows-only helper and still works:
`.\shot.ps1 reef.png -frames 600` (with `node server.mjs 8090` running).
