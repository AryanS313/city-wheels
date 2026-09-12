import * as THREE from "three";
import test from "node:test";
import assert from "node:assert/strict";
import { loadModel } from "./load-car-model.js";
import {
  prepareCarAsset,
  createCarVisual,
  setCarVisualState,
  updateCarVisual,
  applyCarDamage,
} from "../src/car-visual.js";
import {
  addVehicleDetails,
  updateVehicleDetails,
} from "../src/vehicle-details.js";
const t = prepareCarAsset(await loadModel());
const record = (damage = {}) => ({
  body: {
    id: 5,
    position: new THREE.Vector3(137, 52, -289),
    quaternion: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.2, 1.3, -0.12),
    ),
  },
  controls: {},
  damage,
  raycast: {
    wheelInfos: Array.from({ length: 4 }, (_, i) => ({
      worldTransform: {
        position: new THREE.Vector3(138 + i, 51, -288),
        quaternion: new THREE.Quaternion(),
      },
    })),
  },
});
const finite = (v) => {
  v.root.updateMatrixWorld(true);
  for (const root of [v.root, ...v.wheels])
    root.traverse((o) => {
      assert.ok(o.matrixWorld.elements.every(Number.isFinite));
      if (o.isMesh)
        for (const a of Object.values(o.geometry.attributes))
          assert.ok(a.array.every(Number.isFinite));
    });
};
test("actual GLB: 60 ownership swaps preserve nodes, materials, dent buffers and two active lamps", () => {
  const scene = new THREE.Scene(),
    a = createCarVisual("#a83022", true),
    b = createCarVisual("#478298", false),
    ra = record({ front: 0.8, left: 0.5 }),
    rb = record({ rear: 0.6 });
  scene.add(a.root, b.root, ...a.wheels, ...b.wheels);
  updateCarVisual(a, ra, { weather: "night" });
  updateCarVisual(b, rb, { weather: "night" });
  const roots = [a.root, b.root],
    materials = [a.paint.uuid, b.paint.uuid],
    buffers = [
      a.deformMeshes.map((d) => d.mesh.geometry),
      b.deformMeshes.map((d) => d.mesh.geometry),
    ];
  const start = performance.now();
  for (let i = 0; i < 60; i++) {
    setCarVisualState(a, { player: i % 2 === 0, detail: "full" });
    setCarVisualState(b, { player: i % 2 !== 0, detail: "full" });
    updateCarVisual(a, ra, { weather: "night" });
    updateCarVisual(b, rb, { weather: "night" });
    let lights = 0;
    scene.traverseVisible((o) => {
      if (o.isLight) lights++;
    });
    assert.equal(lights, 2);
    assert.equal(a.root, roots[0]);
    assert.equal(b.root, roots[1]);
    assert.equal(a.paint.uuid, materials[0]);
    assert.equal(b.paint.uuid, materials[1]);
    [a, b].forEach((v, j) =>
      v.deformMeshes.forEach((d, k) =>
        assert.equal(d.mesh.geometry, buffers[j][k]),
      ),
    );
  }
  console.log(
    "60 damaged-car ownership swaps CPU ms:",
    Math.round(performance.now() - start),
  );
  finite(a);
  finite(b);
  a.dispose();
  b.dispose();
  assert.equal(scene.children.length, 0);
});
test("20 detail cycles keep source geometry immutable; damage is independent; disposal is idempotent", () => {
  const source = t.groups.find((g) => g.deform),
    original = source.geometry.attributes.position.array.slice();
  let sharedDisposes = 0;
  const shared = new Set(t.groups.map((g) => g.geometry));
  shared.forEach((g) => g.addEventListener("dispose", () => sharedDisposes++));
  const a = createCarVisual("#aa3322", false, { detail: "medium" }),
    b = createCarVisual("#224477", false);
  const rb = record({ front: 0.75, right: 0.3 });
  for (let i = 0; i < 20; i++) {
    setCarVisualState(a, { player: false, detail: i % 2 ? "full" : "medium" });
    updateCarVisual(a, rb);
    finite(a);
  }
  assert.deepEqual(source.geometry.attributes.position.array, original);
  assert.equal(
    b.deformMeshes.find(
      (d) => d.original === source.geometry.attributes.position.array,
    ).unique,
    false,
  );
  a.dispose();
  a.dispose();
  b.dispose();
  assert.equal(sharedDisposes, 0);
});
test("NaN physics transforms/damage/steering cannot poison any visible buffer", () => {
  const v = createCarVisual(),
    r = record();
  updateCarVisual(v, r);
  const last = v.root.position.clone();
  r.body.position.x = NaN;
  assert.equal(updateCarVisual(v, r), false);
  assert.ok(v.root.position.equals(last));
  r.body.position.x = 137;
  r.body.quaternion.set(0, 0, 0, 0);
  assert.equal(updateCarVisual(v, r), false);
  r.body.quaternion.set(0, 0, 0, 1);
  r.steeringAngle = NaN;
  r.raycast.wheelInfos[0].worldTransform.position.x = Infinity;
  r.damage = { front: NaN, rear: Infinity, left: 0.5, right: -Infinity };
  assert.equal(updateCarVisual(v, r), true);
  finite(v);
  assert.equal(v.damage.front, 0);
  v.dispose();
});
test("Decals stay on translated/rotated car after ownership transfers and avoid shared texture disposal", () => {
  const v = createCarVisual("#224477", false),
    r = record({ front: 0.8, rear: 0.5, left: 0.6, right: 0.4 });
  updateCarVisual(v, r);
  setCarVisualState(v, { player: true });
  assert.ok(v.decals.length > 0);
  for (const d of v.decals) {
    d.geometry.computeBoundingBox();
    const box = d.geometry.boundingBox;
    for (const n of [...box.min.toArray(), ...box.max.toArray()])
      assert.ok(Math.abs(n) < 4);
  }
  finite(v);
  v.dispose();
});
test("police details are idempotent, inactive lights excluded and stolen car driver hidden", () => {
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return { fillRect() {}, fillText() {} };
        },
      };
    },
  };
  const v = createCarVisual(),
    r = { ...record(), role: "police", policeLights: true };
  addVehicleDetails(v, r);
  const original = v.details;
  addVehicleDetails(v, r);
  assert.equal(v.details, original);
  updateVehicleDetails(v, r, { wanted: false, player: false });
  assert.equal(v.policeGlow.visible, false);
  updateVehicleDetails(v, r, { wanted: true, player: false });
  assert.equal(v.policeGlow.visible, true);
  updateVehicleDetails(v, r, { wanted: true, player: true });
  assert.equal(v.policeGlow.visible, false);
  assert.equal(v.driver.visible, false);
  v.detailsDispose();
  v.dispose();
  v.dispose();
});
