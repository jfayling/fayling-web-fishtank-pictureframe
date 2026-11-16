# Browser support

The aquarium renders with WebGPU only. There is no WebGL fallback: the renderer depends on
WebGPU features such as WGSL shaders, depth textures sampled in shaders, and timestamp queries
where available.

| Browser | Platforms | WebGPU since | Status here |
| --- | --- | --- | --- |
| Chrome | Windows, macOS, ChromeOS | 113 | **Tested** (Windows, NVIDIA) |
| Edge | Windows, macOS | 113 | Expected to work (same engine as Chrome) |
| Chrome | Android 12+ on recent Qualcomm / ARM GPUs | 121 | Expected to work; not yet tested |
| Safari | macOS, iOS, iPadOS 26+ | 26 | Expected to work; not yet tested |
| Firefox | Windows | 141 | Expected to work; not yet tested |
| Firefox | macOS, Linux, Android | behind a flag or in Nightly | Not supported yet |
| Chrome | Linux | behind `chrome://flags/#enable-unsafe-webgpu` on many GPUs | Works when WebGPU is available |

"Expected to work" means the browser ships WebGPU but nobody has reported a run of this
project on it yet. Reports, good or bad, are very welcome. Please open a
[bug report](https://github.com/jfayling/fayling-web-fishtank-pictureframe/issues/new?template=bug_report.yml)
with the browser, OS and GPU.

## Secure context

Browsers expose WebGPU only on secure pages:

- `https://` (GitHub Pages and most hosts): works
- `http://localhost` (the dev server): works
- `file://` (double-clicking `aquarium.html`): works in Chrome and Edge
- `http://<LAN address>` (for example a TV loading a page from another computer): **does not
  work**. Serve over HTTPS, or copy the HTML file onto the device that shows it.

## What happens without WebGPU

Instead of a black screen, the page explains what is missing. It distinguishes three cases:
no WebGPU in the browser, an insecure page, and WebGPU present but no usable graphics adapter
(often hardware acceleration turned off, or a blocklisted driver).

## Hardware

Any GPU the browser accepts for WebGPU runs the aquarium. At start-up the page asks for the
high-performance adapter. While running, it lowers its own render scale and then its frame
rate to keep up. Integrated GPUs and 4K displays will usually settle below full resolution;
`display.maxRenderScale` and `display.targetFps` (Settings → General, or the URL) give
manual control.
