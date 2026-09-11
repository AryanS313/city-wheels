# Validation — browser v0.2, 12 September 2026

## This update

- 23 automated checks: vehicle acceleration/braking/steering/reverse; wet and rail grip; hills, suspension and landing; physical traffic; concave building notches and courtyards; exact narrow tree/pole collisions; collision momentum, impact zones and engine health; coasting without service braking; pedestrian awareness; collider alignment to the detailed car; actual model geometry/deformation; deterministic furniture layout; physical walking and impact toppling/recovery.
- The real-city integration runs 60 simulated seconds with 18 dynamic traffic cars, 42 pedestrians and 792 solid furniture objects. The player traversed 451.5 m across 12 OSM road ways with full health. The longest below-1-km/h interval while requesting throttle was 0.067 seconds during startup. This is one route, not a guarantee for every street or collision.
- Integrated Node timing on the authoring machine: about 781 ms setup, 5.99 ms mean and 8.30 ms p95 for simulation plus pedestrian synchronization; maximum observed 12.90 ms. These exclude WebGL rendering and do not establish browser FPS or Unreal performance.
- Actual CarConcept geometry: 213,195 triangles, 49 merged material/category groups, four circular wheels of approximately 0.335 m radius. A sampled damage case changes 2,298 coordinates, projects scratches and changes windshield crack opacity. This Node check intentionally disables textures; it does not verify browser shaders or visual quality.
- Independent geographic placement checks found no furniture overlap with roads/buildings and no generated sidewalk-corridor overlap. Furniture and collision consume the same placement descriptors.
- Production build includes the detailed GLB, its source manifest, attribution and license locally, with no runtime asset-host dependency.

## Limits

- This update has automated simulation, geometry and build validation. It has not received a new browser visual play-test. Visual checks documented for v0.1 do not validate the new car, pedestrian rendering or cockpit view.
- Traffic follows connected directed routes, but full signal phases, turn restriction handling and merging remain unfinished. Cars can queue or become trapped after difficult turns/accidents. No visible teleporting is used to hide those conditions.
- Pedestrians are stylized articulated adults with dynamic capsule toppling, not skeletal ragdolls or photorealistic people. They currently follow sidewalks. Trees/poles stay anchored. Damage deforms rendered panels while rigid collision shapes remain simplified; this is not a soft-body structural simulation.
- UE5 compilation, Blueprint generation, native cooking, Lumen visual testing and packaged executable remain unverified: the host has no Unreal Engine/full Xcode toolchain.
- Full-city coverage, all requested landmarks, cyclists/cable cars/animals, story/garage systems and production art remain roadmap work.

## Earlier data baseline

The unchanged geographic package previously passed 11 offline import checks: source hashes, exact projected bounds, DEM samples against the source GeoTIFF, OSM geometry, one-way graph edges, clipping, multipolygon courtyards, height provenance, landmark coordinates, Filbert grade and spawn. This update changes browser simulation/art, not the source city package.
