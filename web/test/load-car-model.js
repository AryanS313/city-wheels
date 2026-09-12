import fs from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export async function loadModel() {
  const bytes = fs.readFileSync(
    new URL("../public/assets/car/model.glb", import.meta.url),
  );
  const json = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
  );
  // Node has no image decoder; preserve geometry/material extensions and strip texture references only in memory.
  function strip(o) {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (/texture$/i.test(k)) delete o[k];
      else strip(o[k]);
    }
  }
  strip(json.materials);
  const j = Buffer.from(JSON.stringify(json)),
    p = Buffer.alloc(Math.ceil(j.length / 4) * 4, 32);
  j.copy(p);
  const bin = bytes.subarray(20 + bytes.readUInt32LE(12)),
    clean = Buffer.alloc(20 + p.length + bin.length);
  clean.writeUInt32LE(0x46546c67, 0);
  clean.writeUInt32LE(2, 4);
  clean.writeUInt32LE(clean.length, 8);
  clean.writeUInt32LE(p.length, 12);
  clean.writeUInt32LE(0x4e4f534a, 16);
  p.copy(clean, 20);
  bin.copy(clean, 20 + p.length);
  return (
    await new GLTFLoader().parseAsync(
      clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.length),
      "",
    )
  ).scene;
}
