# City Wheels browser physics companion

This is the lightweight playable browser companion physics, not the Unreal Chaos implementation. It uses cannon-es 0.20.0, dynamic rigid bodies, gravity and four independently raycast spring/damper wheels per car.

```js
import { CitySimulation, VEHICLE_SPEC, sampleTerrain } from './physics.js';
const sim = new CitySimulation(cityData, { trafficCount: 6 });
sim.controls.throttle = 1; // [-1, 1], negative brakes then reverses
sim.controls.steer = 0.3;  // [-1, 1], positive turns right
sim.controls.brake = 0;    // [0, 1]
sim.controls.handbrake = false;
sim.setWeather(0.8);       // 0 dry, 1 wet, or boolean
sim.step(deltaSeconds);    // Internally advances at fixed 60 Hz, six-substep cap
carMesh.position.copy(sim.vehicle.body.position);
carMesh.quaternion.copy(sim.vehicle.body.quaternion);
for (let i=0; i<4; i++) {
  const wheel = sim.vehicle.wheels[i];
  wheelMesh[i].position.copy(wheel.worldTransform.position);
  wheelMesh[i].quaternion.copy(wheel.worldTransform.quaternion);
}
```

- Renderer/physics axes: X east, Y elevation, Z south. Car model front points local -Z; rotation zero points north. `spawn.headingRadians = Math.PI/2` points east.
- Input schema: `terrain:{width,height,cellSize,bounds:{minX,minY},heights}` with dimensions in samples and flattened rows south to north. `roads[].points` and `buildings[].footprint` use `{x:east,y:north,z:elevation}` or `[east,north,elevation]`. Road width is metres. `spawn` includes x/y/z plus headingRadians. `point` also accepts xEast/yNorth/zElev.
- Ground helper `sim.sampleElevation(east,north)` projects to the road ribbon inside a road, otherwise triangle-interpolates the DEM heightfield. `sampleTerrain(city,east,north)` returns raw terrain height. `sim.terrainHeights` contains DEM heights lowered slightly under roads to avoid the coarse DEM protruding through the roadway; use this array for terrain rendering.
- Chassis shape: 4.25m long, 1.78m wide, 0.55m tall, centered +0.16m Y from the center of mass. Cabin shape adds a box centered +0.64m Y. Wheels: radius .335m, track1.58m, front Z=-1.37, rear Z=1.31, chassis attachment Y=.05m, rest length .31m. Suspension settles body center approximately .5m above road.
- Road collision top is about road elevation +.06m. Collider is a sloped ribbon of short boxes under each road centerline segment. Rendering should use the same endpoint elevations. Dynamic terrain and road collisions support grade, gravity, airborne crests and suspension landings. Buildings use inset convex footprint hulls so diagonal walls do not block the street. Concavities/courtyards remain approximate. Roads and building hulls share64m compound collider chunks, avoiding per-body collision-matrix growth.
- `sim.speedKph`, `sim.signedSpeedKph`, `sim.gear` (integer or 'R'), `sim.rpm`, `sim.airborne`, `sim.headingRadians`, `sim.onRoad`, `sim.currentRoad.road.name`, `sim.vehicle.health` [0,1], and `sim.vehicle.distance` [m] support UI. `sim.events` retains the most recent 20 collision/landing events.
- Torque curve peaks at 285Nm, mass1450kg, rear drive, six gears, final drive3.70, physical aero drag. Explicit load-limited longitudinal grip fixes Cannon's straight-line friction edge case. Wetness affects grip per contacted wheel; available surface keys include asphalt/concrete/cobblestone/bricks/paving_stones/steel/cable_car_tracks/painted_lines/gravel/dirt/grass. Actual `city.railways` geometry is spatially indexed into two flush rail strips at ±half the OSM gauge (default1.067m); tyre contacts within.14m use steel grip, with an elevation check to avoid bridges affecting roads below. Rendered centerlines on two-way roads at least6m wide use painted-line grip within.10m. `sim.surfaceAt(east,north,elevation,baseSurface)` and `wheel.contactSurface` expose classification. Tyre slip has progressive lateral grip loss. Collision health reduces power and applies wheel-alignment steering pull.
- `sim.traffic` uses the same vehicle and tyre implementation, lane-offset road following and proximity braking. Preview traffic stops at the end of an OSM way; it does not claim complete city graph routing, signal compliance, cyclist/pedestrian awareness or lane merging.
- Initial cars have brakes released; set brake1 or handbrake true while menus are open on hills. Reset returns to the package spawn and repairs damage.
- `sim.dispose()` removes all vehicle callbacks and bodies.

## Validation

`npm test` runs Node's built-in test runner: triangle elevation, forward/reverse, steering signs, east-facing spawn, dry/wet braking, uphill acceleration, suspension landing, collision damage, reset and dynamic traffic. The real-city test runs when the bundled SF package is available, or set `CITY_WHEELS_CITY=/absolute/path/city.json`. `node benchmark-city.js /absolute/path/city.json` benchmarks initialization and420 physics frames, checks undamaged four-wheel spawn settling, then steers along Columbus Avenue for five seconds of acceleration. Real package measured ~140ms initialization,255 static bodies,52MB initial heap,0.47ms mean and0.77ms p95 physics step on the development machine (isolated GC/warm-up spikes exceed10ms).

Primary API reference: [cannon-es RaycastVehicle](https://pmndrs.github.io/cannon-es/docs/classes/RaycastVehicle.html). This implementation is an accessible prototype, not a validated automotive simulation or photorealistic UE5 build.
