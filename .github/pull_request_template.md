## What this changes

<!-- What and why. Link the issue if there is one. -->

## Screenshots

<!-- For anything visible: before and after, e.g.
     node tools/capture.mjs before.png --frames 600 --query "&clock.enabled=false&weather.enabled=false" -->

## Checklist

- [ ] `npm run build` succeeds, and the rebuilt `aquarium.html` / `aquarium.min.html` are committed
- [ ] `npm run validate` passes
- [ ] Tested in a WebGPU browser (name, OS, GPU): 
- [ ] The standalone `aquarium.min.html` still works when opened from disk
- [ ] No new runtime dependencies, and no allocations added to the per-frame path
- [ ] Performance-sensitive change: `?info=1` numbers before and after are included
- [ ] Any third-party code or assets are credited in `NOTICE.md` with their license
