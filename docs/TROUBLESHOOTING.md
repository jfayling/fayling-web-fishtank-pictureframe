# Troubleshooting

## "WebGPU is not available in this browser"

The browser does not ship WebGPU, or has it turned off. Use a browser from
[BROWSER_SUPPORT.md](BROWSER_SUPPORT.md). On Linux Chrome, enable
`chrome://flags/#enable-unsafe-webgpu` and restart the browser.

## "WebGPU only works on secure pages"

The page was opened over plain `http://` from another machine. Use the
[live demo](https://jfayling.github.io/fayling-web-fishtank-pictureframe/), serve over HTTPS,
use `http://localhost`, or open the downloaded HTML file directly.

## "No WebGPU graphics adapter was found"

The browser supports WebGPU but would not use the GPU:

- Turn on hardware acceleration (Chrome: Settings → System → *Use graphics acceleration when
  available*), then restart the browser.
- Update the graphics driver.
- Open `chrome://gpu` and look for *WebGPU: Hardware accelerated*. If it says *Disabled* or
  *Software only*, the driver is blocklisted. As a last resort, start Chrome with
  `--enable-unsafe-webgpu --ignore-gpu-blocklist`.
- Remote desktop sessions and some virtual machines provide no GPU at all.

## "The graphics device stopped responding"

The GPU driver reset or the GPU was taken away (a driver update, sleep, a GPU switch on a
laptop, or a very heavy load from another program). Reload the page.

## It runs slowly or stutters

- Open the page with `?info=1` to see the frame rate, render size, render scale and, where
  supported, GPU time.
- The page lowers its own render scale (down to `display.minRenderScale`, 0.5 by default) and
  then drops to 30 FPS. If it still struggles, try
  `?display.maxRenderScale=0.6&effects.particleCount=600&fish.population=24`.
- On laptops, plug in power and make sure the browser uses the discrete GPU (Windows: Settings
  → Display → Graphics).
- Other tabs and screen recorders share the GPU.

## The screen is black after loading

Open the browser console (F12) and look for `GPU error` or `Shader compile error` lines. Then
[open a bug report](https://github.com/jfayling/fayling-web-fishtank-pictureframe/issues/new?template=bug_report.yml)
with the console output, browser, OS and GPU.

## No sound or music

Browsers allow audio only after a user gesture. Click or press a key once after turning sound
(`M`) or music (`N`) on. Music needs `media/track001.mp3` next to the HTML file. When the file
is missing, the console says `music: could not load media/track001.mp3`.

## The weather card shows an error or the wrong place

The card needs network access to Open-Meteo, and to the National Weather Service for U.S.
alerts. Set the location under Settings → Widgets → Weather (a city, or a 5-digit U.S. ZIP
code), or turn the card off with `F`. The aquarium itself needs no network.

## Settings seem stuck

Settings are saved in the browser's local storage. Use **Reset** in the Settings panel. A URL
option like `?scene=sunset` applies to that visit only and does not overwrite saved settings.

## Full screen does not start

Browsers only allow full screen after a click or key press, so the first interaction enters
it. Clicking the toolbar, the settings panel or the weather card does not. Turn this off with
`display.fullscreen=false`.
