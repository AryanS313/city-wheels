import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { CitySimulation } from "../src/physics.js";
import { createStreetLayout, AmbientLife } from "../src/ambient.js";
import { createCityPlaces } from "../src/places.js";
import { PursuitSystem } from "../src/pursuit.js";
import { DrivingSession } from "../src/gameplay.js";

test("dense SF city connects pedestrian incidents, physical pursuit, BUSTED and a healthy restart", () => {
  const city = JSON.parse(
    fs.readFileSync(
      new URL("../../data/cities/san-francisco/city.json", import.meta.url),
    ),
  );
  const sim = new CitySimulation(city, { trafficCount: 40, parkedCount: 16 });
  const street = createStreetLayout(city, sim.sampleElevation.bind(sim));
  const places = createCityPlaces(city, sim.sampleElevation.bind(sim), {
    streetObjects: street,
  });
  const objects = [...street, ...places.obstacles];
  sim.addObstacles(objects);
  const life = new AmbientLife(city, sim, new THREE.Scene(), {
    objects,
    count: 150,
    activitySpots: places.activitySpots,
  });
  sim.pedestrianBodies = life.people.map((p) => p.body);
  const pursuit = new PursuitSystem(sim, city),
    session = new DrivingSession(sim, life, pursuit);
  assert.equal(sim.allVehicles.length, 57);
  assert.equal(life.people.length, 150);
  assert.equal(pursuit.officers.length, 4);
  assert.ok(places.places.length >= 40);
  assert.ok(life.people.some((p) => p.activity === "coffee"));
  sim.controls.brake = 1;
  for (let i = 0; i < 60; i++) {
    sim.step(1 / 60);
    life.update(1 / 60);
    session.update(1 / 60);
  }
  // The ambient collision classifier is exercised by physical impact tests too.
  // Here the callback input isolates delivery of its outcome into the whole city.
  const person = life.people.find((p) => p.outcome === "healthy");
  life.handleVehicleImpact(person, sim.vehicle.body, 8, 10);
  session.update(1 / 60);
  assert.equal(person.outcome, "injured");
  assert.ok(session.wanted);
  const officerStart = pursuit.officers.map((o) => o.body.position.clone());
  let steps = 0;
  const timings = [];
  while (!session.busted && steps < 2400) {
    const start = performance.now();
    sim.step(1 / 60);
    life.update(1 / 60);
    session.update(1 / 60);
    timings.push(performance.now() - start);
    steps++;
  }
  assert.equal(
    session.busted,
    true,
    `Police did not arrest a stopped driver in ${steps / 60}s; state=${pursuit.state}`,
  );
  assert.ok(
    pursuit.officers.some(
      (o, i) => o.body.position.distanceTo(officerStart[i]) > 5,
    ),
  );
  assert.ok(session.events.some((event) => event.type === "busted"));
  assert.equal(
    person.outcome,
    "injured",
    "Serious injuries do not auto-recover during pursuit",
  );
  sim.vehicle.health = 0.3;
  session.restart();
  assert.equal(session.wanted, false);
  assert.equal(sim.vehicle.health, 1);
  assert.equal(life.people.length, 150);
  assert.ok(life.people.every((p) => p.outcome === "healthy"));
  assert.equal(sim.pedestrianBodies.length, 150);
  assert.ok(pursuit.officers.every((o) => !o.policeLights));
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      citySession: "passed",
      vehicles: 57,
      residents: 150,
      venues: places.statistics,
      bustedAtSeconds: steps / 60,
      meanStepMs: timings.reduce((a, b) => a + b, 0) / timings.length,
      p95StepMs: timings[Math.floor(timings.length * 0.95)],
    }),
  );
  life.dispose();
  sim.dispose();
});
