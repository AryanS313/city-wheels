import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { WebGLAttributes } from "three/src/renderers/webgl/WebGLAttributes.js";
import { WebGLObjects } from "three/src/renderers/webgl/WebGLObjects.js";
import { CitySimulation } from "../src/physics.js";
import { AmbientLife, createStreetLayout } from "../src/ambient.js";
import { createCityPlaces } from "../src/places.js";
const city = JSON.parse(
  fs.readFileSync(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  ),
);

// Exercise Three's actual instance-buffer lifecycle without claiming a GPU render.
function instanceBufferHarness(entries) {
  const live = new Set();
  let created = 0,
    uploaded = 0;
  const gl = {
    ARRAY_BUFFER: 34962,
    FLOAT: 5126,
    createBuffer() {
      const handle = { id: ++created };
      live.add(handle);
      return handle;
    },
    deleteBuffer(handle) {
      live.delete(handle);
    },
    bindBuffer() {},
    bufferData(_target, array) {
      uploaded += array.byteLength;
    },
    bufferSubData(_target, _offset, array, start = 0, count) {
      uploaded += (count ?? array.length - start) * array.BYTES_PER_ELEMENT;
    },
  };
  const info = { render: { frame: 0 } },
    attributes = WebGLAttributes(gl);
  const renderer = WebGLObjects(
    gl,
    {
      get(_object, geometry) {
        return geometry;
      },
      update() {},
    },
    attributes,
    info,
  );
  return {
    live,
    get created() {
      return created;
    },
    get uploaded() {
      return uploaded;
    },
    render() {
      uploaded = 0;
      info.render.frame++;
      for (const entry of entries) renderer.update(entry.mesh);
      return uploaded;
    },
  };
}

test("repeated displaced-driver spawning/reset keeps instance buffers and world bodies bounded, then releases buffers", () => {
  const sim = new CitySimulation(city, {
    trafficCount: 40,
    policeCount: 4,
    parkedCount: 16,
  });
  const ground = (x, y) => sim.sampleElevation(x, y),
    street = createStreetLayout(city, ground);
  const places = createCityPlaces(city, ground, { streetObjects: street }),
    objects = [...street, ...places.obstacles];
  sim.addObstacles(objects);
  const scene = new THREE.Scene(),
    life = new AmbientLife(city, sim, scene, {
      count: 150,
      objects,
      activitySpots: places.activitySpots,
    });
  const entries = [...life.batches.entries.values()],
    harness = instanceBufferHarness(entries);
  const initialArrays = entries.map((e) => [
    e.mesh.instanceMatrix.array,
    e.mesh.instanceColor.array,
  ]);
  const bodyCount = sim.world.bodies.length,
    listeners = sim.world._listeners.postStep.length;
  try {
    assert.equal(sim.allVehicles.length, 57);
    assert.equal(life.people.length, 150);
    harness.render();
    const allocations = harness.created;
    const colorVersions = entries.map((e) => e.mesh.instanceColor.version);
    life.update(1 / 60);
    assert.ok(harness.render() < 400000);
    assert.deepEqual(
      entries.map((e) => e.mesh.instanceColor.version),
      colorVersions,
      "Static resident colors should not be uploaded every frame",
    );
    const focusPosition = sim.vehicle.body.position.clone();
    sim.vehicle.body.position.set(10000, 10000, 10000);
    for (const person of life.people) life.syncPerson(person, 0, true);
    life.batches.finish();
    assert.ok(harness.render() > 0);
    for (const entry of entries)
      for (let i = 0; i < entry.mesh.count; i++) {
        const matrix = entry.mesh.instanceMatrix.array.subarray(
          i * 16,
          (i + 1) * 16,
        );
        assert.equal(matrix[0], 0);
        assert.equal(matrix[5], 0);
        assert.equal(matrix[10], 0);
      }
    sim.vehicle.body.position.copy(focusPosition);
    for (const person of life.people) life.syncPerson(person, 0, true);
    life.batches.finish();
    harness.render();
    assert.ok(
      entries.some((entry) =>
        entry.mesh.instanceMatrix.array.some((value) => value > 1),
      ),
      "Returning near residents restores visible transforms",
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const vehicle of sim.traffic) {
        const driver = life.spawnOccupant(vehicle);
        if (driver)
          assert.equal(
            life.spawnOccupant(vehicle),
            driver,
            "One physical driver per vehicle",
          );
      }
      assert.equal(life.people.length, 182);
      life.update(1 / 60);
      harness.render();
      for (const [i, entry] of entries.entries()) {
        assert.equal(entry.mesh.instanceMatrix.array, initialArrays[i][0]);
        assert.equal(entry.mesh.instanceColor.array, initialArrays[i][1]);
        assert.ok(entry.mesh.count <= entry.mesh.instanceMatrix.count);
        assert.ok(
          entry.mesh.instanceMatrix.array
            .subarray(0, entry.mesh.count * 16)
            .every(Number.isFinite),
        );
      }
      const oldBodies = life.people.map((p) => p.body);
      assert.equal(life.reset(), 150);
      life.update(1 / 60);
      harness.render();
      assert.equal(sim.world.bodies.length, bodyCount);
      assert.equal(sim.pedestrianBodies.length, 150);
      for (const body of oldBodies) {
        assert.equal(body.world, null);
        assert.equal(sim.world.getBodyById(body.id), undefined);
      }
      assert.equal(life.group.children.length, 154);
      assert.equal(sim.world._listeners.postStep.length, listeners);
      assert.equal(harness.created, allocations);
    }
  } finally {
    life.dispose();
    sim.dispose();
  }
  assert.equal(
    harness.live.size,
    0,
    "Disposing geometry alone leaves InstancedMesh attribute buffers allocated",
  );
  assert.equal(scene.children.length, 0);
  assert.equal(sim.pedestrianBodies.length, 0);
});
