import fs from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import {
  prepareCarAsset,
  createCarVisual,
  applyCarDamage,
} from "../src/car-visual.js";
// Geometry verification in Node: remove texture bindings from a memory-only JSON copy.
const bytes = fs.readFileSync(
  new URL("../public/assets/car/model.glb", import.meta.url),
);
const json = JSON.parse(
  bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
);
function strip(o) {
  if (!o || typeof o !== "object") return;
  for (const k of Object.keys(o)) {
    if (/texture$/i.test(k)) delete o[k];
    else strip(o[k]);
  }
}
strip(json.materials);
const rawJSON = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(rawJSON.length / 4) * 4, 32);
rawJSON.copy(padded);
const binStart = 20 + bytes.readUInt32LE(12),
  bin = bytes.subarray(binStart);
const clean = Buffer.alloc(20 + padded.length + bin.length);
clean.writeUInt32LE(0x46546c67, 0);
clean.writeUInt32LE(2, 4);
clean.writeUInt32LE(clean.length, 8);
clean.writeUInt32LE(padded.length, 12);
clean.writeUInt32LE(0x4e4f534a, 16);
padded.copy(clean, 20);
bin.copy(clean, 20 + padded.length);
const gltf = await new GLTFLoader().parseAsync(
  clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.length),
  "",
);
const t = prepareCarAsset(gltf.scene);
const visual = createCarVisual("#bb3020", true);
visual.root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(visual.root),
  before =
    visual.deformMeshes[0].mesh.geometry.attributes.position.array.slice();
applyCarDamage(visual, { front: 0.8, rear: 0.1, left: 0.4, right: 0 });
const after = visual.deformMeshes[0].mesh.geometry.attributes.position.array;
let changed = 0;
for (let i = 0; i < after.length; i++)
  if (Math.abs(before[i] - after[i]) > 0.00001) changed++;
const report = {
  model: t.source,
  triangles: t.triangleCount,
  mergedDrawGroups: t.groups.length,
  steeringPosition: visual.steering.position.toArray(),
  bodyDimensions: box.getSize(new THREE.Vector3()).toArray(),
  bodyBounds: [box.min.toArray(), box.max.toArray()],
  wheelBounds: visual.wheels.map((w) =>
    new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3()).toArray(),
  ),
  damageChangedCoordinates: changed,
  scratchDecals: visual.decals.length,
  windshieldOpacity: visual.windshieldMesh.material.opacity,
  geometryOnly: true,
};
console.log(
  "Detailed car geometry and damage:",
  report.triangles,
  "triangles,",
  report.damageChangedCoordinates,
  "deformed coordinates",
);
if (
  t.triangleCount < 10000 ||
  changed === 0 ||
  visual.wheels.length !== 4 ||
  !visual.windshieldMesh
)
  process.exit(1);
