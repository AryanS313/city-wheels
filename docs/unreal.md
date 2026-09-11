# Unreal engineering notes

## Coordinate/data contract

`city.json` is produced outside Unreal. Runtime systems do not query OSM or reproject geographic coordinates. `schemaVersion` must be 1. The importer's default package is `san-francisco`; changing `CityPackage` selects another staged folder. An editor override can select a JSON path directly.

| Data package | Unreal |
|---|---|
| X: east, metres | Y: east, centimetres |
| Y: north, metres | X: north, centimetres |
| Z: source elevation, metres | Z: elevation, centimetres |
| heading 0 north, π/2 east | yaw 0 +X, 90° +Y |
| DEM row 0 south; column 0 west | row/column conversion preserves that order |

Source elevation remains absolute; the local origin is horizontal only. Roads are elevated 14 cm above the measured centreline to separate the surface from the terrain; paint and rails sit a little higher. Terrain is cut beneath road corridors to prevent cross-slope DEM protrusions. The source data is not altered. Road records keep name, ID, node IDs, one-way value, speed, lane count, and width. Null node IDs from resampling are excluded from junction connectivity.

The editor reads `../data/cities/<city>/city.json` if loose staged content is absent. `stage_city.py` copies runtime JSON and attribution into `Content/CityData/<city>`. Packaging stages this as NonUFS because `FFileHelper` reads it directly. The large raw OSM and DEM inputs remain outside native runtime content.

## Vehicle model and initial tuning

The root collision box is a simulated Chaos rigid body, with contact forces calculated in C++. This uses Unreal's rigid-body solver, not the Chaos Vehicles skeletal-wheel plugin. There is no skeletal asset dependency. The primitive body, cabin and wheels are replaceable visual components in the generated Blueprint.

| Parameter | Initial value |
|---|---:|
| Mass | 1,450 kg |
| Wheelbase / track | 2.64 m / 1.54 m |
| Centre of mass offset | +0.10 m forward, −0.02 m down |
| Wheel radius | 0.34 m |
| Spring / damper per wheel | 38,000 N/m / 4,200 N·s/m |
| Spring rest length | 0.45 m |
| Bump / droop travel | 0.24 m / 0.16 m |
| Peak engine torque | 290 N·m at 3,800 RPM |
| Ratios | 3.54, 2.16, 1.48, 1.12, 0.88, 0.72 |
| Final drive / efficiency | 3.73 / 87% |
| Base dry / wet grip coefficient | 1.02 / 0.68 |
| Brake force, front/rear split | 20,000 N, 64% / 36% |
| Drag area | 0.68 m² |

For a level static load the spring sag is about 9.4 cm and natural frequency about 1.63 Hz. With the spring attachment 22 cm above the body origin, the nominal body ground clearance is about 18 cm and centre-of-mass height about 46 cm. These are physically scaled starting values; the car has not been tuned by driving a native executable on this host.

The spring/damper computes normal load from compression and contact-point velocity. Tire force is applied at the actual contact point, so the solver naturally transfers loads and pitches/rolls the body. Lateral force follows a smooth slip-angle curve; longitudinal force follows a quasi-steady saturating slip curve. A combined friction circle limits both forces together. Grip depends on load, wetness, and the tagged surface hit by each wheel. Bricks/paving stones use the cobble coefficient; metal tracks and paint have lower wet grip.

Longitudinal wheel inertia, tire temperature, ABS, traction control, differential simulation, anti-roll bars, and a full transient Pacejka tire model are not implemented. Wheel rotation is visual. Contact queries/forces run before the frame's physics; the Chaos solver substeps them, but suspension queries are not repeated in each physics substep. Native low-frame-rate stability needs a test and may require an async physics callback before production use.

Collision impulse reduces engine health and adds wheel misalignment; engine health scales the torque curve. A simple body shortening makes damage visible. The Blueprint `OnDamageChanged` event is the attachment point for replacement deformable panels, glass fracture and scratch masks. Those production effects/assets are not delivered here.

## Rendering scope

Lumen, virtual shadow maps, atmospheric sun/sky, volumetric fog, motion blur and dynamic wet roughness are configured. Weather transitions and rain streak instances work through the native environment class; night conditions change streetlight intensity and a facade material parameter. The fog is a global volumetric density transition, not a geographically advected bay fog bank. Streetlights are luminous points without production pole fixtures. Facades are vertex-colored procedural window blockouts, not detailed Victorian/glass/wood facade kits.

**Procedural mesh limitations matter:** this importer uses `UProceduralMeshComponent` and does not claim those meshes are Nanite or provide built static-mesh distance fields. Lumen screen traces can contribute, but enabling project settings does not create the missing mesh representations. Epic documents the geometry supported by software Lumen and the need for adequate mesh distance fields in [Lumen Technical Details](https://dev.epicgames.com/documentation/unreal-engine/lumen-technical-details-in-unreal-engine).

The production path is to bake generated geometry into spatially chunked StaticMesh assets in the editor, enable/check Nanite and distance fields on supported assets, retain appropriate collision meshes, and replace aggregate procedural rendering with World Partition streaming actors. No automated Nanite bake is included in this initial source. Do not interpret Lumen configuration as verified photorealistic output.

The importer triangulates concave outer building rings. The 14 courtyard holes in the current data package are retained in JSON but capped by this initial native renderer; window placement is also generic. Landmark coordinates are preserved by the data package, while bespoke landmark meshes are not supplied. Lombard's crooked street is represented by its measured road geometry. Golden Gate Bridge, Coit Tower, Pier 39, Transamerica Pyramid and Bradford Street are outside this initial tile and are not invented inside it.

## Native acceptance procedure

These are checks to run on an engine-equipped machine, not claimed results:

1. Build the editor target and run bootstrap; require a new `Saved/city-wheels-bootstrap.json`, a saved map, and no Blueprint/material compile errors.
2. Play the level; verify 264 road pieces, the measured 257×257 elevation grid and the expected spawn orientation. Confirm wheel rays contact asphalt/cobble/paint/tracks and the chassis remains supported on hill starts.
3. On a level calibration surface, measure static sag near 9.4 cm, stopping distances at 50 km/h dry/wet, straight-line acceleration, and steady cornering. Verify the rain stopping distance grows and the car settles after landing.
4. Repeat at 30, 60 and 120 FPS. Record suspension oscillation and stopping-distance variation; move contacts to a physics callback if variation is material.
5. Drive Filbert, the Lombard switchbacks, intersections and tile-edge roads. Check for DEM protrusions, failed roofs, collision snags and falling beyond the bounded slice; R should recover.
6. Test chase, cockpit and orbit views, night headlights, fog and rain transitions. Inspect Lumen visualizations before describing native GI as validated.
7. Cause a substantial front impact and compare acceleration and steering drift before/after; confirm low-speed scrapes do not apply damage.
8. Package through `Scripts/build.py --package`, launch the archived executable away from the source checkout, confirm staged city data loads, and only then publish a native release artifact.

## Expansion boundaries

`CityWorld` owns presentation/import, `CityVehicle` owns driving physics, and `CityGameMode` owns the initial spawn/HUD. City-specific coordinates remain in the data package. Future traffic controllers should steer/brake `ACityVehicle` using `SetDrivingInputs`, avoiding kinematic teleports. Future mission definitions can reference stable road/node/place IDs rather than hardcoded world coordinates. The exported directed graph supports one-way routing, but traffic behaviour is not implemented in this initial native slice.

Taxi/delivery/race/getaway gameplay, branching story, four characters, garages, pedestrians/cyclists/animals, working physical cockpit gauges/mirrors, and sophisticated car damage remain expansion work. The browser demo may have its own gameplay features; that does not imply parity in these Unreal sources.

API references used when authoring: Epic's [procedural mesh component](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent), [Python editor scripting](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python), [BlueprintFactory](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UBlueprintFactory), and [exponential height fog component](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/Components/UExponentialHeightFogComponent?application_version=5.5). These API checks are not a substitute for compilation against the selected 5.6 installation.
