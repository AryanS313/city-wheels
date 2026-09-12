import fs from "node:fs";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import { PursuitSystem } from "../src/pursuit.js";
const city = JSON.parse(
  fs.readFileSync(
    process.argv[2] ||
      new URL("../../data/cities/san-francisco/city.json", import.meta.url),
    "utf8",
  ),
);
const duration = Number(process.argv[3] || 120),
  sim = new CitySimulation(city, { trafficCount: 40, parkedCount: 16 }),
  pursuit = new PursuitSystem(sim, city, { captureSeconds: 3 });
const timings = [],
  issues = [],
  start = performance.now(),
  ids = sim.allVehicles.map((v) => v.body.id),
  bodyCount = sim.world.bodies.length;
let peakSpeed = 0,
  peakAngular = 0,
  peakHeap = 0;
const finite = (v) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const sample = (label) => {
  global.gc?.();
  const heap = process.memoryUsage().heapUsed / 1048576;
  peakHeap = Math.max(peakHeap, heap);
  const pillars =
    sim.terrainCacheStats?.entries ??
    Object.keys(sim.groundBody.shapes[0]._cachedPillars || {}).length;
  console.log(
    JSON.stringify({
      label,
      elapsed: sim.elapsed,
      heapMB: heap,
      pillars,
      bodies: sim.world.bodies.length,
      contacts: sim.world.contacts.length,
      peakSpeed,
      peakAngular,
      state: pursuit.state,
    }),
  );
};
sim.controls.brake = 1;
for (let i = 0; i < 120; i++) sim.step(1 / 60);
sample("settled");
// Controlled valid theft setup: stage the player behind each actual city target,
// outside both chassis bounds, preserving57 bodies and all target variety.
let swaps = 0;
for (const target of [...sim.allVehicles].filter((v) => v !== sim.vehicle)) {
  pursuit.reset();
  target.parked = true;
  target.body.velocity.setZero();
  target.body.angularVelocity.setZero();
  const backward = target.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, 6.2));
  sim.vehicle.body.position.copy(target.body.position.vadd(backward));
  sim.vehicle.body.position.y =
    sim.sampleElevation(
      sim.vehicle.body.position.x,
      -sim.vehicle.body.position.z,
    ) + 0.54;
  sim.vehicle.body.quaternion.copy(target.body.quaternion);
  sim.vehicle.body.velocity.setZero();
  sim.vehicle.body.angularVelocity.setZero();
  sim.vehicle.body.aabbNeedsUpdate = true;
  const old = sim.vehicle,
    position = target.body.position.clone(),
    quaternion = target.body.quaternion.clone(),
    velocity = target.body.velocity.clone(),
    controls = sim.controls;
  const result = sim.takeVehicle(target);
  assert.equal(result.ok, true, `${target.id}: ${result.reason || "accepted"}`);
  swaps++;
  assert.ok(target.body.position.almostEquals(position));
  assert.ok(target.body.velocity.almostEquals(velocity));
  assert.ok(
    target.body.quaternion.almostEquals?.(quaternion) ??
      target.body.quaternion.x === quaternion.x,
  );
  assert.equal(sim.controls, controls);
  assert.ok(sim.traffic.includes(old));
  assert.ok(!sim.traffic.includes(target));
  assert.equal(new Set(sim.allVehicles).size, 57);
  assert.equal(new Set(sim.traffic).size, 56);
  assert.equal(sim.world.bodies.length, bodyCount);
  assert.ok(Number.isFinite(sim.headingRadians));
  assert.ok(Number.isFinite(sim.speedKph));
  sim.controls.brake = 1;
  for (let i = 0; i < 3; i++) sim.step(1 / 60);
  for (const car of sim.allVehicles)
    if (!finite(car.body.position) || !finite(car.body.velocity))
      issues.push({
        type: "nonfinite-after-theft",
        target: target.id,
        car: car.id,
      });
}
sample(`thefts:${swaps}`);
// Resume the fleet and restart from a legitimate free road position.
for (const car of sim.traffic) {
  if (car.role === "police") car.abandoned = false;
  if (!car.abandoned && !car.parked) sim.trafficNetwork.rejoin(car);
}
sim.reset({ force: true });
sim.controls.brake = 1;
for (let frame = 0; frame < duration * 60; frame++) {
  if (frame % 1200 === 0) {
    pursuit.reset();
    pursuit.reportIncident({
      type: "theft",
      severity: 2,
      position: sim.vehicle.body.position,
    });
  }
  if (pursuit.state === "busted") sim.reset();
  const t = performance.now();
  sim.step(1 / 60);
  timings.push(performance.now() - t);
  for (const car of sim.allVehicles) {
    const b = car.body;
    peakSpeed = Math.max(peakSpeed, b.velocity.length());
    peakAngular = Math.max(peakAngular, b.angularVelocity.length());
    if (
      !finite(b.position) ||
      !finite(b.velocity) ||
      !finite(b.angularVelocity) ||
      !Number.isFinite(b.quaternion.w)
    )
      issues.push({ type: "nonfinite", frame, car: car.id });
  }
  if (frame % 1200 === 1199) sample(`run:${(frame + 1) / 60}`);
}
timings.sort((a, b) => a - b);
sample("final");
console.log(
  JSON.stringify({
    swaps,
    issues,
    wallMs: performance.now() - start,
    meanMs: timings.reduce((a, b) => a + b, 0) / timings.length,
    p95Ms: timings[Math.floor(timings.length * 0.95)],
    maxMs: timings.at(-1),
    peakHeap,
    idsUnchanged:
      JSON.stringify(ids) ===
      JSON.stringify(sim.allVehicles.map((v) => v.body.id)),
  }),
);
assert.equal(issues.length, 0);
sim.dispose();
