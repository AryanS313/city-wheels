import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import earcut from "earcut";
const fixture = () => ({
  terrain: {
    width: 21,
    height: 21,
    cellSize: 10,
    bounds: { minX: -100, minY: -100 },
    heights: Array(441).fill(10),
  },
  bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
  roads: [],
  buildings: [],
  spawn: { x: 0, y: 0, z: 10, headingRadians: 0 },
});

test("AABB sweep returns exactly every eligible overlap and ray-query candidate", () => {
  const s = new CitySimulation(fixture(), { trafficCount: 0 });
  let seed = 7;
  const rand = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 70; i++) {
    const b = new CANNON.Body({
      mass: i % 3 ? 2 : 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          0.2 + rand() * 15,
          0.2 + rand() * 30,
          0.2 + rand() * 15,
        ),
      ),
    });
    b.position.set(rand() * 150 - 75, rand() * 40, rand() * 150 - 75);
    b.quaternion.setFromEuler(rand(), rand(), rand());
    s.world.addBody(b);
  }
  const pairKey = (a, b) =>
    a.id < b.id ? `${a.id}/${b.id}` : `${b.id}/${a.id}`;
  for (let phase = 0; phase < 4; phase++) {
    const bodies = s.world.bodies;
    for (const b of bodies) {
      if (b.type === CANNON.Body.DYNAMIC) {
        b.position.x += rand() * 8 - 4;
        b.aabbNeedsUpdate = true;
      }
      if (b.aabbNeedsUpdate) b.updateAABB();
    }
    s.world.broadphase.dirty = true;
    const a = [],
      b = [],
      expected = [];
    s.world.broadphase.collisionPairs(s.world, a, b);
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++)
        if (
          s.world.broadphase.needBroadphaseCollision(bodies[i], bodies[j]) &&
          bodies[i].aabb.overlaps(bodies[j].aabb)
        )
          expected.push(pairKey(bodies[i], bodies[j]));
    assert.deepEqual(
      a.map((body, i) => pairKey(body, b[i])).sort(),
      expected.sort(),
    );
    const q = new CANNON.AABB({
      lowerBound: new CANNON.Vec3(-20, 5, -20),
      upperBound: new CANNON.Vec3(20, 35, 20),
    });
    assert.deepEqual(
      s.world.broadphase
        .aabbQuery(s.world, q)
        .map((b) => b.id)
        .sort((a, b) => a - b),
      bodies
        .filter((b) => b.aabb.overlaps(q))
        .map((b) => b.id)
        .sort((a, b) => a - b),
    );
  }
  s.dispose();
});

test("fixed 60 Hz stepping caps catch-up work and bounds pending debt", () => {
  const s = new CitySimulation(fixture(), { trafficCount: 0 });
  let steps = 0;
  const native = s.world.step.bind(s.world);
  s.world.step = (...args) => {
    steps++;
    return native(...args);
  };
  s.step(0.1);
  assert.equal(steps, 2);
  assert.equal(s.stepStats.substeps, 2);
  assert.ok(s.stepStats.droppedSeconds >= 0.05 - 1e-8);
  assert.ok(s.accumulator < 2 / 60);
  s.step(1 / 60);
  assert.equal(steps, 4);
  assert.equal(s.stepStats.substeps, 2);
  assert.ok(Math.abs(s.elapsed - 4 / 60) < 1e-8);
  s.dispose();
  const offline = new CitySimulation(fixture(), {
    trafficCount: 0,
    maxSubSteps: 6,
  });
  offline.step(0.1);
  assert.equal(offline.stepStats.substeps, 6);
  offline.dispose();
});

test("jittered 30 fps retains timing phase without unbounded catch-up debt", () => {
  const s = new CitySimulation(fixture(), { trafficCount: 0 });
  for (let i = 0; i < 300; i++) {
    s.step(i % 2 ? 0.034 : 1 / 15 - 0.034);
    assert.ok(s.stepStats.substeps <= 2);
    assert.ok(s.accumulator < 2 / 60);
  }
  assert.ok(
    Math.abs(s.elapsed - 10) <= 1 / 60 + 1e-8,
    `advanced ${s.elapsed} seconds`,
  );
  assert.equal(s.stepStats.droppedSeconds, 0);
  // A genuinely slow frame still discards debt while retaining its fraction.
  const fraction = s.accumulator % (1 / 60);
  s.step(0.1);
  assert.equal(s.stepStats.substeps, 2);
  assert.ok(
    Math.abs(s.accumulator - fraction - 1 / 60) < 1e-8 ||
      Math.abs(s.accumulator - fraction) < 1e-8,
  );
  assert.ok(s.stepStats.droppedSeconds >= 0.05 - 1e-8);
  s.dispose();
});

test("tight terrain-cell culling preserves Cannon contacts for tilted boxes and cylinders", () => {
  const s = new CitySimulation(fixture(), { trafficCount: 0 });
  const fast = s.world.narrowphase,
    native = new CANNON.Narrowphase(s.world),
    hf = new CANNON.Heightfield(
      Array.from({ length: 12 }, (_, x) =>
        Array.from({ length: 12 }, (_, y) => 0.17 * x + 0.09 * y),
      ),
      { elementSize: 2 },
    );
  const terrain = new CANNON.Body({ mass: 0, shape: hf });
  terrain.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  let count = 0;
  for (let i = 0; i < 40; i++) {
    const shape =
      i % 2
        ? new CANNON.Box(new CANNON.Vec3(0.86, 0.2, 2.07))
        : new CANNON.Cylinder(0.22, 0.22, 1.2, 8);
    const body = new CANNON.Body({ mass: 10, shape });
    const x = 3 + (i % 7) * 2.1,
      z = -3 - Math.floor(i / 7) * 2.1;
    body.position.set(x, 0.085 * x - 0.045 * z + (i % 4) * 0.2, z);
    body.quaternion.setFromEuler((i % 3) * 0.07, i * 0.4, (i % 5) * 0.07);
    const run = (n) => {
      const contacts = [];
      n.getContacts([body], [terrain], s.world, contacts, [], [], []);
      return contacts;
    };
    const a = run(native),
      b = run(fast);
    assert.equal(b.length, a.length, `contact count at pose${i}`);
    for (let j = 0; j < a.length; j++) {
      assert.ok(a[j].ni.distanceTo(b[j].ni) < 1e-7);
      assert.ok(a[j].ri.distanceTo(b[j].ri) < 1e-6);
    }
    count += b.length;
  }
  assert.ok(count > 20);
  s.dispose();
});

test("real city convex decomposition reduces collider count without changing building footprint area", () => {
  const city = JSON.parse(
      fs.readFileSync(
        new URL("../../data/cities/san-francisco/city.json", import.meta.url),
      ),
    ),
    s = new CitySimulation(city, { trafficCount: 0 });
  const areas = (sim) => {
    const result = new Map();
    for (const body of sim.staticBodies)
      for (const shape of body.shapes) {
        if (shape.surface !== "building") continue;
        const top = shape.faces[1];
        let a = 0;
        for (let i = 0; i < top.length; i++) {
          const p = shape.vertices[top[i]],
            q = shape.vertices[top[(i + 1) % top.length]];
          a += p.x * q.z - q.x * p.z;
        }
        result.set(
          shape.buildingId,
          (result.get(shape.buildingId) || 0) + Math.abs(a) / 2,
        );
      }
    return result;
  };
  const old = new Map();
  let triangleCount = 0;
  for (const building of city.buildings) {
    const coords = [],
      holes = [];
    for (const [i, ring] of [
      building.footprint,
      ...(building.footprintHoles || []),
    ].entries()) {
      if (i) holes.push(coords.length / 2);
      for (const p of ring) coords.push(p.x ?? p[0], p.y ?? p[1]);
    }
    const triangles = earcut(coords, holes, 2);
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 2,
        b = triangles[i + 1] * 2,
        c = triangles[i + 2] * 2,
        doubled = Math.abs(
          (coords[b] - coords[a]) * (coords[c + 1] - coords[a + 1]) -
            (coords[b + 1] - coords[a + 1]) * (coords[c] - coords[a]),
        );
      if (doubled < 0.025) continue;
      area += doubled / 2;
      triangleCount++;
    }
    if (area) old.set(building.id, area);
  }
  const now = areas(s);
  assert.equal(now.size, old.size);
  for (const [id, a] of old)
    assert.ok(Math.abs(now.get(id) - a) < 1e-5, `changed footprint ${id}`);
  assert.ok(s.buildingColliderCount < triangleCount * 0.5);
  s.dispose();
});
