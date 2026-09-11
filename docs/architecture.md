# City Wheels architecture

City Wheels is split into a reproducible geographic dataset, an Unreal Engine 5 native project, and a playable browser companion. The browser game is not an Unreal build and does not implement Lumen or Nanite. The first deliverable is a prototype district, not a finished photorealistic open-world game.

```text
city-wheels/
  data/cities/san-francisco/    Versioned 1 km square, provenance, raw OSM + DEM
  pipeline/                   City-independent geographic import CLI
  unreal/                     UE5 C++ project, editable Blueprint bootstrap
  web/                        Public browser companion using the same city.json
  tests/                      Geographic pipeline checks
  scripts/                    Build and publication helpers
  docs/                       Architecture, build instructions and roadmap
```

## City package boundary

`city.json` is an engine-independent contract. Positions are `[east, north, elevation]`, in metres, relative to an EPSG:32610 origin for this San Francisco package. Elevation remains an absolute orthometric height. A package carries the origin, bounds, DEM vertex grid, roads, buildings, directional graph, restrictions, landmark records, spawn and provenance. The importer performs all geographic transforms. Neither game runtime contains San Francisco projection or street-layout logic.

Unreal converts metres into centimetres and maps north to X, east to Y, elevation to Z. The browser maps east to X, elevation to Y, and south to Z. Terrain rows run from south to north. Keep these conversions at importer boundaries; never scatter axis changes through AI or vehicle logic.

One city can later contain multiple tiles plus a shared border-node registry. World Partition cells are a production expansion step; the first Unreal importer builds a bounded level from one tile. Shared OSM node IDs are retained for deterministic junction connectivity.

## Vehicles

Both runtimes use dynamic rigid bodies and four raycast suspension contacts. Spring/damper force acts at each wheel, allowing load transfer and airborne crests. Engine torque, gearing, drag, braking, surface grip and damage are separated from city import. C++ exposes tuning to Blueprints. The browser uses a licensed CarConcept body and interior through a separate model adapter; physics and damage state remain independent of geometry. Native Unreal still has procedural starter art.

Cannon and Unreal rigid-body solvers are different implementations, so passing browser tests does not validate the Unreal vehicle. Native compilation and handling acceptance require an installed UE5 toolchain.

## Rendering and map fidelity

The roads and footprints come from OpenStreetMap. Road heights are interpolated from USGS 3DEP, with a small explicit separation to avoid terrain intersecting the road. This interpolation is not a surveyed engineering road profile; tight crest smoothing and bridge profiles need review. All inferred building heights are labeled. The browser uses simplified facade textures. A continuous heightfield blends real road profiles into the DEM. Rendering samples the exact physics triangles, and building collision triangulates concave footprints and their courtyard holes.

Unreal's Lumen configuration is included. Runtime procedural meshes are not advertised as Nanite meshes. Nanite-ready static meshes, authored landmark models and high-resolution PBR material assets need a separate editor-bake/art stage and visual validation.

## Gameplay boundary

The public prototype provides free driving, delivery destinations, a real street minimap, physics traffic, camera modes, rain/fog/night presets, damage and recovery. Traffic now follows connected directed road routes and brakes for physical cars and pedestrians. Shared furniture descriptors drive both rendered props and colliders; dynamic pedestrians apply walking forces. Full signal phases, turn-restriction compliance, merge negotiation, pedestrian crossings and cyclists remain unfinished.

All browser simulation is local; it has no multiplayer, accounts, paid service, or server state. GitHub Pages serves the static game. Unreal packaged binaries require a licensed engine build runner; GitHub-hosted generic runners do not include Unreal.

To select a different browser package without changing simulation/rendering code, set `CITY_WHEELS_CITY_PACKAGE=data/cities/your-city/city.json` before `npm run build --prefix web`. An optional sibling `display.json` supplies district labels. In Unreal, set the world's `CityPackage` / `CityFileOverride` or use the staging script with a different source package. The initial single-tile app has one active city per build; a multi-city selection screen is future UI work.

## Browser modules

- `physics.js`: vehicle forces, continuous ground, concave collision meshes, surface contact and impact damage.
- `traffic.js`: directed route traversal, following, intersection yielding and physical stuck recovery.
- `ambient.js`: validated sidewalk/furniture layout, instanced scenery and force-driven walking adults.
- `car-visual.js`: licensed GLB loading, wheel/chassis alignment, materials and damage deformation.
- `render.js`: city meshes, sky lighting, cameras and weather.
- `audio.js` / `effects.js`: simulation-driven sound, tyre marks, impact particles and camera impulse.

The new detail model is shared in memory. Traffic omits selected interior groups, uses simpler glass and is culled beyond 285 m. Static minimap content is cached. These measures bound rendering work; measured Node physics timing is not a browser FPS guarantee.
