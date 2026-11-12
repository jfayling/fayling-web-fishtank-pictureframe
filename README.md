# fayling-web-fishtank-pictureframe

A full-screen, real-time saltwater reef aquarium for a wall display, in the spirit of Roku's
Aquatic Life screensaver. A fixed camera looks through the front glass of a 3D reef tank:
live rock with caves and overhangs, ten kinds of coral, and twelve species of reef fish
that each decide where to go, school, shelter, rest and avoid each other on their own. It
runs unattended indefinitely, with no menus, overlays or loops.

Raw WebGPU, no runtime dependencies. Everything (rock, corals, fish, textures) is generated
procedurally at start-up. The structure follows
[fayling-web-ocean-pictureframe](../fayling-web-ocean-pictureframe).

## Running

```
npm start                 # dev server on http://localhost:8080
npm run build             # aquarium.html and aquarium.min.html (single files)
```

`aquarium.html` / `aquarium.min.html` are self-contained and can be opened straight from
disk in a WebGPU browser (Chrome or Edge 113+). The page goes fullscreen on the first click
or key press and hides the cursor when the mouse is idle.

## Configuration

All tunables live in `js/config.js` (`DEFAULT_CONFIG`): display (size, target FPS, adaptive
resolution), environment (water colour, clarity, ambient light, caustics, current, light
rays, bloom, exposure), fish (population, speed, schooling, collision avoidance, species
distribution), effects (bubbles, particles, rays, coral sway, particle count), camera
(optional slow pan, field of view), audio (off by default; master, hiss, and bubble
layers) and optional per-species models.
The simulation and renderer only read this object.

Any key can be overridden from the URL, for example
`?fish.population=50&effects.bubblesEnabled=false&environment.waterClarity=0.7`, or a whole
JSON document can be passed as `?config=<base64url JSON>`. The population is distributed
across species in proportion to `speciesDistribution` (at most one moray).

The on-screen settings panel follows the ocean picture frame: a dim **Settings** button
(F1 or H), sections for the tank, fish, effects, camera and sound, and Export, Import,
Share link and Reset. Changes apply immediately and are remembered in this browser. Sound
toggles with the toolbar button or M, and Esc closes the panel. `?info=1` shows the
frame-rate readout for that visit.

Development options: `?info=1` (frame-rate readout), `?view=lineup` (every species side by
side), `?cam=x,y,z,tx,ty,tz` (camera override), `?t=seconds`, `?w=&h=` (forced size).

## How it works

| Module | Role |
| --- | --- |
| `js/reef.js` | Live rock as a metaball density field with domain warp and carved tunnels (moray cave, swim-throughs, arch, overhang), meshed with surface nets; baked AO; sand heightfield; coral placement; the obstacle field the fish steer by |
| `js/coral-mesh.js` | Generators for staghorn, brain, mushroom, plate, sea fan, leather, bubble, anemone, finger coral, stones and shell fragments |
| `js/species.js` | Per-species anatomy (body profiles, fins, eyes), swimming style, and behaviour parameters |
| `js/fish-mesh.js` | Lofted fish bodies with separate caudal, dorsal, anal, pectoral and pelvic fin membranes, domed eyes, and a hinged moray jaw |
| `js/behavior.js` | `FishEntity` and the `Aquarium` simulation: state machine (cruising, exploring, hovering, turning, avoiding, schooling, seeking shelter, resting), steering forces, spatial hash, hard collision constraints |
| `js/wgsl/*` | Shaders: fish deformation and colour patterns, rock/sand/coral materials, caustics, shadows, water absorption and fog, particles, bubbles, light shafts, bloom and AgX tone mapping |
| `js/gltf.js` | GLB/glTF import for replacing procedural fish with authored models |
| `js/main.js` | WebGPU setup, render passes, frame loop, adaptive quality |

**Fish.** Each fish has its own position, velocity, heading, preferred depth and speed,
turn rate, personal space, territory and animation phase. Behaviour states change
probabilistically with species-specific weights and durations. Steering sums seek,
obstacle avoidance (probes into the rock/coral field), separation, territory pull, the
water current and smooth individual wandering, plus alignment and cohesion for the
damselfish and anthias schools. Headings rotate at a limited rate (slower when swimming
slowly), fish slow down into sharp turns, and a hard constraint keeps bodies out of rock.
Clownfish stay with their anemone, royal grammas keep to ledges, the lionfish hovers, and
the moray stays in its cave, extending, looking around and breathing.

Swimming is a vertex-shader body wave whose amplitude, frequency and wavelength depend on
species and speed (carangiform tangs, labriform wrasse-like rowing, balistiform
triggerfish, the lionfish's slow fin sculling, the eel's anguilliform wave). Pectoral and
median fins move independently, the body bends and banks into turns, and fins are
translucent.

**Rendering.** 4x MSAA HDR forward pass; a 2048² shadow map whose static part (rock and hard
corals) is rendered once and copied each frame before soft corals and fish are added;
animated caustics projected along the light; ray-marched light shafts occluded by the
shadow map; GPU-generated marine snow and bubble streams; absorption and fog by the length
of the view ray inside the water; bloom with a firefly-safe first pass; AgX tone mapping.

**Performance.** Measured on an RTX A5000 at 1920×1080: about 140 FPS uncapped with the
default 34 fish (so the 60 FPS cap holds with large headroom), and the simulation takes
about 0.25 ms of CPU per frame. Per-frame work allocates nothing; fish and corals are
instanced. If frames run long, the render scale drops step by step to
`display.minRenderScale`, then the frame rate drops to 30 FPS.

## Custom fish models

Set `assets.models` per species, e.g.
`{ "blueTang": "models/blue-tang.glb" }` or
`{ "blueTang": { "url": "models/blue-tang.glb", "forward": "-z" } }`. The importer reads
meshes from the default scene (with node transforms), normals, UVs and the base-colour
texture, and fits the model to the fish frame (length 1, snout forward). The procedural
swimming deformation then drives it, and a model that fails to load falls back to the
procedural fish.

Limitations:

- **Compressed assets.** Draco geometry (`KHR_draco_mesh_compression`) and KTX2/Basis
  textures (`KHR_texture_basisu`) need decoders registered with `registerDecoder()` in
  `js/gltf.js`. None are bundled, to keep the project dependency-free. Without a decoder,
  such a model is rejected and the procedural fish is used.
- **Animation clips.** Skeletal clips are listed but not played.
- **Fin animation.** Fins in imported meshes animate with the body only.

## Visual checks

`shot.ps1` renders a frame in headless Chrome through the dev server (`node server.mjs
8090`) and saves it under `shots/`, for example
`.\shot.ps1 reef.png -frames 600` or `.\shot.ps1 fish.png -extra '&view=lineup'`.
