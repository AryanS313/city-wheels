# Validation — browser v0.3.2, 13 September 2026

## Reported display failure

The `.wanted` CSS selector matched both the police alert and the `body.wanted` gameplay state. Starting a pursuit therefore applied the alert's absolute position, width and padding to the entire page. In the browser, an actual car takeover reduced a 1280 × 720 canvas to 277 × 36 pixels at (969, 127). Serious pedestrian incidents invoked the same broken state. This explains the almost empty screen and tiny message in the upper-right corner. The earlier v0.3.1 ownership tests did not check DOM dimensions and missed this failure.

The alert now uses `#wanted`; the body state uses `is-wanted`. Desktop and mobile alert text is larger, the card remains within the screen, and the mission card hides while the police alert is present. A DOM regression deliberately adds the legacy body class as well, confirming it can no longer change page dimensions.

Final browser checks exercised actual theft and the pedestrian injury handler with Performance graphics. Both kept the canvas at (0, 0), filling the current 539 × 837 viewport. The responsive fixture checked idle, wanted, searching and cleared states at 1366 × 900, 390 × 844 and 844 × 390. All passed with readable alert text and a visible Graphics selector.

## Rendering and simulation load

The player retains the authored 213,195-triangle car. Nearby traffic now renders in nine draws / 12,047 triangles; distant traffic uses seven draws / 3,594 triangles, including independently rotating wheels. The previous medium traffic model used 40 draws / 22,230 triangles. These are visible geometry budgets, excluding hidden source meshes retained for later ownership changes. Ownership swaps retain the car root, materials and cached damage geometry.

Graphics settings offer Auto, Performance, Balanced and High. Auto starts at Balanced and lowers quality after sustained slow frames; it requires sustained recovery before increasing quality again. Presets cap render resolution, shadow resolution and update rate, visible traffic distance, and dynamic lighting. Performance permits at most 1280 × 720 internal pixels at a maximum pixel ratio of 0.8. The page and its text retain full viewport size. Graphics changes do not remove simulation participants or colliders.

The collision broadphase uses exact body bounds for sweep and ray candidates. Terrain narrowphase tests restrict cells to the transformed collider's bounds while retaining Cannon's contact generator and solver. Adjacent building triangles merge only when their union is convex, reducing building shapes from 20,451 to 9,517 without changing footprint areas, concavities or courtyard holes. The terrain triangle cache remains capped at 8,192 entries. Settled parked cars can sleep and wake on impact or takeover.

In a reproducible dense-city sequence with 300 measured steps, convex contact tests fell from 2,294,441 to 182,455, and broadphase candidate pairs fell from 190,318 to 98,126. Those are operation counts, not a cross-device FPS claim. Timing on the shared host varied too much to promise a specific speedup. The population remains 57 physical vehicles, 150 residents and the existing street/venue colliders.

Physics remains fixed at 60 Hz. Normal browser frames perform at most two simulation steps, retaining less than two steps of carry while discarding older whole-step debt during overload. This bounds catch-up work; below 30 rendered frames per second the simulation may run slower than wall time. Offline callers can request up to six substeps. Tests cover jitter around 30 fps so ordinary frame variation does not cause an unnecessary slowdown.

## Browser stability coverage

The development runner at `/?stability-test` provides visible controls for theft, pedestrian incidents, layout checks, repeated takeovers, graphics recovery and stopped-frame recovery. It is excluded from production builds.

With the actual textured GLB, 60 scripted valid-distance takeovers across six fleet subjects, all three camera modes and five weather settings passed. Every switch asserted that the canvas still filled the viewport, the camera followed the new car, matrices remained finite, the existing visual was reused and no recovery overlay appeared. The final run recorded zero script errors and zero unexpected context losses. After warmup, GPU resources remained bounded: 294 to 293 geometries, 55 textures, and 76 to 77 shader programs across weather variants. Forced WebGL context loss also restored the scene successfully and left the drive paused.

The v0.3.1 safeguards remain: camera shake does not accumulate into the camera anchor; invalid transforms stop the frame loop with a restart screen; graphics loss pauses play; ownership does not rebuild car visuals; crowd buffers and terrain caches have bounded lifecycles. These checks cannot establish crash-free operation on every GPU or mobile device.

## Automated coverage and publication

All 76 automated checks passed in the final serial publication run (26.56 seconds), followed by a successful production build. The development-only test controls are absent from the built JavaScript. Coverage includes terrain and hill driving, tyre surfaces, braking and steering, concave building and pole impacts, damage transfer, real-city traversal, dense physical pursuit, the 60-second unseen rule, arrest and restart, pedestrian outcomes and ownership at impact time, repeated theft, model geometry and rendering budgets, graphics adaptation, HUD selector isolation, bounded frame catch-up, and terrain-contact equivalence against stock Cannon.

The unchanged import pipeline previously passed 11 offline checks for source hashes, projected bounds, DEM samples, OSM road geometry, one-way edges, clipping, courtyards, height provenance, landmark coordinates, Filbert grade and spawn. This update does not change geographic data.

Production verification checks the deployed version and JavaScript asset against the local build, then opens the published game. GitHub contains the source, the Pages build, and a downloadable static browser release with licenses and data attribution.

## Remaining scope

The playable world is still the 1 km² Russian Hill district. This browser edition uses Three.js and cannon-es. Native Unreal compilation, packaging and Lumen verification remain unavailable on this host.

People and business scenery remain stylized. Injury/death outcomes are non-graphic arcade rules, not real-world injury predictions or skeletal ragdolls. Full signal/merge compliance remains unfinished, and traffic can become trapped after difficult maneuvers. Theft is a nearby car-to-car takeover with a displaced-driver reaction, without on-foot player controls or animated door entry. Vehicle profiles share one authored body model. These limits are unchanged by the stability update.
