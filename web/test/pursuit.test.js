import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import { PursuitSystem } from "../src/pursuit.js";
function city() {
  const c = {
    terrain: {
      width: 41,
      height: 41,
      cellSize: 10,
      bounds: { minX: -200, minY: -200 },
      heights: Array(41 * 41).fill(50),
    },
    bounds: { minX: -200, maxX: 200, minY: -200, maxY: 200 },
    spawn: { x: 0, y: 0, z: 50, headingRadians: 0 },
    roads: [],
    buildings: [],
    intersections: [],
  };
  let id = 0;
  for (let x = -160; x <= 120; x += 40)
    for (let y = -160; y <= 120; y += 40) {
      c.roads.push({
        id: `r${id++}`,
        width: 13,
        lanes: 4,
        points: [
          [x, y, 50],
          [x + 20, y, 50],
          [x + 40, y, 50],
        ],
      });
      c.roads.push({
        id: `r${id++}`,
        width: 13,
        lanes: 4,
        points: [
          [x, y, 50],
          [x, y + 20, 50],
          [x, y + 40, 50],
        ],
      });
    }
  return c;
}
function sim(config = {}) {
  return new CitySimulation(city(), {
    trafficCount: 8,
    policeCount: 2,
    ...config,
  });
}
function farCops(pursuit) {
  for (const [i, cop] of pursuit.officers.entries()) {
    cop.body.position.set(500 + i * 20, 50.6, 500);
    cop.body.velocity.setZero();
  }
}
function copAt(pursuit, index = 0, x = 0, z = -35) {
  const cop = pursuit.officers[index];
  cop.body.position.set(x, pursuit.sim.vehicle.body.position.y, z);
  cop.body.velocity.setZero();
  pursuit.nextSightAt = 0;
  return cop;
}

test("injury and fatality incidents dispatch physical police; nonplayer/stagger events do not", () => {
  const s = sim(),
    p = new PursuitSystem(s, s.city);
  farCops(p);
  assert.equal(
    p.reportIncident({ outcome: "stagger", severity: 0, player: true }),
    false,
  );
  assert.equal(
    p.reportIncident({ outcome: "injured", severity: 1, player: false }),
    false,
  );
  assert.equal(p.state, "idle");
  assert.equal(
    p.reportIncident({
      type: "pedestrian-impact",
      outcome: "injured",
      severity: 1,
      player: true,
      position: [0, 50, 0],
    }),
    true,
  );
  assert.equal(p.state, "pursuit");
  assert.equal(p.officers.length, 2);
  assert.ok(p.officers.every((cop) => cop.chaseTarget && cop.policeLights));
  p.reportIncident({ type: "fatality", severity: 2, position: [0, 50, 0] });
  assert.equal(p.severity, 2);
  s.dispose();
});

test("60 continuous seconds unseen clears wanted; a sighting resets the entire timer", () => {
  const s = sim(),
    p = new PursuitSystem(s, s.city);
  farCops(p);
  p.reportIncident({ type: "injury", position: [0, 50, 0] });
  for (let i = 0; i < 59; i++) p.update(1);
  assert.equal(p.state, "search");
  assert.equal(p.unseenSeconds, 59);
  copAt(p);
  p.update(0.2);
  assert.equal(p.state, "pursuit");
  assert.equal(p.unseenSeconds, 0);
  farCops(p);
  p.nextSightAt = 0;
  for (let i = 0; i < 59; i++) p.update(1);
  p.update(0.9);
  assert.equal(p.state, "search");
  p.update(0.1);
  assert.equal(p.state, "idle");
  assert.equal(p.severity, 0);
  assert.ok(p.events.some((e) => e.type === "cleared"));
  assert.ok(p.officers.every((c) => !c.chaseTarget && !c.policeLights));
  s.dispose();
});

test("buildings block police sight instead of permitting vision through walls", () => {
  const c = city();
  c.buildings = [
    {
      id: "occluder",
      height: 8,
      baseElevation: 50,
      footprint: [
        [-8, 10, 50],
        [8, 10, 50],
        [8, 15, 50],
        [-8, 15, 50],
      ],
    },
  ];
  const s = new CitySimulation(c, { trafficCount: 8, policeCount: 2 }),
    p = new PursuitSystem(s, c);
  farCops(p);
  const cop = copAt(p);
  assert.equal(p.hasLineOfSight(cop), false);
  cop.body.position.x = 60;
  assert.equal(p.hasLineOfSight(cop), true);
  s.dispose();
});

test("capture requires sustained close police and low speed; escaping proximity resets capture", () => {
  const s = sim(),
    p = new PursuitSystem(s, s.city, {
      dispatchGraceSeconds: 0,
      captureSeconds: 3,
    });
  farCops(p);
  copAt(p, 0, 0, -5);
  p.reportIncident({ type: "theft", severity: 1, position: [0, 50, 0] });
  p.update(1);
  assert.equal(p.state, "pursuit");
  assert.ok(p.captureProgress > 0.3);
  s.vehicle.body.velocity.set(0, 0, -8);
  p.update(0.25);
  assert.equal(p.captureProgress, 0);
  s.vehicle.body.velocity.setZero();
  p.update(2.9);
  assert.notEqual(p.state, "busted");
  p.update(0.1);
  assert.equal(p.state, "busted");
  assert.equal(p.captureProgress, 1);
  assert.equal(s.controls.throttle, 0);
  assert.ok(p.events.some((e) => e.type === "busted"));
  s.reset();
  assert.equal(p.state, "idle");
  assert.equal(s.vehicle.health, 1);
  assert.equal(p.captureProgress, 0);
  s.dispose();
});

test("theft exchanges physical ownership without teleport, repair or lost tuning", () => {
  const s = sim(),
    target = s.traffic.find((v) => v.role !== "police"),
    old = s.vehicle,
    all = s.allVehicles;
  old.body.position.set(0, 50.6, 0);
  target.body.position.set(3.7, 50.6, 0);
  target.body.velocity.set(0, 0, -1.5);
  target.damage.front = 0.32;
  target.health = 0.82;
  target.tuning.power = 1.3;
  const oldPosition = old.body.position.clone(),
    targetPosition = target.body.position.clone(),
    velocity = target.body.velocity.clone();
  const count = s.world.bodies.length,
    result = s.takeVehicle(target);
  assert.equal(result.ok, true);
  assert.equal(s.vehicle, target);
  assert.equal(s.allVehicles, all);
  assert.equal(s.world.bodies.length, count);
  assert.ok(old.body.position.almostEquals(oldPosition));
  assert.ok(target.body.position.almostEquals(targetPosition));
  assert.ok(target.body.velocity.almostEquals(velocity));
  assert.equal(target.damage.front, 0.32);
  assert.equal(target.health, 0.82);
  assert.equal(target.tuning.power, 1.3);
  assert.equal(old.parked, true);
  assert.equal(old.abandoned, true);
  assert.ok(s.traffic.includes(old));
  assert.ok(!s.traffic.includes(target));
  assert.equal(s.events.filter((e) => e.type === "vehicle-taken").length, 1);
  s.dispose();
});

test("theft rejects moving or distant cars and police ownership is dynamic", () => {
  const s = sim(),
    p = new PursuitSystem(s, s.city),
    cop = p.officers[0];
  assert.equal(s.takeVehicle(cop).ok, false);
  cop.body.position.copy(
    s.vehicle.body.position.vadd(new CANNON.Vec3(4, 0, 0)),
  );
  cop.body.velocity.set(0, 0, -5);
  assert.equal(s.takeVehicle(cop).ok, false);
  cop.body.velocity.setZero();
  const oldCount = p.officers.length;
  assert.equal(s.takeVehicle(cop).ok, true);
  assert.equal(p.officers.length, oldCount - 1);
  assert.equal(
    p.state,
    "idle",
    "Theft incident reporting belongs to root gameplay, not the ownership method",
  );
  s.dispose();
});

test("police chase uses dynamic body forces along graph routes", () => {
  const s = sim({ trafficCount: 2, policeCount: 1 }),
    p = new PursuitSystem(s, s.city, { captureSeconds: 100 });
  const cop = p.officers[0];
  // Put the driver and officer on one actual directed lane for an isolated chase.
  s.vehicle.body.position.set(1.55, 50.65, 40);
  cop.body.position.set(1.55, 50.65, 95);
  s.vehicle.body.quaternion.set(0, 0, 0, 1);
  cop.body.quaternion.set(0, 0, 0, 1);
  s.controls.brake = 1;
  const initial = cop.body.position.clone();
  p.reportIncident({ type: "injury", position: [1.55, 50.6, 40] });
  for (let i = 0; i < 600; i++) s.step(1 / 60);
  assert.ok(cop.body.position.distanceTo(initial) > 8);
  assert.ok(cop.distance > 8);
  assert.ok(cop.body.mass > 1000);
  assert.ok(p.officers[0].raycast.wheelInfos.length === 4);
  s.dispose();
});

const realPath =
  process.env.CITY_WHEELS_CITY ||
  fileURLToPath(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  );
test(
  "real SF distributes40moving cars/four patrol units citywide and supports physical parked targets",
  { skip: !fs.existsSync(realPath) },
  () => {
    const c = JSON.parse(fs.readFileSync(realPath, "utf8")),
      start = performance.now(),
      s = new CitySimulation(c, {
        trafficCount: 40,
        policeCount: 4,
        parkedCount: 16,
      });
    assert.equal(s.traffic.filter((v) => !v.parked).length, 40);
    assert.equal(s.traffic.filter((v) => v.role === "police").length, 4);
    assert.ok(s.traffic.filter((v) => v.parked).length >= 10);
    assert.equal(s.allVehicles.length, s.traffic.length + 1);
    const moving = s.traffic.filter((v) => !v.parked),
      xs = moving.map((v) => v.body.position.x),
      zs = moving.map((v) => v.body.position.z);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 750);
    assert.ok(Math.max(...zs) - Math.min(...zs) > 750);
    const times = [];
    s.controls.brake = 1;
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      s.step(1 / 60);
      times.push(performance.now() - t);
    }
    assert.ok(
      s.traffic.filter((v) => v.parked).every((v) => v.health > 0.9),
      "Parked targets must settle without colliding with invisible buildings",
    );
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        totalVehicles: s.allVehicles.length,
        parked: s.traffic.filter((v) => v.parked).length,
        mean: times.reduce((a, b) => a + b, 0) / times.length,
        p95: times[Math.floor(times.length * 0.95)],
        elapsedMs: performance.now() - start,
      }),
    );
    s.dispose();
  },
);

test("restart after theft avoids placing the player inside the abandoned car", () => {
  const s = sim(),
    old = s.vehicle,
    target = s.traffic.find((v) => v.role !== "police");
  target.body.position.copy(old.body.position.vadd(new CANNON.Vec3(3.8, 0, 0)));
  target.body.velocity.setZero();
  assert.equal(s.takeVehicle(target).ok, true);
  s.reset();
  assert.ok(s.vehicle.body.position.distanceTo(old.body.position) > 5.8);
  assert.equal(s.vehicle.health, 1);
  s.dispose();
});

test("wanted recovery is disabled until an escape or a BUSTED restart", () => {
  const s = sim(),
    p = new PursuitSystem(s, s.city);
  p.reportIncident({ type: "theft", severity: 1 });
  const before = s.vehicle.body.position.clone();
  assert.equal(s.reset(), false);
  assert.ok(s.vehicle.body.position.almostEquals(before));
  assert.notEqual(p.state, "idle");
  s.dispose();
});

test(
  "real SF police physically approach and capture a stationary suspect amid57vehicles",
  { skip: !fs.existsSync(realPath) },
  () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./benchmark-v3.js", import.meta.url)), realPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
