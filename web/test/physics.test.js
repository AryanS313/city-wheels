import test from "node:test";
import * as CANNON from "cannon-es";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { CitySimulation, sampleTerrain, surfaceGrip } from "../src/physics.js";

function city(slope = 0) {
  const width = 101,
    height = 101,
    cellSize = 10;
  return {
    terrain: {
      width,
      height,
      cellSize,
      bounds: { minX: -500, minY: -500 },
      heights: Array.from(
        { length: width * height },
        (_, index) => 50 + (Math.floor(index / width) * cellSize - 500) * slope,
      ),
    },
    roads: [
      {
        id: "test-road",
        width: 32,
        points: [
          { x: 0, y: -480, z: 50 - 480 * slope },
          { x: 0, y: 480, z: 50 + 480 * slope },
        ],
        surface: "asphalt",
        speedKph: 48,
      },
    ],
    buildings: [],
    spawn: { x: 0, y: 0, z: 50, headingRadians: 0 },
  };
}
function addTrafficLoop(c) {
  const corners = [
    [60, -120, 50],
    [60, 120, 50],
    [120, 120, 50],
    [120, -120, 50],
  ];
  for (let i = 0; i < 4; i++)
    c.roads.push({
      id: `loop-${i}`,
      width: 10,
      oneway: 1,
      points: [corners[i], corners[(i + 1) % 4]],
      speedKph: 32,
    });
  return c;
}
function tick(sim, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60);
}
function fresh(slope = 0) {
  const sim = new CitySimulation(city(slope), { trafficCount: 0 });
  sim.controls.brake = 1;
  tick(sim, 2);
  sim.controls.brake = 0;
  return sim;
}

test("south-to-north terrain samples preserve true elevation and cell triangulation", () => {
  const c = city(0.2);
  assert.equal(sampleTerrain(c, 0, 100), 70);
  assert.equal(sampleTerrain(c, 0, -100), 30);
  assert.ok(Math.abs(sampleTerrain(c, 5, 2.5) - 50.5) < 1e-6);
  const sim = new CitySimulation(c, { trafficCount: 0 });
  assert.ok(Math.abs(sim.sampleElevation(0, 100) - 70.06) < 0.001);
  sim.dispose();
});

test("car settles onto the ground and accelerates north under engine force", () => {
  const sim = fresh();
  assert.ok(sim.vehicle.raycast.numWheelsOnGround >= 2);
  assert.ok(
    sim.vehicle.body.position.y > 50 && sim.vehicle.body.position.y < 52,
  );
  sim.controls.throttle = 1;
  tick(sim, 4);
  assert.ok(
    sim.vehicle.body.position.z < -15,
    `position=${sim.vehicle.body.position.toString()}`,
  );
  assert.ok(sim.speedKph > 25 && sim.speedKph < 90, `speed=${sim.speedKph}`);
  assert.ok(sim.rpm > 850);
  sim.dispose();
});

test("brakes reduce forward speed without changing position directly", () => {
  const sim = fresh();
  sim.controls.throttle = 1;
  tick(sim, 4);
  const before = sim.speedKph;
  sim.controls.throttle = 0;
  sim.controls.brake = 1;
  tick(sim, 2);
  assert.ok(sim.speedKph < before * 0.25, `${before} -> ${sim.speedKph}`);
  sim.dispose();
});

test("positive steering turns right (east) and negative steering turns left", () => {
  for (const direction of [-1, 1]) {
    const sim = fresh();
    sim.controls.throttle = 0.65;
    tick(sim, 2);
    sim.controls.steer = direction * 0.5;
    tick(sim, 1.5);
    assert.ok(
      sim.vehicle.body.position.x * direction > 0.5,
      `direction=${direction} x=${sim.vehicle.body.position.x}`,
    );
    sim.dispose();
  }
});

test("wet asphalt grip and braking are lower than dry; wet steel is lower again", () => {
  assert.ok(surfaceGrip("asphalt", 1) < surfaceGrip("asphalt", 0));
  assert.ok(surfaceGrip("steel", 1) < surfaceGrip("asphalt", 1));
  assert.equal(surfaceGrip("bricks", 1), surfaceGrip("cobblestone", 1));
  assert.equal(surfaceGrip("paving_stones", 1), surfaceGrip("cobblestone", 1));
  const dry = fresh(),
    wet = fresh();
  wet.setWeather(true);
  for (const sim of [dry, wet]) {
    sim.vehicle.body.velocity.set(0, 0, -18);
    sim.controls.brake = 1;
  }
  tick(dry, 1);
  tick(wet, 1);
  assert.ok(
    wet.speedKph > dry.speedKph + 2,
    `dry=${dry.speedKph} wet=${wet.speedKph}`,
  );
  assert.ok(
    wet.vehicle.wheels[0].frictionSlip < dry.vehicle.wheels[0].frictionSlip,
  );
  dry.dispose();
  wet.dispose();
});

test("uphill acceleration is lower; gravity and suspension carry grade", () => {
  const flat = fresh(),
    hill = fresh(0.18);
  flat.controls.throttle = hill.controls.throttle = 1;
  tick(flat, 3);
  tick(hill, 3);
  assert.ok(
    flat.speedKph > hill.speedKph + 2,
    `flat=${flat.speedKph} hill=${hill.speedKph}`,
  );
  assert.ok(hill.vehicle.body.position.y > 50.5);
  flat.dispose();
  hill.dispose();
});

test("reverse drives south and reset restores the car", () => {
  const sim = fresh();
  sim.controls.throttle = -1;
  tick(sim, 2.5);
  assert.ok(sim.vehicle.body.position.z > 3);
  assert.equal(sim.gear, "R");
  sim.vehicle.health = 0.4;
  sim.vehicle.steeringDamage = 0.07;
  sim.reset();
  assert.equal(sim.vehicle.health, 1);
  assert.equal(sim.vehicle.steeringDamage, 0);
  assert.ok(sim.speedKph < 0.01);
  assert.ok(Math.abs(sim.vehicle.body.position.z) < 0.01);
  sim.dispose();
});

test("traffic is a rigid-body vehicle that moves under wheel engine force", () => {
  const c = addTrafficLoop(city());
  const sim = new CitySimulation(c, { trafficCount: 2 });
  assert.ok(sim.traffic.length > 0);
  const traffic = sim.traffic.at(-1),
    before = traffic.body.position.clone();
  tick(sim, 6);
  assert.equal(traffic.body.mass, 1450);
  assert.ok(traffic.body.position.distanceTo(before) > 3);
  sim.dispose();
});

test("heading pi/2 accelerates east in the renderer coordinate system", () => {
  const c = city();
  c.roads = [];
  c.spawn.headingRadians = Math.PI / 2;
  const sim = new CitySimulation(c, { trafficCount: 0 });
  sim.controls.brake = 1;
  tick(sim, 1.5);
  sim.controls.brake = 0;
  sim.controls.throttle = 1;
  tick(sim, 3);
  assert.ok(sim.vehicle.body.position.x > 10);
  assert.ok(Math.abs(sim.vehicle.body.position.z) < 0.1);
  sim.dispose();
});

test("a free fall lands through suspension and collision damage lowers engine health", () => {
  const sim = fresh();
  sim.vehicle.body.position.y += 5;
  tick(sim, 0.1);
  assert.equal(sim.airborne, true);
  tick(sim, 2);
  assert.equal(sim.airborne, false);
  assert.ok(sim.events.some((event) => event.type === "landed"));
  sim.dispose();
  const c = city();
  c.buildings = [
    {
      footprint: [
        { x: -6, y: 22, z: 50 },
        { x: 6, y: 22, z: 50 },
        { x: 6, y: 26, z: 50 },
        { x: -6, y: 26, z: 50 },
      ],
      height: 8,
      baseElevation: 50,
    },
  ];
  const wall = new CitySimulation(c, { trafficCount: 0 });
  tick(wall, 1);
  wall.vehicle.body.velocity.set(0, 0, -25);
  wall.controls.throttle = 1;
  tick(wall, 3);
  assert.ok(wall.vehicle.health < 1, `health=${wall.vehicle.health}`);
  assert.ok(wall.vehicle.engineHealth < 1);
  assert.ok(wall.events.some((event) => event.type === "collision"));
  wall.dispose();
});

const realCityPath =
  process.env.CITY_WHEELS_CITY ||
  fileURLToPath(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  );
test(
  "real San Francisco package initializes, settles at spawn and accelerates five seconds without collision",
  { skip: !existsSync(realCityPath) },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./benchmark-city.js", import.meta.url)),
        realCityPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

test("actual rail strips use OSM gauge and lower wet steel tyre grip at each contact patch", () => {
  const c = city();
  c.railways = [
    {
      id: "cable-car-track",
      points: [
        { x: 0, y: -200, z: 50 },
        { x: 0, y: 200, z: 50 },
      ],
      tags: { gauge: "1067" },
    },
  ];
  // Align the left wheels with the western1.067m-gauge rail.
  c.spawn.x = 0.79 - 1.067 / 2;
  const sim = new CitySimulation(c, { trafficCount: 0 });
  sim.setWeather(true);
  sim.controls.brake = 1;
  tick(sim, 2);
  assert.equal(sim.surfaceAt(-0.5335, 0, 50.06), "steel");
  assert.equal(sim.surfaceAt(0.5335, 0, 50.06), "steel");
  assert.equal(
    sim.surfaceAt(0.5335, 0, 55),
    "asphalt",
    "A railway on a different elevation must not affect the road below",
  );
  assert.equal(sim.surfaceAt(0.9, 0, 50.06), "asphalt");
  assert.equal(sim.vehicle.wheels[0].contactSurface, "steel");
  assert.equal(sim.vehicle.wheels[2].contactSurface, "steel");
  assert.equal(sim.vehicle.wheels[1].contactSurface, "asphalt");
  assert.ok(
    sim.vehicle.wheels[0].frictionSlip <
      sim.vehicle.wheels[1].frictionSlip * 0.5,
  );
  assert.equal(sim.surfaceAt(0, 0, 50.06), "painted_lines");
  sim.dispose();
  const defaultGauge = city();
  defaultGauge.railways = [
    {
      points: [
        { x: 0, y: -20, z: 50 },
        { x: 0, y: 20, z: 50 },
      ],
    },
  ];
  const other = new CitySimulation(defaultGauge, { trafficCount: 0 });
  assert.equal(other.surfaceAt(0.5335, 0, 50.06), "steel");
  other.dispose();
});

test("visible pole and tree trunks collide at their exact narrow radii", () => {
  const c = city();
  const sim = new CitySimulation(c, {
    trafficCount: 0,
    obstacles: [
      {
        id: "light-1",
        type: "pole",
        position: [0, 50, -18],
        radius: 0.13,
        height: 6,
      },
      {
        id: "tree-1",
        type: "tree",
        position: [3, 50, -10],
        radius: 0.32,
        height: 5,
      },
    ],
  });
  sim.controls.brake = 1;
  tick(sim, 1);
  sim.controls.brake = 0;
  sim.vehicle.body.velocity.set(0, 0, -14);
  tick(sim, 2);
  assert.ok(
    sim.events.some((e) => e.obstacleId === "light-1"),
    "The pole must block the chassis and report its visible ID",
  );
  assert.ok(
    !sim.events.some((e) => e.obstacleId === "tree-1"),
    "A tree canopy must not become an invisible oversized trunk",
  );
  const event = sim.events.find((e) => e.obstacleId === "light-1");
  assert.ok(event.energy > 10000);
  assert.equal(event.hitPosition.length, 3);
  assert.equal(event.normal.length, 3);
  assert.ok(sim.vehicle.damage.front > 0);
  sim.dispose();
});

test("concave building notch and a courtyard hole remain physically open", () => {
  for (const withHole of [false, true]) {
    const c = city();
    c.spawn = { x: 0, y: 22, z: 50, headingRadians: 0 };
    c.buildings = [
      {
        height: 8,
        baseElevation: 50,
        footprint: (withHole
          ? [
              [-10, 10],
              [10, 10],
              [10, 40],
              [-10, 40],
            ]
          : [
              [-10, 10],
              [10, 10],
              [10, 30],
              [5, 30],
              [5, 15],
              [-5, 15],
              [-5, 30],
              [-10, 30],
            ]
        ).map(([x, y]) => ({ x, y, z: 50 })),
        footprintHoles: withHole
          ? [
              [
                [-5, 15, 50],
                [5, 15, 50],
                [5, 35, 50],
                [-5, 35, 50],
              ],
            ]
          : [],
      },
    ];
    const sim = new CitySimulation(c, { trafficCount: 0 });
    sim.controls.brake = 1;
    tick(sim, 2);
    assert.equal(
      sim.vehicle.health,
      1,
      "Spawn in the visible opening must not be crushed by a convex hull",
    );
    assert.ok(sim.vehicle.body.position.y > 50.3);
    assert.equal(sim.vehicle.raycast.numWheelsOnGround, 4);
    if (!withHole) {
      sim.controls.brake = 0;
      sim.controls.throttle = 0.5;
      tick(sim, 3);
      assert.equal(sim.vehicle.health, 1);
      assert.ok(-sim.vehicle.body.position.z > 30);
    }
    sim.dispose();
  }
});

test("car-to-car collisions transfer momentum and minor impacts preserve engine power", () => {
  const c = addTrafficLoop(city());
  const sim = new CitySimulation(c, { trafficCount: 1 });
  assert.equal(sim.traffic.length, 1);
  const other = sim.traffic[0];
  sim.trafficNetwork.update = (record) => {
    record.controls.throttle = 0;
    record.controls.brake = 0;
    record.controls.steer = 0;
  };
  sim.controls.brake = 1;
  tick(sim, 1);
  other.body.position.set(0, sim.vehicle.body.position.y, -11);
  other.body.quaternion.copy(sim.vehicle.body.quaternion);
  other.body.velocity.setZero();
  sim.controls.brake = 0;
  sim.vehicle.body.velocity.set(0, 0, -10);
  tick(sim, 1.5);
  assert.ok(
    other.body.velocity.z < -1,
    "The struck physical car must receive forward momentum",
  );
  assert.ok(
    sim.vehicle.body.velocity.z > -9,
    "The striking car must lose momentum",
  );
  assert.equal(
    sim.vehicle.engineHealth,
    1,
    "A low-energy bumper impact must not stall the engine",
  );
  assert.ok(sim.events.some((e) => e.type === "collision" && e.player));
  sim.dispose();
});

test("coasting uses rolling resistance without unintended service braking", () => {
  const sim = fresh();
  sim.vehicle.body.velocity.set(0, 0, -15);
  tick(sim, 4);
  assert.ok(
    sim.speedKph > 40,
    `A coasting car should retain momentum: ${sim.speedKph}`,
  );
  assert.ok(sim.vehicle.wheels.every((w) => w.brake === 0));
  sim.dispose();
});

test("traffic brakes for a pedestrian body registered in the shared world", () => {
  const c = addTrafficLoop(city());
  const sim = new CitySimulation(c, { trafficCount: 1 }),
    car = sim.traffic[0];
  const pedestrian = new CANNON.Body({
    mass: 70,
    shape: new CANNON.Sphere(0.3),
  });
  pedestrian.isPedestrian = true;
  pedestrian.position.copy(
    car.body.pointToWorldFrame(new CANNON.Vec3(0, 0, -6)),
  );
  sim.world.addBody(pedestrian);
  car.body.velocity.copy(
    car.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, -6)),
  );
  sim.trafficNetwork.update(car, sim, 1 / 60);
  assert.equal(car.controls.throttle, 0);
  assert.ok(car.controls.brake >= 0.8);
  sim.dispose();
});

test(
  "real SF60-second traversal crosses12ways with18dynamic cars and no unexplained stall",
  { skip: !existsSync(realCityPath) },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./long-smoke.js", import.meta.url)),
        realCityPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

test("chassis collider fits the detailed car roof and longitudinal visual bounds", () => {
  const sim = fresh();
  for (let i = 0; i < sim.vehicle.body.shapes.length; i++) {
    const shape = sim.vehicle.body.shapes[i],
      offset = sim.vehicle.body.shapeOffsets[i];
    assert.ok(offset.y + shape.halfExtents.y <= 0.4343);
    assert.ok(offset.z - shape.halfExtents.z >= -2.2617);
    assert.ok(offset.z + shape.halfExtents.z <= 1.9095);
  }
  sim.dispose();
});
