import fs from "node:fs";
import * as CANNON from "cannon-es";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { CitySimulation } from "../src/physics.js";
const dataPath =
  process.argv[2] ||
  new URL("../../data/cities/san-francisco/city.json", import.meta.url);
const city = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const before = performance.now();
const sim = new CitySimulation(city, { trafficCount: 6 });
const initialized = performance.now();
console.log(
  JSON.stringify(
    {
      initializationMs: initialized - before,
      roads: city.roads.length,
      segments: sim.segments.length,
      buildings: city.buildings.length,
      staticBodies: sim.staticBodies.length,
      physicsBodies: sim.world.bodies.length,
      traffic: sim.traffic.length,
      heapMB: process.memoryUsage().heapUsed / 1024 / 1024,
      spawnPosition: sim.vehicle.body.position,
    },
    null,
    2,
  ),
);
sim.controls.brake = 1;
const timings = [];
for (let i = 0; i < 120; i++) {
  const t = performance.now();
  sim.step(1 / 60);
  timings.push(performance.now() - t);
}
const settled = sim.vehicle.body.position.clone();
console.log(
  "settled",
  settled,
  "ground",
  sim.sampleElevation(settled.x, -settled.z),
  "wheels",
  sim.vehicle.raycast.numWheelsOnGround,
);
assert.ok(
  sim.vehicle.raycast.numWheelsOnGround >= 2,
  "Spawn must settle with tyres on a road",
);
assert.ok(sim.vehicle.health > 0.95, "Spawn must not cause damage");
sim.controls.brake = 0;
sim.controls.throttle = 1;
const route = city.roads.find((r) => r.id === city.spawn.roadId).points;
for (let i = 0; i < 300; i++) {
  const car = sim.vehicle.body;
  let best = 0,
    distance = Infinity;
  for (let j = 0; j < route.length; j++) {
    const p = route[j],
      d = Math.hypot(p[0] - car.position.x, p[1] + car.position.z);
    if (d < distance) {
      best = j;
      distance = d;
    }
  }
  const targetIndex = Math.min(
    route.length - 1,
    best + Math.max(2, Math.ceil(((sim.speedKph / 3.6) * 0.65) / 5)),
  );
  const target = route[targetIndex],
    previous = route[Math.max(0, targetIndex - 1)];
  const dx = target[0] - previous[0],
    dy = target[1] - previous[1],
    len = Math.hypot(dx, dy) || 1;
  const local = car.pointToLocalFrame(
    new CANNON.Vec3(
      target[0] + (dy / len) * 1.2,
      target[2],
      -target[1] + (dx / len) * 1.2,
    ),
  );
  sim.controls.steer = Math.max(
    -1,
    Math.min(1, Math.atan2(local.x, -local.z) * 2.2),
  );
  const t = performance.now();
  sim.step(1 / 60);
  timings.push(performance.now() - t);
  if (i % 60 === 59)
    console.log(
      "drive",
      i / 60 + 1 / 60,
      sim.speedKph,
      sim.vehicle.body.position,
      sim.vehicle.health,
      sim.currentRoad?.road.name,
    );
}
const displacement = sim.vehicle.body.position.distanceTo(settled);
assert.ok(
  displacement > 15,
  `Must accelerate along real road; moved only ${displacement}m`,
);
assert.ok(
  sim.vehicle.health > 0.95,
  "Five-second route-following road drive should avoid collisions",
);
assert.ok(
  sim.speedKph > 35,
  "Five-second road drive must accelerate above35km/h",
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      displacement,
      speedKph: sim.speedKph,
      health: sim.vehicle.health,
      stepMeanMs: timings.reduce((a, b) => a + b, 0) / timings.length,
      stepP95Ms: timings[Math.floor(timings.length * 0.95)],
      stepMaxMs: timings.at(-1),
      heapMB: process.memoryUsage().heapUsed / 1024 / 1024,
    },
    null,
    2,
  ),
);
sim.dispose();
