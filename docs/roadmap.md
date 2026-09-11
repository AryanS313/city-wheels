# Expansion plan and acceptance gates

The first slice is Russian Hill: an exact 1,000 × 1,000 m tile including crooked Lombard and steep Filbert. Bradford, Golden Gate Bridge, Coit Tower, Pier 39 and Transamerica Pyramid are outside this tile. Their real coordinates are recorded; they are not moved into the tile to imply coverage.

## Browser v0.3 delivered

Citywide population within the imported district: 40 moving vehicles (four patrol units), 16 parked cars, 150 residents, business/home frontages, coffee/dining/chat/rest activities and shared solid furniture. Non-graphic impact outcomes feed a police response; 60 seconds out of sight clears wanted, sustained capture gives BUSTED/restart. Holding E transfers a nearby vehicle without resetting its physical state. Remaining work includes on-foot entry animations, multiple authored vehicle bodies, full signals/merges and skeletal character rigs.

## Browser v0.2 delivered

The public companion now has a licensed detailed body/interior, impact dents/scratches/cracked glass, connected physical traffic, 42 stylized walking adults, and matching visible/physical roadside objects. Seamless terrain collision replaces overlapping road boxes. These browser changes do not complete the native UE slice or the production art/AI gates below.

## Native slice acceptance

1. Compile the C++ targets on UE 5.6 with an appropriate compiler; run the editor bootstrap to create the Blueprints, materials and saved level.
2. Play the generated map, confirm positive north/east movement, drive Lombard, check Filbert grades, brake uphill/downhill, catch and land a crest, test collision damage and recover.
3. Validate Lumen lighting and screenshots on the target GPU, then cook and package. Upload the tested platform archive to GitHub Releases.
4. Replace procedural car art with a licensed detailed vehicle, proper interior, mirrors, gauge materials and damage zones. Validate mirror camera cost and material lighting.

## Expand the map

- Add adjacent North Beach and waterfront tiles using the same geographic package schema. Derive World Partition cells, streaming distances, LOD/HLOD and persistent graph IDs.
- Author Coit Tower, Pier 39 and Transamerica Pyramid at their real package coordinates. Use authored models with traceable asset licenses.
- Continue west through the Marina to the Golden Gate Bridge; bridge deck profiles must be separate from bare-earth DEM.
- Add Haight, SoMa, Sunset and Bernal Heights. Import Bradford's terrain at native high resolution and validate its street grade against independent measurements.
- Add neighborhood polygons and reusable Victorian, glass-tower and Sunset-house facade kits, rather than identifying neighborhoods in gameplay code.

## Systems after the native slice

- Lane-level traffic graph, signal phases, stop/yield priority, intersection reservations, legal merges, physics-based gap following, pedestrian/cyclist prediction and player reactions.
- Pedestrian navigation, bicycle physics, cable-car tracks/schedules, dogs, gulls, and localized Pier 39 sea lions.
- Taxi jobs, delivery chains, checkpoint street races and fictional getaway scenarios authored against stable POI/road IDs.
- Garage save schema, owned cars, currency, buying, upgrade parts, torque/suspension/gearing/tyre tuning and recovery rules.
- Streaming-safe save/load and a consistent physics activation budget; cars around the player retain rigid-body simulation.
- Rolling volumetric fog from the bay, dynamic solar lighting, rain accumulation, puddle reflections, material wetness and streetlight scheduling.
- Body panel dents, scratch decals, glass fracture, wheel alignment damage and engine condition with repair costs.

## Story outline (design, not implemented)

Four fictional local characters anchor a small branching campaign:

- Maya Chen, a North Beach night-shift cook: urgent supply deliveries versus helping a stranded neighbour.
- Luis Ortega, a Sunset mechanic: earn trust through careful driving or prioritize quick cash; unlock garage parts.
- June Mercer, a Russian Hill photographer: scenic dawn routes and timed shoots, with optional detours to document the city.
- Theo Brooks, a waterfront dispatcher: time-sensitive taxi/delivery work and a final fictional getaway branch.

Each mission asset references graph nodes/POIs, prerequisites, objective types, dialogue keys and branch outcomes. The mission subsystem should consume these records without depending on a city name. Branch effects change relationship values and later mission availability. Narrative names and events here are fictional.

## Production quality gates

Photorealism, full-city coverage and the requested ambient/gameplay systems need substantial art, engine integration and play testing. Do not mark them complete based on configuration flags or these design notes. Track milestones with actual captures, packaged builds, performance measurements and route-specific handling tests.
