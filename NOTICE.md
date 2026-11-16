# Notices and attribution

The source code in this repository is released under the [MIT License](LICENSE). This file
records where parts of it come from and which files the MIT License does **not** cover.

## Code

| Part | Origin | License |
| --- | --- | --- |
| Reef, coral, fish, behavior, species, scenes, settings, audio, widgets, glTF import, shaders other than the post-processing chain | Written for this project by Jason Fayling | MIT |
| `build.mjs`, `server.mjs`, the bloom and composite shaders in `js/wgsl/post.js`, and parts of the WebGPU setup and frame loop in `js/main.js` | Adapted from [fayling-web-ocean-pictureframe](https://github.com/jfayling/fayling-web-ocean-pictureframe), whose WebGPU renderer was written by Maksymilian Dendura | MIT, Copyright (c) 2026 Maksymilian Dendura (notice kept in [LICENSE](LICENSE)) |
| `js/place.js`, `js/weather.js`, the clock, and the settings panel layout | Shared with fayling-web-ocean-pictureframe (Jason Fayling's additions there) | MIT |
| AgX tone-mapping polynomial and matrices in `js/wgsl/post.js` | Benjamin Wrensch's "Minimal AgX Implementation" of Troy Sobotka's AgX display transform ([iolite-engine.com](https://iolite-engine.com/blog_posts/minimal_agx_implementation)) | Credited here; see the open question below |

There are no runtime dependencies. `esbuild` (MIT) is a build-time dev dependency only and is
not shipped. Rock, coral, fish, sand and all textures are generated procedurally at start-up;
the repository contains no imported 3D models or texture images.

## Media not covered by the MIT License

`media/track001.mp3` ("Soft Fiano") is an instrumental track generated with
[Suno](https://suno.com) and published by Jason Fayling. It is **not** licensed under the MIT
License. Its use and redistribution are governed by Suno's terms of service for the account
that generated it. The aquarium works without it (music is off by default). If you
redistribute this project, either confirm your own right to include the track or remove it;
the page then logs that the file is missing and keeps running.

The images in `docs/` are screenshots of this application and are covered by the MIT License
together with the code.

## Online services used by the optional widgets

The weather card and location search call these services from the browser. No API keys are
used, and the aquarium itself needs none of them.

- Weather forecasts: [Open-Meteo](https://open-meteo.com), data licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The weather card credits it.
- Place search: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
  (data from GeoNames, CC BY 4.0).
- Postal codes: [Zippopotam.us](https://www.zippopotam.us).
- U.S. weather alerts: [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
  (U.S. government data).

Open-Meteo's free API is intended for non-commercial use.

## Open questions for the maintainer

- **AgX code license.** The AgX constants match Benjamin Wrensch's published minimal
  implementation. Confirm the license under which that code was published and add its notice
  here if it requires one.
- **Music rights.** Confirm that the Suno plan used for `media/track001.mp3` permits public
  redistribution.
