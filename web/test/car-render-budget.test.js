import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { loadModel } from "./load-car-model.js";
import {
  prepareCarAsset,
  createCarVisual,
  setCarVisualState,
  setCarVisualShadows,
  updateCarVisual,
  applyCarDamage,
} from "../src/car-visual.js";
const template = prepareCarAsset(await loadModel());
const record = (damage = {}) => ({
  body: {
    position: new THREE.Vector3(137, 52, -289),
    quaternion: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.2, 1.3, -0.12),
    ),
  },
  controls: {},
  damage,
  raycast: {
    wheelInfos: [-0.79, 0.79, -0.79, 0.79].map((x, i) => ({
      worldTransform: {
        position: new THREE.Vector3(x, -0.235, i < 2 ? -1.37 : 1.31),
        quaternion: new THREE.Quaternion(),
      },
    })),
  },
});
const stats = (v) => {
  let draws = 0,
    triangles = 0,
    shadowDraws = 0,
    shadowTriangles = 0;
  for (const root of [v.root, ...v.wheels])
    root.traverseVisible((m) => {
      if (!m.isMesh) return;
      draws++;
      const tris =
        (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
      triangles += tris;
      if (m.castShadow) {
        shadowDraws++;
        shadowTriangles += tris;
      }
    });
  return { draws, triangles, shadowDraws, shadowTriangles };
};
const finite = (v) => {
  for (const root of [v.root, ...v.wheels])
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const a of Object.values(o.geometry.attributes))
        assert.ok(a.array.every(Number.isFinite));
    });
};
test("actual GLB traffic budgets: low <=8 draws/8k triangles, medium <=15 draws/15k triangles", () => {
  const hero = createCarVisual(),
    near = createCarVisual("#af4333", false, { detail: "medium" }),
    far = createCarVisual("#458085", false, { detail: "low" });
  const all = { hero: stats(hero), medium: stats(near), low: stats(far) };
  console.log(JSON.stringify(all, null, 2));
  assert.equal(all.hero.triangles, 213195);
  assert.ok(all.hero.shadowDraws <= 4);
  assert.ok(all.medium.draws <= 15);
  assert.ok(all.medium.triangles <= 15000);
  assert.ok(all.low.draws <= 8);
  assert.ok(all.low.triangles <= 8000);
  assert.equal(all.medium.shadowDraws, 0);
  assert.equal(all.low.shadowDraws, 0);
  for (const v of [near, far]) {
    setCarVisualShadows(v, true);
    assert.equal(stats(v).shadowDraws, 1);
    finite(v);
    const box = new THREE.Box3();
    v.root.updateMatrixWorld(true);
    v.root.traverseVisible((m) => {
      if (m.isMesh) box.union(new THREE.Box3().setFromObject(m));
    });
    const size = box.getSize(new THREE.Vector3());
    assert.ok(size.z > 3.8 && size.z < 4.5);
    assert.ok(size.x > 1.7 && size.x < 2.0);
    for (const wheel of v.wheels) {
      const b = new THREE.Box3();
      wheel.traverseVisible((m) => {
        if (m.isMesh) b.union(new THREE.Box3().setFromObject(m));
      });
      const s = b.getSize(new THREE.Vector3());
      assert.ok(s.y > 0.58 && s.z > 0.58);
    }
  }
  for (const v of [hero, near, far]) v.dispose();
});
test("60 repeated ownership/LOD transitions preserve all nodes/materials and source buffers", () => {
  const a = createCarVisual("#a83022", true),
    b = createCarVisual("#478298", false, { detail: "low" }),
    ra = record({ front: 0.8, left: 0.5 }),
    rb = record({ rear: 0.6 });
  const scene = new THREE.Scene();
  scene.add(a.root, b.root, ...a.wheels, ...b.wheels);
  const rootIds = [a.root.uuid, b.root.uuid],
    materialIds = [a.paint.uuid, b.paint.uuid];
  const sourceSnapshots = template.groups.map((g) =>
    g.geometry.attributes.position.array.slice(),
  );
  let sharedDisposes = 0;
  for (const g of template.groups)
    g.geometry.addEventListener("dispose", () => sharedDisposes++);
  const start = performance.now();
  for (let i = 0; i < 60; i++) {
    setCarVisualState(a, {
      player: i % 2 === 0,
      detail: i % 3 ? "medium" : "low",
    });
    setCarVisualState(b, {
      player: i % 2 !== 0,
      detail: i % 3 ? "medium" : "low",
    });
    updateCarVisual(a, ra, { weather: "night" });
    updateCarVisual(b, rb, { weather: "night" });
    assert.equal(a.root.uuid, rootIds[0]);
    assert.equal(b.root.uuid, rootIds[1]);
    assert.equal(a.paint.uuid, materialIds[0]);
    assert.equal(b.paint.uuid, materialIds[1]);
    let lights = 0;
    scene.traverseVisible((o) => {
      if (o.isLight) lights++;
    });
    assert.equal(lights, 2);
  }
  console.log(
    "60 damaged ownership plus LOD transitions CPU ms:",
    Math.round(performance.now() - start),
  );
  for (let i = 0; i < template.groups.length; i++)
    assert.deepEqual(
      template.groups[i].geometry.attributes.position.array,
      sourceSnapshots[i],
    );
  finite(a);
  finite(b);
  a.dispose();
  a.dispose();
  b.dispose();
  assert.equal(sharedDisposes, 0);
  assert.equal(scene.children.length, 0);
});
test("NPC damage deforms low exterior only; promoted full mesh shows persistent damage", () => {
  const v = createCarVisual("#a83022", false, { detail: "low" }),
    r = record({ front: 0.8, left: 0.5 });
  updateCarVisual(v, r);
  assert.ok(v.trafficDeformMeshes.some((d) => d.unique));
  assert.ok(v.deformMeshes.every((d) => !d.unique));
  setCarVisualState(v, { player: true });
  assert.ok(v.deformMeshes.some((d) => d.unique));
  assert.ok(v.decals.length);
  const geom = v.deformMeshes.map((d) => d.mesh.geometry);
  setCarVisualState(v, { player: false, detail: "medium" });
  setCarVisualState(v, { player: true });
  v.deformMeshes.forEach((d, i) => assert.equal(d.mesh.geometry, geom[i]));
  finite(v);
  v.dispose();
});
test("NaN controls/damage/transforms remain guarded", () => {
  const v = createCarVisual(),
    r = record({ front: NaN });
  updateCarVisual(v, r);
  r.body.position.x = NaN;
  assert.equal(updateCarVisual(v, r), false);
  r.body.position.x = 3;
  r.steeringAngle = NaN;
  updateCarVisual(v, r);
  finite(v);
  v.dispose();
});
