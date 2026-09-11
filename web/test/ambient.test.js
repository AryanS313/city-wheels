import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import {
  createStreetLayout,
  createStreetVisuals,
  AmbientLife,
} from "../src/ambient.js";

const city = JSON.parse(
  fs.readFileSync(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
    "utf8",
  ),
);

test("real SF layout is deterministic and every rendered furniture item has a physical descriptor", () => {
  const sim = new CitySimulation(city, { trafficCount: 0 });
  const elevation = (x, y) => sim.sampleElevation(x, y);
  const objects = createStreetLayout(city, elevation);
  assert.deepEqual(objects, createStreetLayout(city, elevation));
  assert.ok(objects.length > 200);
  assert.equal(new Set(objects.map((o) => o.id)).size, objects.length);
  for (const o of objects) {
    assert.ok(["pole", "tree", "bollard", "barrier"].includes(o.type));
    assert.ok(o.position.every(Number.isFinite));
    assert.ok(o.radius > 0 && o.height > 0);
    assert.ok(
      Math.abs(o.position[1] - elevation(o.position[0], -o.position[2])) <
        0.001,
    );
  }
  const player = sim.vehicle.body.position;
  assert.ok(
    objects.filter(
      (o) =>
        Math.hypot(o.position[0] - player.x, o.position[2] - player.z) < 160,
    ).length > 20,
  );
  const visuals = createStreetVisuals(objects);
  assert.equal(visuals.objects, objects);
  assert.equal(
    visuals.lampPositions.length,
    objects.filter((o) => o.type === "pole").length,
  );
  visuals.updateLights(true, new THREE.Vector3(player.x, player.y, player.z));
  assert.ok(visuals.lights.some((l) => l.intensity > 0));
  visuals.updateLights(false, player);
  assert.ok(visuals.lights.every((l) => l.intensity === 0));
  visuals.dispose();
  sim.dispose();
});

test("42 real-city pedestrians walk physically with at least 20 near spawn", () => {
  const sim = new CitySimulation(city, { trafficCount: 0 });
  const objects = createStreetLayout(city, (x, y) => sim.sampleElevation(x, y));
  if (sim.addObstacles) sim.addObstacles(objects);
  const life = new AmbientLife(city, sim, new THREE.Scene(), {
    objects,
    count: 42,
  });
  assert.equal(life.people.length, 42);
  assert.ok(
    life.people.filter(
      (p) => p.body.position.distanceTo(sim.vehicle.body.position) < 160,
    ).length >= 20,
  );
  const start = life.people.map((p) => p.body.position.clone());
  for (const person of life.people) {
    assert.equal(person.body.mass, 75);
    assert.equal(person.body.type, CANNON.Body.DYNAMIC);
    assert.equal(person.body.isPedestrian, true);
    assert.ok(person.body.position.distanceTo(sim.vehicle.body.position) > 5);
  }
  for (let i = 0; i < 600; i++) {
    sim.step(1 / 60);
    life.update(1 / 60);
  }
  const moved = life.people.map((p, i) => p.body.position.distanceTo(start[i]));
  assert.ok(
    moved.filter((d) => d > 2).length >= 30,
    `Only ${moved.filter((d) => d > 2).length} pedestrians moved >2 m`,
  );
  for (const person of life.people) {
    assert.ok(person.body.position.toArray().every(Number.isFinite));
    const ground = sim.sampleElevation(
      person.body.position.x,
      -person.body.position.z,
    );
    assert.ok(
      person.body.position.y > ground + 0.25 &&
        person.body.position.y < ground + 1.4,
    );
  }
  const ids = new Set(life.people.map((p) => p.body.id));
  life.dispose();
  assert.ok(sim.world.bodies.every((b) => !ids.has(b.id)));
  sim.dispose();
});

test("vehicle impact transfers momentum, topples a 75 kg adult, and allows recovery in place", () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  const car = new CANNON.Body({
    mass: 1450,
    shape: new CANNON.Box(new CANNON.Vec3(2, 0.55, 0.8)),
    position: new CANNON.Vec3(0, 1, 0),
    linearDamping: 0.001,
  });
  car.isVehicle = true;
  world.addBody(car);
  const flat = {
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
    roads: [
      {
        id: "test",
        width: 8,
        highway: "residential",
        points: [
          [0, -95, 0],
          [0, 95, 0],
        ],
      },
    ],
    buildings: [],
    intersections: [],
  };
  const sim = {
    world,
    vehicle: { body: car },
    traffic: [],
    sampleElevation: () => 0,
  };
  const life = new AmbientLife(flat, sim, new THREE.Scene(), { count: 4 });
  const person = life.people[0];
  car.position.set(person.body.position.x - 8, 0.75, person.body.position.z);
  car.velocity.set(12, 0, 0);
  let toppled = false;
  for (let i = 0; i < 120; i++) {
    car.force.y += 1450 * 9.81;
    world.step(1 / 60);
    life.update(1 / 60);
    toppled ||= !person.body.fixedRotation;
  }
  assert.equal(toppled, true);
  assert.ok(car.velocity.length() > 7 && car.velocity.length() < 12);
  assert.ok(person.fallUntil > 0);
  // Move only the test striker away; the person must recover at its physical location.
  car.position.set(90, 1, 90);
  car.velocity.setZero();
  const fallen = person.body.position.clone();
  for (let i = 0; i < 900; i++) {
    world.step(1 / 60);
    life.update(1 / 60);
  }
  assert.equal(person.body.fixedRotation, true);
  assert.ok(person.body.position.y > 0.7 && person.body.position.y < 1);
  assert.ok(person.body.position.distanceTo(fallen) < 35);
  life.dispose();
});
