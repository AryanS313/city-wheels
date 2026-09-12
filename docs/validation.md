# Validation — browser v0.3.1, 12 September 2026

## Stability findings and reproduction

The former renderer disposed and rebuilt both car visuals when ownership changed. In an isolated actual-GLB test, ten swaps took about 1,037 ms of CPU work and disposed 330 geometries. The replacement changes ownership in place, retains dent/scratch buffers and uses the same reflective glass shader for every role. Sixty damaged-car ownership changes took about 19 ms total in the same isolated Node check; this excludes rendering and is not an FPS claim.

The camera now keeps an unshaken anchor, resets on ownership/camera-mode changes or recovery, and applies impact motion only as a temporary offset. Invalid player transforms stop the frame loop with a restart screen instead of continuing to corrupt the view.

The terrain collision-prism cache previously grew throughout a drive, amplified by police sight rays through the heightfield. It is now bounded to 8,192 entries, and police sight samples the terrain directly while still ray-testing solid occluders. An isolated 150-second fleet/pursuit run completed three restarts without falling cars or invalid transforms; retained heap stabilized near 122 MiB. A separate 56-theft test preserved all vehicle IDs and body counts.

Twelve crowd reset cycles created 384 displaced drivers while respecting the live population cap. No invalid matrices or active collider leaks were found. Explicit instance-buffer disposal releases all eight buffers, and changed-range uploads reduce the measured per-frame crowd transfer from 1.926 MB to 0.207 MB. With the fixed terrain cache, heap settled near 164 MiB in that combined lifecycle run.

The in-app browser ran 60 scripted, valid-distance takeovers using the actual textured car model, six fleet subjects, all three camera modes and five weather settings. It reported zero script errors and zero unexpected context losses; after warmup, GPU resources stayed bounded (331 to 327 geometries, 56 textures, 51 to 52 shader programs across weather variants). The test then forced WebGL context loss, observed the recovery overlay, restored the context, and verified the scene returned paused. The development runner is available at `/?stability-test` during `npm run dev`; production builds exclude it. An injected invalid player transform also exercised the stopped-frame restart screen. Browser rendering timings were affected by the loaded host and are not used as performance claims.

Safe spawn checks reject cars overlapping building footprints or falling outside the terrain. The finite map edge is now visibly closed by 1,000 terrain-following solid construction panels in three render batches. These are game boundaries, not real SF infrastructure. Tests verify all four edges, corner continuity, visible/collider agreement and invalid-terrain rejection.

## Current automated coverage

All 61 automated checks passed in the final serial publication run (85.99 seconds). The suite contains 61 automated checks spanning the unchanged road/vehicle baseline and the new city-life rules. It covers continuous terrain, hill/grip/steering/braking, concave building and prop collisions, model geometry and LOD silhouette, venue provenance/clearance, district-wide population, seating direction, actual physical injury/fatal contacts, persistent outcomes, ownership at impact time, theft constraints, blocked police sight, the full 60-second unseen rule, sustained arrest, recovery restrictions and restart.

The dense-city integration creates 57 physical cars (player, 40 moving including four patrols, 16 parked), 150 residents, 38 venues, five rest pockets, 792 street objects and 126 venue/rest fixtures. It passes a classified pedestrian incident into gameplay, runs a physical police pursuit to BUSTED, and restarts with healthy residents and repaired player condition. The earlier v0.3 isolated baseline reached BUSTED at 11.13 simulated seconds, with a 13.86 ms mean and 19.76 ms p95 complete CPU step including pedestrian synchronization. The v0.3.1 isolated traversal test passed 60 seconds across 12 roads and 451.68 m, with full vehicle health, a 5.69 ms mean and 7.62 ms p95 step. These are simulation measurements, not GPU/rendering FPS guarantees. Tests run one file at a time to keep concurrent workloads from invalidating timing checks.

Separate physical contact tests yield persistent injured and fatal outcomes at the deliberately chosen game thresholds; minor contacts allow recovery. Repeated solver contacts cannot emit duplicate serious-outcome incidents. Player ownership is checked at the instant of impact. All resident personas share identical rules.

The district population covers all 25 cells of a 5×5 geographic grid. Business participants face their tables, and seated bodies rest at seat/mat height. Every fixture corner stays outside building/road polygons; measured minimum road-edge walking clearance is 1.593 m. Existing OSM names are preserved only for compatible tagged venues; fictional additions are marked.

The source car has 213,195 triangles. The shared distant-traffic LOD preserves its measured silhouette; the test traverses 27,458 triangles including hidden interior geometry retained for later ownership changes. Player and nearby cars retain source detail. The crowd uses four instanced geometry batches; places use 38 sign meshes and eight instanced batches. Node model tests disable textures, so they do not validate browser shaders.

Production builds bundle the city data, GLB, fonts and licenses. Publication verification checks the deployed version, current JavaScript assets and model manifest. Source is pushed to GitHub and the static game is published on the existing Pages URL.

## Material limits

This update includes a browser visual and graphics-context recovery check as well as simulation, geometry and build validation. It does not establish crash-free operation on every GPU or mobile device. Native Unreal compilation/packaging and Lumen verification remain unavailable on this host.

The 1 km² SF district remains the complete playable map. Characters and business decoration are stylized. Serious injuries/deaths are non-graphic arcade outcomes, not real-world injury predictions or skeletal ragdolls. Police use physical road routing and proximity/visibility rules, but full signal/merge compliance is unfinished and vehicles can get trapped after difficult maneuvers. Theft is a nearby car-to-car takeover with an exited-driver reaction; no on-foot player mode or door-entry animation is implemented. Vehicle profiles vary in tune/color but share one authored body model. Furniture remains anchored.

## Earlier data baseline

The unchanged geographic package passed 11 offline import checks: hashes, projected bounds, source DEM samples, OSM road geometry, one-way edges, clipping, courtyards, height provenance, landmark coordinates, Filbert grade and spawn. This update changes gameplay and scenery, not the source city package.
