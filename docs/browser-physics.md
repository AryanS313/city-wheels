# City Wheels simulation v0.3 integration

Runtime modules: `physics.js`, `traffic.js`, `pursuit.js`. Keep all three together. Dependencies remain `cannon-es@0.20.0` and `earcut@3.0.2`.

```js
import {CitySimulation} from './physics.js';
import {PursuitSystem} from './pursuit.js';
const sim = new CitySimulation(city, {trafficCount:40,policeCount:4,parkedCount:16});
const pursuit = new PursuitSystem(sim,city);
// Physics owns the pursuit clock. Do not also call pursuit.update from rendering.
sim.step(deltaSeconds);
```

## Fleet and ownership

- `sim.vehicle` remains the currently controlled player record.
- `sim.traffic` contains every other moving, parked or abandoned physical car. `trafficCount:40` includes the four patrol units; `parkedCount:16` adds parked targets. The real package creates57 total cars including the player.
- `sim.allVehicles` is a stable array containing stable record identities. Keep render objects keyed by `record.id` or `record.body.id`; theft does not create, delete or move bodies.
- Every record has `id` (stable string), `body.id` (numeric), `role:'civilian'|'police'`, `profile:{name,color,powerMultiplier,mass,gripMultiplier,style}`, `tuning:{power,grip,brakes}`, `parked`, `abandoned`, existing body/raycast/wheels/health/damage fields, and controls.
- Civilian profiles have different mass, torque multiplier and tyre grip. Names/colors are fictional gameplay tuning, not claims about the licensed visual car's actual engineering specs. Shape/model is shared; visual variation comes from paint/profile identity.
- Profiles, damage and tuning stay attached to the physical car through theft.
- `body.vehicleId` is the stable string. Collision events retain numeric `vehicleId:body.id` and add `vehicleKey:record.id`. Collision `player` is evaluated against the current owner at impact time.

`sim.canTakeVehicle(target)` and `sim.takeVehicle(target)` accept a record, numeric body ID or stable record ID. Both require distance≤7m and both absolute speeds plus relative speed≤12km/h. Taking a vehicle returns `{ok:true,vehicle,previous}` or `{ok:false,reason,...}`. The old car becomes abandoned/parked and brakes physically; the target becomes the player car at its existing position and velocity. Ownership changes do not repair damage, alter tuning, teleport, or automatically report a police incident.

The gameplay module owns the1.25-second hold-E interaction and the displaced driver's ambient animation. After successful takeover, call `life.spawnOccupant(target)` and report the theft. There is no on-foot player-avatar mode in this implementation.

## Pedestrian and theft incidents

Forward each newly emitted player incident once:

```js
pursuit.reportIncident({
  type:'pedestrian-impact',outcome:'injured',severity:1,
  position:[worldX,elevation,worldZ],player:true,vehicleId:sim.vehicle.body.id
});
// Also accepts type:'injury'|'fatality'|'theft' and severity1|2|3.
```

`outcome:'fatal'`/fatality implies severity2; injury/theft implies1 when severity is omitted. `outcome:'stagger'`, severity0 and `player:false` are ignored. Theft reporting belongs to root gameplay to avoid duplicates. A stolen police car can use severity3. `sim.pedestrianBodies` remains the preferred traffic-hazard list; body.isPedestrian is the fallback.

## Pursuit

Public fields/getters:

- `state`: `idle`, `pursuit`, `search`, `busted`.
- `severity`:0–3; `wanted`:boolean.
- `unseenSeconds`, `escapeRemaining`: the continuous escape countdown.
- `captureProgress`:0–1; `captureSeconds`: accumulated close/slow time.
- `officers`: currently nonplayer/nonabandoned police records.
- `events`: recent events with monotonic `sequence`, `type`, `time`, `state`, `severity`. Types include `wanted`, `searching`, `spotted`, `cleared`, `busted`, `reset`.

Police chase with engine, steering and brake forces. Directed graph A* routes lead toward the last known position; a short unobstructed final approach follows the actual suspect. Cops can maneuver around stopped queues. Buildings, terrain and actual props block line of sight. No police vehicle position or velocity is assigned by pursuit control.

Defaults: sight125m, sight checks every.20s, continuously unseen60s clears wanted, dispatch grace2.5s, capture requires3s continuously within6.5m of a seeing officer while player speed≤6km/h and officer speed≤14km/h. Any sighting resets the full60-second timer; moving away or accelerating resets capture progress. BUSTED disables player throttle and brakes the vehicle. Police lights are exposed as `record.policeLights`.

Optional constructor config keys: `evadeSeconds`, `captureSeconds`, `captureDistance`, `captureMaxSpeedKph`, `copCaptureMaxSpeedKph`, `sightDistance`, `sightInterval`, `dispatchGraceSeconds`. Tests shorten selected rules; normal play should keep60s evade/3s capture.

`pursuit.reset()` clears wanted and returns police to patrol routing. `sim.reset()` calls it and repairs/repositions the currently owned player car, finding a clear road spot if the original abandoned car occupies the spawn. `sim.reset()` returns false during pursuit/search, preventing wanted-level escape through recovery; BUSTED restart and idle recovery remain available. `sim.reset({force:true})` is an explicit internal override for a full session reset.

## Ground and props

The v0.2 continuous heightfield, exact concave/courtyard colliders, narrow visible-prop obstacle API and low car roof collider remain. Use `terrainRenderData` and `sampleElevation(east,north)` exactly as before. Add visible poles/trees through `sim.addObstacles(layout)` after generating the layout from the physical ground.

Parked cars are placed only on roads at least9.75m wide, inside the road edge, spaced10m from other vehicles and away from known intersections. Moving traffic combines near-player density with farthest-point coverage across the tile.

## Validation

Run `npm test --prefix web`. The checked-in test suite resolves the bundled SF package automatically; `CITY_WHEELS_CITY=/absolute/path/city.json` can select another compatible fixture.

Tests cover real-road driving, surfaces, collision geometry, pedestrian braking, ownership swaps and constraints, injury/fatality dispatch, wall-blocked sight, continuous60s escape/reset, sustained capture/restart, and physical police movement. Real SF has40 moving cars/four patrol units plus16 physical parked targets, spreading more than750m in both map axes. An actual stationary-suspect run was physically caught at12.13s with57 bodies; active pursuit measured about5.5ms mean/8.0ms p95 physics per step, with occasional17ms spikes. Rendering, ambient pedestrians and other hardware add separate cost.

This is arcade gameplay with prototype traffic/pursuit control, not a full GTA simulation, comprehensive traffic-law engine or real-world injury model. Traffic can queue or get trapped in difficult maneuvers; police use road paths and real body movement instead of guaranteed instant arrival.
