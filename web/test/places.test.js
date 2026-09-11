import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { createCityPlaces, createPlaceVisuals } from "../src/places.js";
import { createStreetLayout } from "../src/ambient.js";
import { sampleTerrain } from "../src/physics.js";
const city = JSON.parse(
  fs.readFileSync(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  ),
);
const ground = (x, n) => sampleTerrain(city, x, n);
const objects = createStreetLayout(city, ground);
const layout = createCityPlaces(city, ground, { streetObjects: objects });
const segments = city.roads.flatMap((r) =>
  r.points
    .slice(1)
    .map((p, i) => ({ a: r.points[i], b: p, width: r.width || 6.5 })),
);
const near = (x, y, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(
        1,
        ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function corners(o) {
  const c = Math.cos(o.headingRadians),
    s = Math.sin(o.headingRadians),
    points = [];
  for (const x of [-o.width / 2, o.width / 2])
    for (const z of [-o.depth / 2, o.depth / 2])
      points.push([
        o.position[0] + c * x + s * z,
        -o.position[2] + s * x - c * z,
      ]);
  return points;
}

test("district venues are deterministic, varied, and geographically spread", () => {
  assert.deepEqual(
    layout,
    createCityPlaces(city, ground, { streetObjects: objects }),
  );
  assert.ok(layout.statistics.venues >= 24 && layout.statistics.venues <= 45);
  assert.equal(layout.statistics.restAreas, 5);
  for (const k of ["cafe", "restaurant", "hotel", "home"])
    assert.ok(layout.places.filter((p) => p.kind === k).length >= 4, k);
  const x = layout.places.map((p) => p.position[0]),
    z = layout.places.map((p) => p.position[2]);
  assert.ok(Math.max(...x) - Math.min(...x) > 700);
  assert.ok(Math.max(...z) - Math.min(...z) > 700);
  assert.equal(
    new Set(layout.places.map((p) => p.id)).size,
    layout.places.length,
  );
});
test("real venue names are grounded in the supplied OSM building tags; invented places are marked", () => {
  for (const p of layout.places) {
    if (p.source === "osm-tag") {
      const b = city.buildings.find((b) => b.id === p.buildingId);
      assert.equal(p.name, b.tags.name || b.name);
      assert.equal(p.fictional, false);
    } else assert.equal(p.fictional, true);
  }
  assert.ok(layout.statistics.osmNamed >= 8);
});
test("every solid furniture corner preserves at least 1.40m of clear space beside every road", () => {
  let clearance = Infinity;
  for (const o of layout.obstacles)
    for (const [x, n] of corners(o))
      for (const r of segments) {
        const d = near(x, n, r.a, r.b) - r.width / 2;
        clearance = Math.min(clearance, d);
        assert.ok(d >= 1.4, `${o.id}: road clearance ${d}`);
      }
  console.log(
    `Minimum measured corner-to-road-edge walking clearance: ${clearance.toFixed(3)}m`,
  );
});
test("all solid furniture is outside every building, with valid matching collision dimensions", () => {
  for (const o of layout.obstacles) {
    assert.equal(o.type, "barrier");
    assert.ok(o.width > 0 && o.depth > 0 && o.height > 0);
    assert.ok(o.position.every(Number.isFinite));
    assert.equal(o.height / 2, o.halfExtents[1]);
    for (const [x, n] of corners(o))
      for (const b of city.buildings)
        assert.equal(
          inRing(x, n, b.footprint),
          false,
          `${o.id} overlaps ${b.id}`,
        );
  }
});
test("all activity participants have explicit usable coordinates and seating references", () => {
  for (const k of ["coffee", "dine", "chat", "rest"])
    assert.ok(layout.activitySpots.some((a) => a.type === k));
  for (const a of layout.activitySpots) {
    assert.equal(a.participants.length, a.capacity);
    assert.ok(layout.places.some((p) => p.id === a.placeId));
    for (const p of a.participants) {
      assert.ok(p.position.every(Number.isFinite));
      assert.ok(Number.isFinite(p.facing));
      if (p.posture)
        assert.ok(layout.obstacles.some((o) => o.id === p.ownObstacleId));
      for (const r of segments)
        assert.ok(
          near(p.position[0], -p.position[2], r.a, r.b) > r.width / 2 + 0.8,
        );
    }
  }
});
test("scenery builds bounded instanced geometry without requiring browser canvas", () => {
  const group = createPlaceVisuals(layout.places);
  assert.ok(group instanceof THREE.Group);
  assert.ok(group.children.some((m) => m.isInstancedMesh));
  assert.ok(
    group.children.length < 65,
    `draw objects ${group.children.length}`,
  );
  for (const obj of group.children) {
    obj.geometry.computeBoundingBox();
    assert.ok(Number.isFinite(obj.geometry.boundingBox.min.x));
  }
});
