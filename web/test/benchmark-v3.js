import fs from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { CitySimulation } from "../src/physics.js";
import { PursuitSystem } from "../src/pursuit.js";
const city = JSON.parse(
  fs.readFileSync(
    process.argv[2] || "../../data/cities/san-francisco/city.json",
    "utf8",
  ),
);
const start = performance.now(),
  sim = new CitySimulation(city, { trafficCount: 40, parkedCount: 16 }),
  p = new PursuitSystem(sim, city);
console.log(
  "init",
  performance.now() - start,
  "vehicles",
  sim.allVehicles.length,
  "police",
  p.officers.map((c) => ({
    id: c.body.id,
    p: c.body.position,
    d: c.body.position.distanceTo(sim.vehicle.body.position),
  })),
);
sim.controls.brake = 1;
for (let i = 0; i < 60; i++) sim.step(1 / 60);
p.reportIncident({
  outcome: "injured",
  severity: 1,
  position: sim.vehicle.body.position,
  player: true,
});
const times = [];
for (let i = 0; i < 1200; i++) {
  const t = performance.now();
  sim.step(1 / 60);
  times.push(performance.now() - t);
  if (i % 300 === 299)
    console.log(
      "t",
      (i + 1) / 60,
      "state",
      p.state,
      "unseen",
      p.unseenSeconds,
      "capture",
      p.captureProgress,
      "police",
      p.officers.map((c) => ({
        distance: c.body.position.distanceTo(sim.vehicle.body.position),
        speed: c.body.velocity.length() * 3.6,
        moved: c.distance,
        visual: c.hasVisualTarget,
        controls: c.controls,
      })),
    );
}
times.sort((a, b) => a - b);
console.log({
  state: p.state,
  mean: times.reduce((a, b) => a + b, 0) / times.length,
  p95: times[Math.floor(times.length * 0.95)],
  max: times.at(-1),
  events: p.events,
});
assert.equal(p.state, "busted");
assert.ok(
  p.events.find((e) => e.type === "busted").time > p.config.captureSeconds,
);
assert.ok(p.officers.some((o) => o.distance > 40));
sim.dispose();
