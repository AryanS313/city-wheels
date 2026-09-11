import * as THREE from "three";
import { createStreetLayout, AmbientLife } from "../src/ambient.js";
import fs from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { CitySimulation } from "../src/physics.js";
const city = JSON.parse(
  fs.readFileSync(
    process.argv[2] ||
      new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  ),
);
const start = performance.now(),
  sim = new CitySimulation(city, { trafficCount: 18 });
const objects = createStreetLayout(city, sim.sampleElevation.bind(sim));
sim.addObstacles(objects);
const life = new AmbientLife(city, sim, new THREE.Scene(), {
  objects,
  count: 42,
});
sim.pedestrianBodies = life.people.map((p) => p.body);
console.log(
  "init",
  performance.now() - start,
  "traffic",
  sim.traffic.length,
  "buildingshapes",
  sim.buildingColliderCount,
);
sim.controls.brake = 1;
for (let i = 0; i < 90; i++) sim.step(1 / 60);
let best = null;
for (const edge of sim.trafficNetwork.edges)
  for (let i = 0; i < edge.points.length - 1; i++) {
    const p = edge.points[i],
      d = Math.hypot(
        p.x - sim.vehicle.body.position.x,
        p.y + sim.vehicle.body.position.z,
      );
    const a = edge.points[i + 1];
    const forward = sim.vehicle.body.vectorToWorldFrame({ x: 0, y: 0, z: -1 });
    if (
      (a.x - p.x) * forward.x - (a.y - p.y) * forward.z > 0 &&
      (!best || d < best.d)
    )
      best = { edge, index: i, d, seed: 1 };
  }
sim.trafficNetwork.attach(sim.vehicle, best);
sim.controls = sim.vehicle.controls;
const times = [];
let stalled = 0,
  maxStalled = 0,
  minSpeed = 100;
const visitedRoads = new Set();
for (let i = 0; i < 3600; i++) {
  sim.trafficNetwork.update(sim.vehicle, sim, 1 / 60);
  const t = performance.now();
  sim.step(1 / 60);
  life.update(1 / 60);
  times.push(performance.now() - t);
  visitedRoads.add(sim.currentRoad?.road.id);
  if (sim.speedKph < 1 && sim.controls.throttle > 0.3) {
    stalled += 1 / 60;
    maxStalled = Math.max(stalled, maxStalled);
  } else stalled = 0;
  if (i % 600 === 599)
    console.log(
      "t",
      (i + 1) / 60,
      "pos",
      sim.vehicle.body.position,
      "speed",
      sim.speedKph,
      "health",
      sim.vehicle.health,
      "distance",
      sim.vehicle.distance,
      "npcmoving",
      sim.traffic.filter((t) => t.body.velocity.length() > 1).length,
    );
}
times.sort((a, b) => a - b);
console.log({
  maxStalled,
  distance: sim.vehicle.distance,
  health: sim.vehicle.health,
  mean: times.reduce((a, b) => a + b, 0) / times.length,
  p95: times[Math.floor(times.length * 0.95)],
  max: times.at(-1),
  traffic: sim.traffic.map((t) => ({
    distance: t.distance,
    health: t.health,
    transitions: t.navigation.transitions,
    stuck: t.navigation.stuckTime,
  })),
});

assert.equal(sim.traffic.length, 18);
assert.ok(sim.vehicle.health > 0.95);
assert.ok(sim.vehicle.distance > 350);
assert.ok(maxStalled < 1);
assert.ok(visitedRoads.size >= 3, `visited only${visitedRoads.size} road ways`);
assert.ok(sim.traffic.filter((car) => car.distance > 100).length >= 10);
assert.ok(
  sim.traffic.every(
    (car) => Number.isFinite(car.body.position.y) && car.body.position.y > -10,
  ),
);
assert.ok(times[Math.floor(times.length * 0.95)] < 30);
console.log(
  "PASS real SF60s",
  visitedRoads.size,
  "roads;18dynamictraffic;42pedestrians;solidfurniture;no unexplained stall.",
);
