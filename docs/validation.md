# Validation — browser v0.3, 12 September 2026

## Current automated coverage

The suite contains 49 automated checks spanning the unchanged road/vehicle baseline and the new city-life rules. It covers continuous terrain, hill/grip/steering/braking, concave building and prop collisions, model geometry and LOD silhouette, venue provenance/clearance, district-wide population, seating direction, actual physical injury/fatal contacts, persistent outcomes, ownership at impact time, theft constraints, blocked police sight, the full 60-second unseen rule, sustained arrest, recovery restrictions and restart.

The dense-city integration creates 57 physical cars (player, 40 moving including four patrols, 16 parked), 150 residents, 38 venues, five rest pockets, 792 street objects and 126 venue/rest fixtures. It passes a classified pedestrian incident into gameplay, runs a physical police pursuit to BUSTED, and restarts with healthy residents and repaired player condition. An isolated run reached BUSTED at 11.13 simulated seconds. Mean complete CPU step including pedestrian synchronization was 13.86 ms, p95 19.76 ms on this machine. These are simulation measurements, not GPU/rendering FPS guarantees.

Separate physical contact tests yield persistent injured and fatal outcomes at the deliberately chosen game thresholds; minor contacts allow recovery. Repeated solver contacts cannot emit duplicate serious-outcome incidents. Player ownership is checked at the instant of impact. All resident personas share identical rules.

The district population covers all 25 cells of a 5×5 geographic grid. Business participants face their tables, and seated bodies rest at seat/mat height. Every fixture corner stays outside building/road polygons; measured minimum road-edge walking clearance is 1.593 m. Existing OSM names are preserved only for compatible tagged venues; fictional additions are marked.

The source car has 213,195 triangles; its shared distant-traffic LOD has 22,230 and preserves the measured body silhouette. Player and nearby cars retain source detail. The crowd uses four instanced geometry batches; places use 38 sign meshes and eight instanced batches. Node model tests disable textures, so they do not validate browser shaders.

Production builds bundle the city data, GLB, fonts and licenses. Publication verification checks the deployed version, current JavaScript assets and model manifest. Source is pushed to GitHub and the static game is published on the existing Pages URL.

## Material limits

This update has simulation, geometry, static-code review and build validation; it has not received a new browser visual play-test. Native Unreal compilation/packaging and Lumen verification remain unavailable on this host.

The 1 km² SF district remains the complete playable map. Characters and business decoration are stylized. Serious injuries/deaths are non-graphic arcade outcomes, not real-world injury predictions or skeletal ragdolls. Police use physical road routing and proximity/visibility rules, but full signal/merge compliance is unfinished and vehicles can get trapped after difficult maneuvers. Theft is a nearby car-to-car takeover with an exited-driver reaction; no on-foot player mode or door-entry animation is implemented. Vehicle profiles vary in tune/color but share one authored body model. Furniture remains anchored.

## Earlier data baseline

The unchanged geographic package passed 11 offline import checks: hashes, projected bounds, source DEM samples, OSM road geometry, one-way edges, clipping, courtyards, height provenance, landmark coordinates, Filbert grade and spawn. This update changes gameplay and scenery, not the source city package.
