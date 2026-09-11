# City Wheels browser simulation v0.2

Copy `physics.js` and `traffic.js` together into the browser source directory. Dependencies are `cannon-es@0.20.0` and `earcut@3.0.2`.

## Ground and rendering

- The physical ground is one continuous heightfield. There are no overlapping road boxes or vertical road-segment end caps.
- Real road elevations are rasterized onto the DEM with a smooth shoulder blend. The real SF collider has513×513 height samples at1.953125m spacing; steep grades remain elevation-driven.
- `sim.terrainRenderData` exposes `{width,height,cellSize,bounds:{minX,minY},heights}` at the exact collider resolution. Rows run south to north.
- Use ground vertices `[east,height,-north]` and triangles `[SW,SE,NW]`, `[SE,NE,NW]`, matching Cannon's triangle diagonal.
- Road ribbon vertices must use `sim.sampleElevation(east,north)+0.025` for their visual elevation. Do not retain the old independent road-box top elevations.
- `sim.terrainRenderHeights` and `sim.terrainHeights` remain the native257×257 height array for compatibility. Use `terrainRenderData` for exact ground rendering.
- Building collision uses triangle prisms from the actual footprint, including `footprintHoles`. Concave alleys and courtyards remain open; there is no convex-hull cap.

## Props and pedestrian integration

```js
const sim = new CitySimulation(city, { trafficCount: 18 });
const layout = createStreetLayout(city, sim.sampleElevation.bind(sim));
sim.addObstacles(layout);
// Positions below are renderer/world positions, not city north-up coordinates.
sim.addObstacles([{id:'streetlight-1',type:'pole',position:[east,groundElevation,south],radius:.13,height:6}]);
sim.pedestrianBodies = ambient.people.map(p => p.body);
```

Obstacle types `pole`, `tree` and `bollard` have narrow vertical cylinder colliders with the supplied radius and height. A `barrier` uses supplied width/depth/height and headingRadians. Position is the ground/base position. Only actual supplied visible props are created. IDs are preserved on collision events. These props currently stay anchored rather than breaking off.

Traffic reads `sim.pedestrianBodies`, constructor `options.pedestrians`, or falls back to `world.bodies` with `body.isPedestrian=true`.

## Vehicle and impacts

The existing player body/raycast/wheel APIs, controls, reset and weather interfaces remain compatible. The chassis center of mass and wheel locations are unchanged. Collision boxes now fit the low detailed model: main body bounds X±.865m, Y[-.30,.12]m, Z[-2.246,1.894]m; cabin roof tops at+.43m, removing the old invisible+.88m roof. Body center settles about0.5m above road; the renderer should preserve the same chassis origin and wheel transforms.

`record.damage = {front,rear,left,right}` stores cumulative local damage. `record.health` retains its0–1 range. Small scrapes do not reduce engine power; significant front damage progressively reduces it. Low-speed bumper impacts preserve driveability. Rolling resistance is a speed-opposing force; service brakes have no implicit always-on force.

Collision events include `{type:'collision',player,vehicleId,otherId,obstacleId,impact,energy,damage,zone,hitPosition:[x,y,z],normal:[x,y,z],time}`. `player` distinguishes player and ambient traffic effects. Momentum transfer comes from the dynamic collision solver, not scripted velocity cancellation. Events are retained in the existing short recent-event array.

## Traffic

18 cars are spawned on nearby eligible lanes by default. All use the same1450kg rigid-body/raycast vehicle model as the player. Directed OSM graph edges connect across way ends; lane-offset waypoints and speed-dependent steering lookahead drive the bodies with engine/brake forces. Routing prefers turns back into the tile before its edges. Following distance and pedestrian checks brake for hazards, and deterministic junction priority avoids mutual yielding. No per-frame position assignments or visible teleports move traffic. Physically trapped cars may attempt a short reverse maneuver.

This remains prototype traffic: complex intersections, turn restrictions and signal phases are not a complete traffic-law simulation. Some cars can queue, reach genuine dead ends, or get trapped during tight maneuvers.

## Tests

`npm test` runs19 tests, including real SF60-second driving with18 dynamic cars, road grade and surface grip, concave openings/courtyards, actual pole/trunk collisions, pedestrian braking, momentum transfer, damage zones and coasting. To run after copying, set `CITY_WHEELS_CITY=/absolute/path/city.json` and keep `benchmark-city.js` plus `long-smoke.js` beside `physics.test.js`.

`node web/test/long-smoke.js /absolute/path/city.json` prints detailed real-data performance. Latest development run: about600ms initialization,451m across12OSM ways in60seconds, full player health, longest unexplained throttle stall0.067seconds; average physics2.12ms/p953.33ms with18 cars. Browser/rendering cost and other hardware are separate.

## Ambient and visual integration

See `web/src/main.js` for the complete startup sequence. Await the detailed car GLB, then create the same furniture descriptors for renderer and physics, and register the pedestrian bodies. `life.update(dt)` runs after `sim.step(dt)` to synchronize articulated meshes. The ambient controller queues forces on the world's fixed-step callback; it must not be stepped twice.

The real-city regression now runs the full 60 simulated seconds with 18 traffic cars, 42 pedestrians and the generated solid furniture. Collision tests additionally exercise narrow poles/trunks, concave alleys, courtyard holes, car momentum, low-impact engine health, and pedestrian toppling/recovery. Detailed car validation checks real model geometry and panel deformation in Node with textures disabled; it does not validate browser shaders.
