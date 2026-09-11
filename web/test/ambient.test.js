import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import { createCityPlaces } from "../src/places.js";
import {
  AmbientLife,
  createStreetLayout,
  createStreetVisuals,
  classifyPedestrianImpact,
  PEDESTRIAN_IMPACT_TUNING,
} from "../src/ambient.js";
const city = JSON.parse(
  fs.readFileSync(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
    "utf8",
  ),
);
function district() {
  const sim = new CitySimulation(city, { trafficCount: 0 }),
    ground = (x, y) => sim.sampleElevation(x, y);
  const street = createStreetLayout(city, ground),
    places = createCityPlaces(city, ground, { streetObjects: street }),
    objects = [...street, ...places.obstacles];
  sim.addObstacles(objects);
  const life = new AmbientLife(city, sim, new THREE.Scene(), {
    objects,
    count: 150,
    activitySpots: places.activitySpots,
  });
  return { sim, life, street, places };
}
function flatPopulation(count = 8) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) }),
    ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  const car = new CANNON.Body({
    mass: 1450,
    shape: new CANNON.Box(new CANNON.Vec3(2, 0.55, 0.8)),
    position: new CANNON.Vec3(0, 1, 0),
    linearDamping: 0.001,
  });
  car.isVehicle = true;
  car.vehicleId = `vehicle-${car.id}`;
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
  const life = new AmbientLife(flat, sim, new THREE.Scene(), { count });
  return { sim, life, car, world };
}
function step(world, life, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    world.step(1 / 60);
    life.update(1 / 60);
  }
}

test("street layout retains deterministic shared physical/visible furniture", () => {
  const sim = new CitySimulation(city, { trafficCount: 0 });
  const ground = (x, y) => sim.sampleElevation(x, y),
    objects = createStreetLayout(city, ground);
  assert.deepEqual(objects, createStreetLayout(city, ground));
  assert.ok(objects.length > 200);
  assert.equal(new Set(objects.map((o) => o.id)).size, objects.length);
  const visual = createStreetVisuals(objects);
  assert.equal(visual.objects, objects);
  assert.equal(
    visual.lampPositions.length,
    objects.filter((o) => o.type === "pole").length,
  );
  visual.updateLights(true, sim.vehicle.body.position);
  assert.ok(visual.lights.some((light) => light.intensity > 0));
  visual.updateLights(false, sim.vehicle.body.position);
  assert.ok(visual.lights.every((light) => light.intensity === 0));
  visual.dispose();
  sim.dispose();
});

test("150 diverse residents occupy the whole measured district, with business activities and four render batches", () => {
  const { sim, life, places } = district();
  assert.equal(life.people.length, 150);
  const cells = new Set(),
    quadrants = [0, 0, 0, 0];
  for (const p of life.people) {
    cells.add(
      `${Math.floor((p.body.position.x + 500) / 200)},${Math.floor((-p.body.position.z + 500) / 200)}`,
    );
    quadrants[
      (p.body.position.x >= 0 ? 1 : 0) + (p.body.position.z >= 0 ? 2 : 0)
    ]++;
    assert.equal(p.body.mass, 75);
    assert.equal(p.body.type, CANNON.Body.DYNAMIC);
    assert.equal(p.body.isPedestrian, true);
  }
  assert.ok(cells.size >= 23, `Only ${cells.size}/25 cells populated`);
  assert.ok(quadrants.every((n) => n > 18));
  const stats = life.populationStats;
  for (const activity of ["walk", "chat", "coffee", "dine", "rest"])
    assert.ok(stats.activities[activity] >= 5);
  assert.ok(stats.personas["unhoused-resident"] >= 3);
  assert.equal(stats.drawBatches, 4);
  assert.ok(life.people.filter((p) => p.spotId).length > 20);
  assert.ok(life.people.filter((p) => p.seated).length > 10);
  for (const person of life.people.filter((p) => p.seated)) {
    const spot = places.activitySpots.find((s) => s.id === person.spotId);
    if (!spot?.tablePosition) continue;
    const forward = person.body.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
    const toward = new CANNON.Vec3(
      spot.tablePosition[0] - person.body.position.x,
      0,
      spot.tablePosition[2] - person.body.position.z,
    );
    toward.normalize();
    assert.ok(
      forward.dot(toward) > 0.98,
      `Seated resident ${person.id} faces away from the table`,
    );
  }
  assert.ok(
    life.people.filter(
      (p) => p.body.position.distanceTo(sim.vehicle.body.position) < 160,
    ).length >= 20,
  );
  const start = life.people.map((p) => p.body.position.clone());
  for (let i = 0; i < 600; i++) {
    sim.step(1 / 60);
    life.update(1 / 60);
  }
  const walkers = life.people.filter((p) => p.activity === "walk");
  assert.ok(walkers.length >= 40);
  assert.ok(
    life.people.filter(
      (p, i) =>
        p.activity === "walk" && p.body.position.distanceTo(start[i]) > 2,
    ).length >=
      walkers.length * 0.8,
  );
  for (const p of life.people) {
    assert.ok(p.body.position.toArray().every(Number.isFinite));
    assert.equal(p.outcome, "healthy");
  }
  life.dispose();
  sim.dispose();
});

test("impact classifier is explicit arcade tuning and uses both relative and normal impact for fatal outcomes", () => {
  assert.equal(classifyPedestrianImpact(0.8, 20), null);
  assert.equal(classifyPedestrianImpact(3, 3), "stagger");
  assert.equal(classifyPedestrianImpact(8, 10), "injured");
  assert.equal(classifyPedestrianImpact(12, 16), "fatal");
  assert.equal(classifyPedestrianImpact(8, 20), "injured");
  assert.equal(PEDESTRIAN_IMPACT_TUNING.injuryMinMps, 6);
});

test("injured/fatal outcomes persist, events deduplicate, and all resident personas use identical rules", () => {
  const { sim, life, car, world } = flatPopulation();
  const first = life.people[0],
    second = life.people[1];
  second.persona = "unhoused-resident";
  car.velocity.set(10, 0, 0);
  const injured = life.handleVehicleImpact(first, car, 8, 10);
  const secondInjured = life.handleVehicleImpact(second, car, 8, 10);
  assert.equal(injured.outcome, "injured");
  assert.equal(secondInjured.outcome, "injured");
  assert.equal(injured.type, "pedestrian-impact");
  assert.equal(injured.player, true);
  assert.equal(injured.vehicleId, car.id);
  assert.equal(injured.personId, first.id);
  assert.equal(injured.severity, 1);
  life.handleVehicleImpact(first, car, 8, 10);
  assert.equal(life.events.length, 2);
  car.position.set(90, 1, 90);
  car.velocity.setZero();
  step(world, life, 20);
  assert.equal(first.outcome, "injured");
  assert.equal(second.outcome, "injured");
  assert.equal(first.body.fixedRotation, false);
  assert.equal(life.events.length, 2);
  const killed = life.handleVehicleImpact(first, car, 18, 20);
  assert.equal(killed.outcome, "fatal");
  assert.equal(killed.severity, 2);
  life.handleVehicleImpact(first, car, 22, 24);
  assert.equal(life.events.length, 3);
  step(world, life, 15);
  assert.equal(first.outcome, "fatal");
  assert.equal(first.body.isDead, true);
  const previousIds = new Set(life.people.map((p) => p.body.id));
  assert.equal(life.reset(), 8);
  assert.equal(life.events.length, 0);
  assert.ok(
    life.people.every(
      (p) => p.outcome === "healthy" && !p.body.isDead && !p.body.isInjured,
    ),
  );
  assert.ok(world.bodies.every((b) => !previousIds.has(b.id)));
  life.dispose();
});

test("minor real rigid-body contact topples a pedestrian and permits recovery, unlike serious injury", () => {
  const { sim, life, car, world } = flatPopulation(4),
    person = life.people[0];
  car.position.set(person.body.position.x - 3.4, 0.75, person.body.position.z);
  car.velocity.set(4.5, 0, 0);
  let toppled = false;
  for (let i = 0; i < 90; i++) {
    car.force.y += 1450 * 9.81;
    world.step(1 / 60);
    life.update(1 / 60);
    toppled ||= !person.body.fixedRotation;
  }
  assert.equal(toppled, true);
  assert.equal(life.events[0]?.outcome, "stagger");
  car.position.set(90, 1, 90);
  car.velocity.setZero();
  step(world, life, 15);
  assert.equal(person.outcome, "healthy");
  assert.equal(person.body.fixedRotation, true);
  life.dispose();
});

test("current player ownership is evaluated at impact time and a stolen driver exits at a clear anchor", () => {
  const { sim, life, car, world } = flatPopulation(8),
    person = life.people[0];
  const other = new CANNON.Body({
    mass: 1450,
    position: new CANNON.Vec3(90, 1, 90),
  });
  other.isVehicle = true;
  world.addBody(other);
  sim.vehicle = { body: other };
  const incident = life.handleVehicleImpact(person, car, 8, 10);
  assert.equal(incident.player, false);
  const driver = life.spawnOccupant({ body: car });
  assert.ok(driver);
  assert.equal(driver.occupant, true);
  assert.equal(life.spawnOccupant({ body: car }), driver);
  assert.ok(sim.pedestrianBodies.includes(driver.body));
  assert.ok(driver.body.position.distanceTo(car.position) > 4.4);
  life.dispose();
});

test("actual vehicle contact emits persistent injured and fatal outcomes at the chosen game thresholds", () => {
  for (const [speed, expected] of [
    [12, "injured"],
    [20, "fatal"],
  ]) {
    const { sim, life, car, world } = flatPopulation(4),
      person = life.people[0];
    car.position.set(person.body.position.x - 5, 0.75, person.body.position.z);
    car.velocity.set(speed, 0, 0);
    for (let i = 0; i < 120; i++) {
      car.force.y += 1450 * 9.81;
      world.step(1 / 60);
      life.update(1 / 60);
    }
    assert.equal(person.outcome, expected);
    assert.equal(life.events.filter((e) => e.personId === person.id).length, 1);
    assert.equal(
      life.events.find((e) => e.personId === person.id).player,
      true,
    );
    car.position.set(90, 1, 90);
    car.velocity.setZero();
    step(world, life, 12);
    assert.equal(person.outcome, expected);
    life.dispose();
  }
});
