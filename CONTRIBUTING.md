# Contributing

Thanks for helping the reef grow. This project is raw WebGPU and plain JavaScript modules with
no framework and no runtime dependencies, and contributions should keep it that way.

## Getting set up

```sh
npm ci
npm start                 # http://localhost:8080
```

You need a [WebGPU browser](docs/BROWSER_SUPPORT.md). Useful URL options while developing:

| Option | Use |
| --- | --- |
| `?info=1` | Frame rate, render size, render scale and GPU time |
| `?view=lineup` | Every species side by side, slowly turning |
| `?scene=<id>` | Jump to `reef`, `lagoon`, `morning`, `sunset`, `moonlight` or `deep` |
| `?cam=x,y,z,tx,ty,tz` | Override the camera |
| `?t=<seconds>` | Start the clock at a given time |
| `?log=1` | Mirror console logs to the dev server terminal |

## Where things live

See [How it works](README.md#webgpu-technical-architecture) in the README. In short:

- `js/species.js`: anatomy, swimming style and behavior parameters per species
- `js/behavior.js`: the simulation (state machine, steering, collisions)
- `js/reef.js`: rock formations, coral placement, the obstacle field
- `js/coral-mesh.js`, `js/fish-mesh.js`: procedural geometry
- `js/wgsl/*`: shaders, as JS template strings
- `js/main.js`: WebGPU setup and the frame loop

## Ground rules

- **No new runtime dependencies or rendering libraries.** Dev-only tooling is fine when it is
  optional (see `tools/make-previews.mjs`).
- **Keep the single-file build working.** `npm run build` must succeed, and the bundled page
  must work from `file://`. All modules share one scope in the bundle, so top-level names must
  be unique across modules. The build checks this.
- **Commit the rebuilt bundles.** Run `npm run build` and commit `aquarium.html` and
  `aquarium.min.html` with your change. CI fails if they are stale.
- **No per-frame allocations** in the simulation or render loop.
- **Keep it calm.** This is meant to run unattended on a wall for days. Avoid flashing, sudden
  motion, or anything that needs interaction.
- Match the existing code style: small focused modules, comments that explain *why*, and
  config values in `js/config.js` instead of magic numbers in the simulation.

## Checking your change

```sh
npm run build
npm run validate          # bundles parse, metadata, README links
npm run site              # also assembles and checks the GitHub Pages site
```

For visual changes, include before and after screenshots in the pull request. With a GPU and
Chrome installed:

```sh
node tools/capture.mjs before.png --frames 600 --query "&clock.enabled=false&weather.enabled=false"
```

Captures are deterministic for a given seed, frame count and size, so the same command before
and after your change shows exactly what changed. Screenshots land in `shots/`, which is
ignored by git.

If you change performance-sensitive code, report `?info=1` numbers (FPS and GPU ms) with
your GPU, browser and resolution.

## Ideas that would make great contributions

None of these exist yet:

- **Additional fish species:** wrasses, gobies, a mandarin dragonet, a seahorse, a cleaner
  shrimp. A new species needs an entry in `js/species.js` (anatomy, `anim` style, behavior
  weights), a color pattern in `js/wgsl/fish.js`, and a share in
  `fish.speciesDistribution`.
- **New reef formations:** a new `FORMATIONS` entry in `js/reef.js` (massifs, blobs, tunnels,
  coral mix) and a scene in `js/scenes.js`.
- **Improved fish behaviors:** feeding, cleaning stations, territorial chases, night roosting,
  reactions to the moray.
- **Rendering optimizations:** cheaper shadow updates, GPU-side simulation, better scaling on
  integrated and mobile GPUs.
- **Accessibility:** a reduced-motion mode, better keyboard and screen-reader support in the
  settings panel, higher-contrast overlays.

For anything large, please open a feature request first so we can agree on the approach.

## Reporting bugs

Use the [bug report form](https://github.com/jfayling/fayling-web-fishtank-pictureframe/issues/new?template=bug_report.yml).
Include the browser, OS and GPU (from `chrome://gpu` or `?info=1`) and any console errors.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE). Only contribute code and assets you have the right to license that
way, and say where any third-party code or asset comes from.
