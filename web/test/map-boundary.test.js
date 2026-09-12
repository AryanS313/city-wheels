import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { CitySimulation } from "../src/physics.js";
import {
  createBoundaryLayout,
  createBoundaryVisuals,
} from "../src/map-boundary.js";
const city = JSON.parse(
  fs.readFileSync(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  ),
);

test("real district boundary forms a contiguous, finite perimeter entirely inside its outer metre", () => {
  const sim = new CitySimulation(city, { trafficCount: 0, parkedCount: 0 }),
    ground = (x, n) => sim.sampleElevation(x, n);
  const layout = createBoundaryLayout(city, ground);
  assert.equal(layout.length, 1000);
  assert.deepEqual(layout, createBoundaryLayout(city, ground));
  assert.equal(new Set(layout.map((p) => p.id)).size, layout.length);
  for (const edge of ["north", "south", "east", "west"]) {
    const list = layout.filter((p) => p.edge === edge);
    assert.equal(list.length, 250);
    const alongX = edge === "north" || edge === "south",
      axis = alongX ? 0 : 2,
      across = alongX ? 2 : 0;
    const ranges = list.map((p) => [
      p.position[axis] - p.width / 2,
      p.position[axis] + p.width / 2,
    ]);
    for (let i = 1; i < ranges.length; i++)
      assert.ok(
        ranges[i][0] < ranges[i - 1][1] - 0.1,
        "Every adjacent segment must overlap",
      );
    for (const p of list) {
      assert.ok(
        [...p.position, p.width, p.depth, p.height, p.headingRadians].every(
          Number.isFinite,
        ),
      );
      assert.ok(Math.abs(p.position[across]) >= 499);
      assert.ok(Math.abs(p.position[across]) + p.depth / 2 <= 500);
      assert.ok(p.position[axis] - p.width / 2 >= -500);
      assert.ok(p.position[axis] + p.width / 2 <= 500);
      for (let i = 0; i <= 20; i++)
        for (const acrossOffset of [-p.depth / 2, 0, p.depth / 2]) {
          const along = p.position[axis] + p.width * (i / 20 - 0.5),
            x = alongX ? along : p.position[0] + acrossOffset,
            z = alongX ? p.position[2] + acrossOffset : along;
          const h = ground(x, -z);
          assert.ok(p.position[1] < h + 0.01);
          assert.ok(p.position[1] + p.height - h > 2.96);
        }
    }
  }
  // All road geometry more than one metre inside the tile remains untouched.
  for (const p of layout) {
    const nearestEdge =
      500 -
      Math.abs(p.position[p.edge === "north" || p.edge === "south" ? 2 : 0]);
    assert.ok(nearestEdge + p.depth / 2 < 1);
  }
  sim.dispose();
});

test("visible solid bands exactly cover each physical barrier and collide at every city edge", () => {
  const sim = new CitySimulation(city, { trafficCount: 0, parkedCount: 0 }),
    ground = (x, n) => sim.sampleElevation(x, n);
  const layout = createBoundaryLayout(city, ground),
    visuals = createBoundaryVisuals(layout);
  sim.addObstacles(layout);
  const shapeCount = sim.obstacles.filter((o) => o.districtBoundary).length;
  assert.equal(shapeCount, layout.length);
  assert.equal(visuals.meshes.length, 3);
  const matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i];
    let top = p.position[1];
    for (const mesh of visuals.meshes) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      assert.ok(Math.abs(position.y - scale.y / 2 - top) < 0.00002);
      top = position.y + scale.y / 2;
      assert.ok(Math.abs(scale.x - p.width) < 0.000001);
      assert.ok(Math.abs(scale.z - p.depth) < 0.000001);
      assert.ok(Math.abs(position.x - p.position[0]) < 0.00002);
      assert.ok(Math.abs(position.z - p.position[2]) < 0.00002);
    }
    assert.ok(Math.abs(top - (p.position[1] + p.height)) < 0.00002);
  }
  for (const edge of ["north", "south", "east", "west"]) {
    const panel = layout.filter((p) => p.edge === edge)[125],
      x = panel.position[0],
      z = panel.position[2],
      y = panel.position[1] + panel.height - 0.5;
    const acrossX = edge === "west" || edge === "east",
      from = new CANNON.Vec3(x - (acrossX ? 3 : 0), y, z - (acrossX ? 0 : 3)),
      to = new CANNON.Vec3(x + (acrossX ? 3 : 0), y, z + (acrossX ? 0 : 3));
    let hit = false;
    sim.world.raycastAll(from, to, { skipBackfaces: false }, (result) => {
      hit ||= result.shape.obstacleId === panel.id;
    });
    assert.equal(hit, true, `${edge} panel must physically stop a ray`);
  }
  visuals.dispose();
  sim.dispose();
});

test("boundary builder rejects missing or non-finite terrain instead of producing corrupt matrices", () => {
  assert.throws(
    () =>
      createBoundaryLayout(
        { bounds: { minX: 0, maxX: Infinity, minY: 0, maxY: 20 } },
        () => 0,
      ),
    RangeError,
  );
  assert.throws(() => createBoundaryLayout(city, () => NaN), RangeError);
});
