import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CitySimulation } from "../src/physics.js";
import { PursuitSystem } from "../src/pursuit.js";
const cityPath =
  process.env.CITY_WHEELS_CITY ||
  fileURLToPath(
    new URL("../../data/cities/san-francisco/city.json", import.meta.url),
  );
const exists = fs.existsSync(cityPath);

test(
  "real-city spawns are inside terrain and clear buildings, with no explosive first-step impulse",
  { skip: !exists },
  () => {
    const city = JSON.parse(fs.readFileSync(cityPath)),
      s = new CitySimulation(city, { trafficCount: 40, parkedCount: 16 });
    assert.equal(s.allVehicles.length, 57);
    for (const v of s.allVehicles) {
      const f = v.body.vectorToWorldFrame({ x: 0, y: 0, z: -1 });
      assert.ok(
        s.isSpawnClear({
          x: v.body.position.x,
          y: -v.body.position.z,
          headingRadians: Math.atan2(f.x, -f.z),
        }),
        `bad spawn ${v.id}`,
      );
    }
    s.controls.brake = 1;
    s.step(1 / 60);
    assert.ok(
      Math.max(...s.allVehicles.map((v) => v.body.velocity.length())) < 3,
    );
    s.dispose();
  },
);

test(
  "terrain triangle retention is bounded and police visibility does not fill it",
  { skip: !exists },
  () => {
    const city = JSON.parse(fs.readFileSync(cityPath)),
      s = new CitySimulation(city, { trafficCount: 4, policeCount: 1 }),
      p = new PursuitSystem(s, city),
      shape = s.groundBody.shapes[0];
    for (let i = 0; i < 10000; i++)
      shape.getConvexTrianglePillar(i % 512, Math.floor(i / 512), false);
    assert.equal(s.terrainCacheStats.entries, 8192);
    assert.equal(Object.keys(shape._cachedPillars).length, 0);
    const count = s.terrainCacheStats.entries,
      cop = p.officers[0];
    cop.body.position.set(0, 180, 0);
    s.vehicle.body.position.set(80, 180, 75);
    assert.equal(p.hasLineOfSight(cop), true);
    assert.equal(s.terrainCacheStats.entries, count);
    s.dispose();
  },
);

test(
  "56 actual-city thefts preserve identities and finite camera/physics telemetry",
  { skip: !exists },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        fileURLToPath(new URL("./theft-stress.js", import.meta.url)),
        cityPath,
        "5",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = result.stdout.trim().split("\n"),
      last = JSON.parse(lines.at(-1));
    assert.equal(last.swaps, 56);
    assert.equal(last.idsUnchanged, true);
    assert.deepEqual(last.issues, []);
  },
);
