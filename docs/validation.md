# Prototype validation — 12 September 2026

## Passed

- 11 offline data-import tests: source hashes; exact projected bounds; every DEM sample against the original GeoTIFF; real OSM geometry; legal one-way edges; clipping; multipolygon courtyard parsing; building height provenance; landmark coordinates; real Filbert grade; spawn position.
- 12 JavaScript physics tests: acceleration/reverse/steering; wet braking; surface friction; hill acceleration; suspension settling; airborne landing and damage; physics traffic; actual railway contact patches; real San Francisco start and five seconds of driving.
- The real-city physics benchmark creates 255 aggregate static bodies in approximately 140 ms, with approximately 0.5 ms mean physics update and 0.8 ms p95 on the authoring machine's Node runtime. Occasional warm-up/GC spikes occur. These are simulation-only measurements, not browser FPS or Unreal performance claims.
- Browser production build succeeds with bundled JavaScript, local fonts and city data.
- Browser preview visually inspected: start screen, generated streets/buildings/car, driving HUD, minimap, rain, cockpit mode, delivery start/cancel. Keyboard input and camera switch are connected. Phone-width DOM layout has no horizontal overflow.

## Not verified or not implemented

- UE5 C++ compilation, Blueprint asset generation in-editor, cooking, packaged executable and native play tests: unavailable because the host has no Unreal installation/full Xcode.
- Native Lumen visual quality: configuration is present, but procedural meshes lack Nanite/static-mesh distance fields. No UE screenshots or performance figures are claimed.
- Photorealistic assets, all requested neighborhoods/landmarks, complete traffic signals/merging, ambient life, the full mission/story/garage systems: roadmap work.
- Browser tests do not certify Unreal source or a production simulator. Browser traffic currently stops at road-way ends. The city boundary marks the end of the imported area; use recovery when leaving it.
