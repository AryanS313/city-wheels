# City life, businesses and collision outcomes

# City places v0.3

`places.js` exports two functions and needs only the existing Three.js dependency:

```js
import { createCityPlaces, createPlaceVisuals } from './places.js';
const districtPlaces = createCityPlaces(city, groundAt, {streetObjects:objects});
sim.addObstacles(districtPlaces.obstacles);
view.scene.add(createPlaceVisuals(districtPlaces.places));
life = new AmbientLife(city, sim, view.scene, {
  objects:[...objects,...districtPlaces.obstacles],
  activitySpots:districtPlaces.activitySpots,
  count:150
});
```

All exported positions use metres `[east, elevation, south]`. `groundAt(east,north)` is the same elevation sampler used by the simulation. `createPlaceVisuals` returns a Three.js **Group directly**, not `{group}`. The `places` entries expose `id`, `kind`, `name`, `position`, `yaw`, `buildingId`, `roadId`, `street`, `source`, `fictional`, `props`, and `activityIds`, suitable for minimap labels and interactions.

`createCityPlaces` returns `{places,activitySpots,obstacles,statistics,coordinateSystem,clearWalkingMargin}`. Defaults create 38 venues and five fictional public rest pockets. Options allow `maxPlaces` and `restAreas` changes. The result is deterministic from the supplied city package.

`activitySpots` entries use:

```js
{
  id, placeId, type:'chat'|'coffee'|'dine'|'rest',
  position:[east,ground,south], facing, capacity, label,
  participants:[{
    position:[east,ground,south], facing,
    posture:'seated'|'resting', // absent for standing chat
    seatHeight:0.44,
    ownObstacleId, ignoreObstacleIds
  }]
}
```

Participants are actual seat/standing positions, not table centers. Their `facing` uses Three.js yaw about +Y from local +Z; for dining it points toward the table. A seated activity intentionally occupies its own chair, so the ambient validation must exempt `ownObstacleId`. Each dining participant additionally supplies `ignoreObstacleIds:[chairId,tableId]`: conservative circular exclusion envelopes overlap at these closely arranged seats even though the visible oriented rectangles do not. These exemptions concern the person's activity selection, not vehicle collision. Table and chair collision boxes remain solid for vehicles. A chair collision box ends at the visible seat top (0.475 m), leaving the seating cavity above it empty; its narrow visual backrest is not represented as a tall solid box.

`obstacles` also use the current simulator contract: `{id,type:'barrier',position,width,depth,height,headingRadians,radius,...}`. Position is the **ground point**, not the collision-shape center; `sim.addObstacles` adds half the height. `halfExtents`, `rotation`, and `kind` are additional metadata. Rendered tables/chairs/planters/mats/backpacks use these exact positions, orientations and ground references. Cups/plates/salad are decorative table-top objects. Signs/doorframes/awnings attach to existing building frontages and are not additional ground obstacles.

The placement logic finds outward-facing footprint edges near actual roads. It avoids existing poles/trees/bollards, building footprints and road corridors. Furniture uses a reserved 1.45 m clear corridor beside the road before placement; measured minimum furniture-corner clearance in the exported SF package is 1.593 m. Seating is omitted from cramped frontages. The source road/terrain geometry is unchanged.

The placement descriptors are regenerated from the shared city package at startup. At delivery it includes 38 venues (nine cafes, ten restaurants, nine hotels, ten homes), five quiet rest areas, 16 actual OSM-tagged venue names, and fictional additions. The exact activity/furniture totals are recorded in its `statistics` object. Geometry generation yields 38 sign meshes plus eight instanced prop batches, keeping the canopy stripes and furniture out of hundreds of independent draw objects.

## Naming and respectful presentation

Actual names are used only when the supplied OSM building has a compatible `amenity`/`tourism` tag and `name`: for example the cafe name Saint Frank and the hotel/restaurant names already present in the city package. This is a snapshot of supplied map tags, not a current directory, business affiliation, or claim that depicted doors, awnings, menus or seating are accurate.

All fallback businesses (Switchback Coffee, Baylight Coffee, Corner Cup, Fogbank Cafe, Morning Climb, Juniper Coffee, Hilltop Espresso, Blue Door Cafe, Northside Noodles, Terrace Kitchen, Sea Glass Kitchen and The Evening Table) are **fictional game scenery** placed on geographic building footprints. Residential decorations are fictional and may use a public OSM house number. This code does not invent named people or claim who lives at a house. Named unrelated landmarks, schools, religious buildings, shops and other incompatible tagged facilities are excluded from fallback venue conversion.

Quiet rest pockets and their personal belongings are also fictional. Their descriptors explicitly present a resident taking a rest with the same interactions and vulnerability as other residents. They do not assert real unhoused residents' locations, create an objective to harm or displace anyone, or apply a different collision/damage value. The ambient-life implementation controls the people; this module supplies only safe resting positions, a mat and backpack.

## Validation run

From the repository root:

```sh
node --test web/test/places.test.js
```

Six tests passed: deterministic venue distribution; real-name provenance; every furniture corner against every road segment; every furniture corner against all building footprints; activity coordinates/seating references; and bounded instanced visual geometry. It is a Node geometry/data test, with text textures omitted when no browser Canvas exists. Browser rendering and live interaction were not executed in this bounded task.


# Ambient life v0.3

The implementation is in `web/src/ambient.js`; tests are in `web/test/ambient.test.js`. It shares `places.js` and `physics.js`.

```js
const streetObjects = createStreetLayout(city, (e,n) => sim.sampleElevation(e,n));
const places = createCityPlaces(city, (e,n) => sim.sampleElevation(e,n), {streetObjects});
const objects = [...streetObjects, ...places.obstacles];
sim.addObstacles(objects);
const life = new AmbientLife(city, sim, scene, {
  objects,
  count: 150,
  activitySpots: places.activitySpots,
});
// After each simulation frame:
sim.step(dt);
life.update(dt);
for (const event of life.events.splice(0)) {
  // The gameplay module owns event forwarding; the module does not report to pursuit itself.
  if (event.player && ['injured','fatal'].includes(event.outcome)) {
    sim.pursuit.reportIncident(event);
  }
}
// Theft: returns an alarmed, physically collidable exited driver or null if no clear anchor.
const formerDriver = life.spawnOccupant(stolenVehicleRecord);
// Explicit game restart only:
life.reset();
```

The constructor accepts `objects`, `count`, and `activitySpots`. The street layout and street visual exports remain compatible with v0.2. Every person is a 75 kg dynamic body tagged `isPedestrian=true`, `personId`, and collision group 4/mask -1 by default. `sim.pedestrianBodies` refreshes from the world's tagged bodies on spawn/reset/dispose, including newly exited occupants and any externally tagged player body. The module uses `sim.playerBody.position` for animation/AI distance when present, falling back to the currently owned car.

World coordinates are `[east,elevation,south]`. Place participant `facing` is THREE yaw measured from local +Z; people face local -Z, so their body yaw is `facing + Math.PI`. Dining faces the table, verified by a dot-product test. Seated capsules are shorter and rest on chair seat geometry; the visual offset puts hips near the seat. Low `posture:'resting'` mat participants sit with legs extended. Participant `ignoreObstacleIds` allows the person's own seat/mat and table during spawn validation. The places module represents chair collision only to the actual seat top, leaving the seating cavity above it empty.

Population covers the entire tile: 150 residents occupy all 25 cells of a 5×5 grid. Current real-city integration produces 58 walking, 29 chatting, 23 holding/drinking coffee, 29 dining, and 11 resting; 56 are attached to business/rest spots, with 36 seated. Clothing, skin tone, hair, and accessories vary independently. Fictional unhoused residents rest with ordinary clothing and personal belongings; they share exactly the same mass, behavior rules, collision outcome tuning, and vulnerability as everyone else. This makes no claim about real residents or their locations.

The residents render through four instanced body-geometry batches. Nearby limbs animate each frame; distant animation updates at bounded rates, and fine facial details are omitted beyond 85 m. Every body remains physical throughout the district. No existing person is teleported for distance management. The latest headless smoke simulated 20 seconds with all 150 people and fixtures in 5.8 seconds, including simulation and animation matrix updates (about 4.8 ms per fixed step on this environment). All 58 walkers moved; all residents stayed finite and in valid ground contact. This is a CPU smoke result, not a browser/GPU frame-rate claim.

Collision events use the following schema and are queued once per meaningful contact/outcome:

```js
{
  type: 'pedestrian-impact',
  outcome: 'stagger' | 'injured' | 'fatal',
  severity: 0 | 1 | 2,
  vehicleId: body.id,            // numeric, stable physical body ID
  vehicleKey: body.vehicleId,   // optional stable display key
  player: body === sim.vehicle.body,
  position: [x, y, z],
  personId, pedestrianId, impactMps, relativeSpeedMps, time
}
```

`PEDESTRIAN_IMPACT_TUNING` is explicitly arcade game tuning, not a model of real-world injury risk. The current values classify normal impacts from 1.6 m/s as stagger, from 6 m/s as injured, and as fatal only when relative speed is at least 15 m/s and normal impact is at least 11 m/s. Minor stumbles can recover after the striker clears. Injured/fatal bodies remain down and preserve their state; no timer revives them. Later separate severe contact can advance injured to fatal once. `reset()` intentionally rebuilds a healthy population and clears incident events as part of a game restart. No gore or medical realism is claimed.

`spawnOccupant(record)` (alias `exitOccupant`) creates an alarmed resident at the nearest validated sidewalk anchor 4.4–16 m from the vehicle. It deduplicates by stable vehicle ID and permits at most 32 extra occupants. This is a readable exit reaction, not a door-to-sidewalk animation. Calling it does not change ownership or report an incident; the gameplay module owns those actions.

Seven tests pass: deterministic furniture, full-district dispersion/activity/instancing, seated facing, explicit impact classification, persistent outcomes and reset, real low-speed physical recovery, updated player ownership, exited-driver hazard registration, and actual high-speed contacts yielding one persistent injured/fatal event. This version has not received a new browser visual play-test.
