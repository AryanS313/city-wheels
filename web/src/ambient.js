import * as THREE from "three";
import * as CANNON from "cannon-es";

// Shared convention: THREE/Cannon X east, Y up, Z south. Source city Y is north.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const UP = new CANNON.Vec3(0, 1, 0);
function seeded(seed = 1937) {
  let n = seed >>> 0;
  return () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function hash(value) {
  let n = 2166136261;
  for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function distanceToSegment(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = clamp(
      ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
      0,
      1,
    );
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}
function pointInRing(x, y, ring) {
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

class LayoutIndex {
  constructor(city) {
    this.city = city;
    this.cells = new Map();
    this.cell = 24;
    this.bounds = city.bounds || {
      minX: -500,
      maxX: 500,
      minY: -500,
      maxY: 500,
    };
    const add = (record, minX, minY, maxX, maxY) => {
      for (
        let x = Math.floor(minX / this.cell);
        x <= Math.floor(maxX / this.cell);
        x++
      )
        for (
          let y = Math.floor(minY / this.cell);
          y <= Math.floor(maxY / this.cell);
          y++
        ) {
          const key = `${x},${y}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key).push(record);
        }
    };
    for (const road of city.roads || []) {
      const width = road.width || 6.5;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i],
          margin = width / 2 + 5;
        add(
          { kind: "road", a, b, width, road },
          Math.min(a[0], b[0]) - margin,
          Math.min(a[1], b[1]) - margin,
          Math.max(a[0], b[0]) + margin,
          Math.max(a[1], b[1]) + margin,
        );
      }
    }
    for (const building of city.buildings || []) {
      const ring = building.footprint;
      if (!ring?.length) continue;
      const x = ring.map((p) => p[0]),
        y = ring.map((p) => p[1]);
      add(
        { kind: "building", ring },
        Math.min(...x) - 2,
        Math.min(...y) - 2,
        Math.max(...x) + 2,
        Math.max(...y) + 2,
      );
    }
    for (const junction of city.intersections || []) {
      if ((junction.osmWayIds?.length || 0) < 2) continue;
      const p = junction.position;
      if (!p) continue;
      add(
        { kind: "junction", x: p[0], y: p[1] },
        p[0] - 9,
        p[1] - 9,
        p[0] + 9,
        p[1] + 9,
      );
    }
  }
  clear(x, y, radius = 0.25, junctionClearance = 0) {
    const b = this.bounds;
    if (x < b.minX + 3 || x > b.maxX - 3 || y < b.minY + 3 || y > b.maxY - 3)
      return false;
    for (const item of this.cells.get(
      `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`,
    ) || []) {
      if (
        item.kind === "road" &&
        distanceToSegment(x, y, item.a, item.b) < item.width / 2 + radius + 0.3
      )
        return false;
      if (
        item.kind === "junction" &&
        junctionClearance > 0 &&
        Math.hypot(x - item.x, y - item.y) < junctionClearance
      )
        return false;
      if (item.kind === "building") {
        if (pointInRing(x, y, item.ring)) return false;
        for (let i = 0; i < item.ring.length; i++)
          if (
            distanceToSegment(
              x,
              y,
              item.ring[i],
              item.ring[(i + 1) % item.ring.length],
            ) <
            radius + 0.35
          )
            return false;
      }
    }
    return true;
  }
}

function roadSamples(road, spacing, offset, side) {
  const result = [],
    p = road.points;
  if (p.length < 2) return result;
  let total = 0,
    next = spacing * 0.25;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1],
      b = p[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    while (next <= total + len) {
      const t = (next - total) / len;
      result.push({
        x: lerp(a[0], b[0], t) + (dy / len) * offset * side,
        y: lerp(a[1], b[1], t) - (dx / len) * offset * side,
        z: lerp(a[2], b[2], t),
        tx: dx / len,
        ty: dy / len,
        along: next,
      });
      next += spacing;
    }
    total += len;
  }
  return result;
}

/** The returned array is the single source of truth for visible AND physical furniture. */
export function createStreetLayout(city, sampleElevation, options = {}) {
  const index = new LayoutIndex(city),
    objects = [],
    occupied = new Map(),
    rng = seeded(options.seed || 1937);
  const roads = [...(city.roads || [])].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  const nearby = (x, y, r) => {
    const cx = Math.floor(x / 8),
      cy = Math.floor(y / 8);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const o of occupied.get(`${i},${j}`) || [])
          if (
            Math.hypot(x - o.position[0], y + o.position[2]) <
            r + o.radius + 2.0
          )
            return true;
    return false;
  };
  for (const road of roads) {
    if (
      road.highway === "service" ||
      (road.width || 6.5) < 4 ||
      road.tags?.tunnel === "yes"
    )
      continue;
    for (const side of [-1, 1]) {
      for (const p of roadSamples(
        road,
        34 + (hash(road.id) % 12),
        (road.width || 6.5) / 2 + 1.25,
        side,
      )) {
        const variant = hash(`${road.id}:${side}:${Math.round(p.along)}`) % 10;
        const type = variant < 5 ? "pole" : variant < 9 ? "tree" : "bollard";
        const radius = type === "tree" ? 0.25 : type === "pole" ? 0.14 : 0.16;
        if (!index.clear(p.x, p.y, radius, 8) || nearby(p.x, p.y, radius))
          continue;
        const elevation = sampleElevation(p.x, p.y);
        if (!Number.isFinite(elevation)) continue;
        const hill =
          Math.abs(
            sampleElevation(p.x + 0.35, p.y) - sampleElevation(p.x - 0.35, p.y),
          ) +
          Math.abs(
            sampleElevation(p.x, p.y + 0.35) - sampleElevation(p.x, p.y - 0.35),
          );
        if (hill > 0.7) continue;
        const object = {
          id: `street-${road.id}-${side}-${Math.round(p.along)}`,
          type,
          position: [p.x, elevation, -p.y],
          radius,
          height:
            type === "pole" ? 7.2 : type === "tree" ? 6.3 + rng() * 1.5 : 0.92,
          headingRadians: Math.atan2(p.tx, p.ty),
          side,
          seed: hash(`${road.id}:${side}:${p.along}`),
        };
        objects.push(object);
        const key = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`;
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(object);
      }
    }
  }
  return objects;
}

const material = (color, roughness = 0.8, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
function batch(group, geometry, mat, transforms) {
  if (!transforms.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, mat, transforms.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  transforms.forEach((t, i) => {
    dummy.position.fromArray(t.position);
    dummy.rotation.set(0, t.yaw || 0, 0);
    dummy.scale.fromArray(t.scale || [1, 1, 1]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (t.color) mesh.setColorAt(i, new THREE.Color(t.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

/** Street furniture uses instancing; PointLights are limited to nearby lamps by updateLights. */
export function createStreetVisuals(objects, options = {}) {
  const group = new THREE.Group();
  group.name = "Shared street furniture";
  const lights = [];
  const pole = [],
    base = [],
    arm = [],
    fixture = [],
    bulb = [],
    trunk = [],
    canopy = [],
    bollards = [];
  for (const o of objects) {
    const [x, y, z] = o.position;
    if (o.type === "pole") {
      pole.push({
        position: [x, y + o.height / 2, z],
        scale: [o.radius, o.height, o.radius],
      });
      base.push({
        position: [x, y + 0.22, z],
        scale: [o.radius * 1.38, 0.44, o.radius * 1.38],
      });
      const angle = -(o.headingRadians || 0),
        outward = o.side || 1;
      const dx = Math.cos(angle) * -outward,
        dz = -Math.sin(angle) * -outward;
      arm.push({
        position: [x + dx * 0.55, y + o.height - 0.28, z + dz * 0.55],
        scale: [1.3, 0.1, 0.13],
        yaw: Math.atan2(-dz, dx),
      });
      fixture.push({
        position: [x + dx * 1.12, y + o.height - 0.33, z + dz * 1.12],
        scale: [0.53, 0.16, 0.25],
        yaw: Math.atan2(-dz, dx),
      });
      bulb.push({
        position: [x + dx * 1.12, y + o.height - 0.4, z + dz * 1.12],
        scale: [0.4, 0.03, 0.17],
        yaw: Math.atan2(-dz, dx),
      });
      lights.push({
        position: new THREE.Vector3(
          x + dx * 1.12,
          y + o.height - 0.52,
          z + dz * 1.12,
        ),
        objectId: o.id,
      });
    } else if (o.type === "tree") {
      trunk.push({
        position: [x, y + o.height * 0.35, z],
        scale: [o.radius, o.height * 0.7, o.radius],
      });
      const rng = seeded(o.seed);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + rng();
        canopy.push({
          position: [
            x + Math.cos(a) * 0.65,
            y + o.height * 0.75 + (i === 2 ? 0.6 : 0),
            z + Math.sin(a) * 0.65,
          ],
          scale: [1.05 + rng() * 0.35, 1.35 + rng() * 0.3, 1.05 + rng() * 0.35],
          color: [0x47683e, 0x5b734a, 0x395d38][i],
        });
      }
    } else if (o.type === "bollard")
      bollards.push({
        position: [x, y + o.height / 2, z],
        scale: [o.radius, o.height, o.radius],
      });
  }
  batch(
    group,
    new THREE.CylinderGeometry(0.7, 1, 1, 8),
    material(0x343d3d, 0.5, 0.65),
    pole,
  );
  batch(
    group,
    new THREE.CylinderGeometry(0.72, 1, 1, 8),
    material(0x343d3d, 0.5, 0.65),
    base,
  );
  batch(
    group,
    new THREE.BoxGeometry(1, 1, 1),
    material(0x343d3d, 0.5, 0.65),
    arm,
  );
  batch(
    group,
    new THREE.SphereGeometry(1, 10, 6),
    material(0x263131, 0.35, 0.6),
    fixture,
  );
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9e5bd,
    emissive: 0xffd79a,
    emissiveIntensity: 0.0,
    roughness: 0.35,
  });
  batch(group, new THREE.BoxGeometry(1, 1, 1), bulbMaterial, bulb);
  batch(
    group,
    new THREE.CylinderGeometry(0.64, 1, 1, 8),
    material(0x765b43, 0.98),
    trunk,
  );
  batch(
    group,
    new THREE.IcosahedronGeometry(1, 2),
    material(0xffffff, 0.95),
    canopy,
  );
  batch(
    group,
    new THREE.CylinderGeometry(0.9, 1, 1, 10),
    material(0x384244, 0.55, 0.5),
    bollards,
  );
  const activeLights = Array.from({ length: options.maxLights ?? 16 }, () => {
    const l = new THREE.PointLight(0xffd59b, 0, 18, 2);
    l.castShadow = false;
    group.add(l);
    return l;
  });
  const result = {
    group,
    objects,
    lights: activeLights,
    lampPositions: lights,
    updateLights(night, playerPosition) {
      const strength =
        typeof night === "boolean" ? Number(night) : clamp(night, 0, 1);
      bulbMaterial.emissiveIntensity = strength * 3;
      const near = playerPosition
        ? [...lights].sort(
            (a, b) =>
              a.position.distanceToSquared(playerPosition) -
              b.position.distanceToSquared(playerPosition),
          )
        : lights;
      activeLights.forEach((l, i) => {
        const ref = near[i];
        if (ref) l.position.copy(ref.position);
        l.intensity = ref ? strength * 34 : 0;
        l.visible = !!ref && strength > 0.01;
      });
    },
    dispose() {
      group.traverse((obj) => {
        obj.geometry?.dispose();
        if (obj.material) obj.material.dispose();
      });
      group.removeFromParent();
    },
  };
  return result;
}

export function createSidewalkRoutes(city, sampleElevation, objects = []) {
  const index = new LayoutIndex(city),
    routes = [];
  const obstacleGrid = new Map();
  for (const o of objects) {
    const key = `${Math.floor(o.position[0] / 12)},${Math.floor(-o.position[2] / 12)}`;
    if (!obstacleGrid.has(key)) obstacleGrid.set(key, []);
    obstacleGrid.get(key).push(o);
  }
  const clearFurniture = (x, y) => {
    const cx = Math.floor(x / 12),
      cy = Math.floor(y / 12);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const o of obstacleGrid.get(`${i},${j}`) || [])
          if (
            Math.hypot(x - o.position[0], y + o.position[2]) <
            o.radius + 0.53
          )
            return false;
    return true;
  };
  for (const road of city.roads || []) {
    if (road.highway === "service" || road.tags?.sidewalk === "no") continue;
    for (const side of [-1, 1]) {
      if (road.tags?.[`sidewalk:${side === 1 ? "right" : "left"}`] === "no")
        continue;
      let run = [];
      const finish = () => {
        if (run.length >= 7)
          routes.push({
            id: `walk-${road.id}-${side}-${routes.length}`,
            roadId: road.id,
            points: run,
            length: run
              .slice(1)
              .reduce(
                (s, p, i) => s + Math.hypot(p[0] - run[i][0], p[2] - run[i][2]),
                0,
              ),
          });
        run = [];
      };
      for (const p of roadSamples(
        road,
        2.8,
        (road.width || 6.5) / 2 + 2.15,
        side,
      )) {
        const z = sampleElevation(p.x, p.y);
        if (
          !Number.isFinite(z) ||
          !index.clear(p.x, p.y, 0.31) ||
          !clearFurniture(p.x, p.y)
        ) {
          finish();
          continue;
        }
        const point = [p.x, z, -p.y],
          previous = run.at(-1);
        if (
          previous &&
          (Math.hypot(point[0] - previous[0], point[2] - previous[2]) > 4.8 ||
            Math.abs(point[1] - previous[1]) > 1.05 ||
            !index.clear(
              (point[0] + previous[0]) / 2,
              -(point[2] + previous[2]) / 2,
              0.31,
            ))
        ) {
          finish();
        }
        run.push(point);
      }
      finish();
    }
  }
  return routes;
}

function personVisual(seed) {
  const rng = seeded(seed),
    group = new THREE.Group();
  const skins = [0xe8bc96, 0xc68b65, 0x8d573b, 0x5d3829, 0xd5a57e];
  const shirts = [
    0x345f73, 0xc69564, 0x782d31, 0x576246, 0x344653, 0xc9beb0, 0x4b3d68,
    0xb46847,
  ];
  const skin = material(skins[Math.floor(rng() * skins.length)]),
    shirt = material(shirts[Math.floor(rng() * shirts.length)]),
    pants = material(
      [0x283c50, 0x363638, 0x625950, 0x223d49][Math.floor(rng() * 4)],
    ),
    shoe = material(0x242529),
    hair = material(
      [0x282019, 0x5d4030, 0x978578, 0x262423][Math.floor(rng() * 4)],
    );
  const sphere = new THREE.SphereGeometry(1, 10, 8),
    capsule = new THREE.CapsuleGeometry(1, 1, 3, 8);
  const mesh = (parent, geometry, mat, pos, scale) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.castShadow = false;
    parent.add(m);
    return m;
  };
  mesh(group, sphere, shirt, [0, 0.16, 0], [0.235, 0.335, 0.155]).castShadow =
    true;
  mesh(group, sphere, pants, [0, -0.105, 0], [0.215, 0.155, 0.145]);
  mesh(group, sphere, skin, [0, 0.49, 0], [0.068, 0.095, 0.07]);
  mesh(
    group,
    sphere,
    skin,
    [0, 0.66, -0.008],
    [0.132, 0.162, 0.125],
  ).castShadow = true;
  const hairGeo = new THREE.SphereGeometry(
    1,
    10,
    6,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.57,
  );
  mesh(group, hairGeo, hair, [0, 0.69, 0], [0.139, 0.15, 0.131]);
  const eyes = material(0x272626);
  for (const side of [-1, 1])
    mesh(
      group,
      sphere,
      eyes,
      [side * 0.047, 0.69, -0.119],
      [0.011, 0.013, 0.008],
    );
  mesh(group, sphere, skin, [0, 0.649, -0.137], [0.021, 0.032, 0.032]);
  const arms = [],
    legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.25, 0.35, 0);
    group.add(arm);
    arms.push(arm);
    mesh(arm, capsule, shirt, [0, -0.145, 0], [0.063, 0.105, 0.063]);
    mesh(arm, capsule, skin, [0, -0.39, 0], [0.048, 0.089, 0.048]);
    mesh(arm, sphere, skin, [0, -0.545, -0.01], [0.052, 0.069, 0.043]);
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, -0.105, 0);
    group.add(leg);
    legs.push(leg);
    mesh(leg, capsule, pants, [0, -0.188, 0], [0.08, 0.135, 0.085]);
    mesh(leg, capsule, pants, [0, -0.49, 0], [0.06, 0.133, 0.067]);
    mesh(leg, sphere, shoe, [0, -0.701, -0.05], [0.082, 0.062, 0.152]);
  }
  if (rng() > 0.57) {
    const pack = material(0x6f503e);
    mesh(group, sphere, pack, [0, 0.16, 0.18], [0.17, 0.23, 0.09]);
  }
  group.scale.setScalar(0.94 + rng() * 0.12);
  return {
    group,
    arms,
    legs,
    materials: [skin, shirt, pants, shoe, hair, eyes],
    geometries: [sphere, capsule, hairGeo],
  };
}

/** Adults move by physical forces. Impacts release angular constraints; recovery occurs in-place. */
export class AmbientLife {
  constructor(city, sim, scene, options = {}) {
    this.city = city;
    this.sim = sim;
    this.scene = scene;
    this.elapsed = 0;
    this.people = [];
    this.group = new THREE.Group();
    this.group.name = "Ambient pedestrians";
    scene.add(this.group);
    this.options = options;
    this.random = seeded(options.seed ?? 7259);
    this.material = new CANNON.Material("ambient-person");
    // Cannon's friction equation cap is an impulse. Scale the character's .12
    // effective sliding coefficient by the fixed step; controller forces provide
    // walking traction while the capsule remains fully dynamic for impacts.
    this.contactMaterial = new CANNON.ContactMaterial(
      this.material,
      sim.world.defaultMaterial,
      { friction: 0.12 / 60, restitution: 0.015 },
    );
    sim.world.addContactMaterial(this.contactMaterial);
    // Explicit default material preserves existing contacts and enables the
    // low-friction capsule/controller pair without reducing road tyre grip.
    for (const body of sim.world.bodies)
      if (!body.material) body.material = sim.world.defaultMaterial;
    this.routes = createSidewalkRoutes(
      city,
      (x, y) => sim.sampleElevation(x, y),
      options.objects || options.streetObjects || [],
    );
    const player = sim.vehicle.body.position;
    const candidates = [];
    for (const route of this.routes)
      for (let index = 2; index < route.points.length - 2; index += 4) {
        const p = route.points[index],
          distance = Math.hypot(p[0] - player.x, p[2] - player.z);
        if (distance > 8 && distance < (options.radius ?? 440))
          candidates.push({
            route,
            index,
            p,
            distance,
            score: distance + this.random() * 90,
            scatter: this.random(),
          });
      }
    candidates.sort((a, b) => a.score - b.score);
    const nearby = candidates.filter((c) => c.distance < 160),
      farther = candidates
        .filter((c) => c.distance >= 160)
        .sort((a, b) => a.scatter - b.scatter);
    let nearSpawned = 0;
    for (const candidate of [...nearby, ...farther]) {
      if (this.people.length >= (options.count ?? 42)) break;
      if (
        candidate.distance < 160 &&
        nearSpawned >= (options.nearCount ?? 26) &&
        farther.length
      )
        continue;
      if (
        this.people.some(
          (person) =>
            Math.hypot(
              person.body.position.x - candidate.p[0],
              person.body.position.z - candidate.p[2],
            ) < 4.2,
        )
      )
        continue;
      if (
        [sim.vehicle, ...sim.traffic].some(
          (car) =>
            Math.hypot(
              car.body.position.x - candidate.p[0],
              car.body.position.z - candidate.p[2],
            ) < 5,
        )
      )
        continue;
      this.spawn(candidate);
      if (candidate.distance < 160) nearSpawned++;
    }
    // Cannon dispatches preStep AFTER solving contacts. Queue forces in postStep
    // instead, so the following fixed-step contact solver sees intended motion.
    this._postStep = () => this.physicsStep(sim.world.dt || 1 / 60);
    sim.world.addEventListener("postStep", this._postStep);
    this.physicsStep(0);
  }
  spawn(candidate) {
    const { route, index, p } = candidate,
      seed = Math.floor(this.random() * 0xffffffff),
      visual = personVisual(seed);
    const body = new CANNON.Body({
      mass: 75,
      material: this.material,
      position: new CANNON.Vec3(p[0], p[1] + 0.85, p[2]),
      fixedRotation: true,
      linearDamping: 0.25,
      angularDamping: 0.5,
      allowSleep: false,
    });
    body.addShape(new CANNON.Cylinder(0.22, 0.22, 1.2, 8));
    body.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, 0.6, 0));
    body.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, -0.6, 0));
    body.isPedestrian = true;
    body.surface = "pedestrian";
    body.collisionResponse = true;
    const direction = this.random() > 0.5 ? 1 : -1,
      target = clamp(index + direction, 0, route.points.length - 1);
    const person = {
      id: `adult-${this.people.length}`,
      body,
      visual,
      route,
      target,
      direction,
      speed: 1.12 + this.random() * 0.4,
      phase: this.random() * Math.PI * 2,
      fallUntil: 0,
      recovering: false,
      yaw: 0,
      seed,
    };
    body.addEventListener("collide", (event) => {
      if (!event.body?.isVehicle) return;
      const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (impact < 1.6 || this.elapsed < person.fallUntil) return;
      person.fallUntil = this.elapsed + 4.5 + this.random() * 2;
      person.recovering = false;
      body.fixedRotation = false;
      body.updateMassProperties();
      body.angularVelocity.x +=
        (event.body.velocity.z - body.velocity.z) * 0.32;
      body.angularVelocity.z -=
        (event.body.velocity.x - body.velocity.x) * 0.32;
      body.wakeUp();
    });
    this.sim.world.addBody(body);
    this.group.add(visual.group);
    this.people.push(person);
    this.syncPerson(person, 0);
  }
  physicsStep(dt) {
    this.elapsed += dt;
    if (dt > 0) this.contactMaterial.friction = 0.12 * dt;
    for (const person of this.people) {
      const { body, route } = person;
      if (person.fallUntil > this.elapsed) continue;
      if (!body.fixedRotation) {
        if (
          [this.sim.vehicle, ...this.sim.traffic].some(
            (car) =>
              Math.hypot(
                car.body.position.x - body.position.x,
                car.body.position.z - body.position.z,
              ) < 3.5,
          )
        )
          continue;
        person.recovering = true;
        const ground = this.sim.sampleElevation(
            body.position.x,
            -body.position.z,
          ),
          up = body.quaternion.vmult(UP);
        body.torque.x += -up.z * 180 - body.angularVelocity.x * 38;
        body.torque.z += up.x * 180 - body.angularVelocity.z * 38;
        body.force.y +=
          75 *
          (9.81 +
            clamp(
              (ground + 0.86 - body.position.y) * 22 - body.velocity.y * 8,
              -8,
              14,
            ));
        if (up.y > 0.94 && body.position.y > ground + 0.69) {
          body.fixedRotation = true;
          body.updateMassProperties();
          body.angularVelocity.setZero();
          person.recovering = false;
        } else continue;
      }
      let target = route.points[person.target];
      if (
        Math.hypot(target[0] - body.position.x, target[2] - body.position.z) <
        0.62
      ) {
        if (
          person.target + person.direction >= route.points.length ||
          person.target + person.direction < 0
        )
          person.direction *= -1;
        person.target = clamp(
          person.target + person.direction,
          0,
          route.points.length - 1,
        );
        target = route.points[person.target];
      }
      const dx = target[0] - body.position.x,
        dz = target[2] - body.position.z,
        distance = Math.hypot(dx, dz) || 1;
      let vx = (dx / distance) * person.speed,
        vz = (dz / distance) * person.speed;
      // Pedestrians yield to each other and nearby traffic without entering the road.
      for (const other of this.people) {
        if (other === person) continue;
        const ox = body.position.x - other.body.position.x,
          oz = body.position.z - other.body.position.z,
          dist = Math.hypot(ox, oz);
        if (dist > 0 && dist < 0.85) {
          vx += (ox / dist) * (0.85 - dist) * 2;
          vz += (oz / dist) * (0.85 - dist) * 2;
        }
      }
      for (const car of [this.sim.vehicle, ...this.sim.traffic]) {
        const rx = car.body.position.x - body.position.x,
          rz = car.body.position.z - body.position.z;
        if (Math.hypot(rx, rz) < 3.0 && rx * vx + rz * vz > 0) {
          vx *= 0.05;
          vz *= 0.05;
        }
      }
      const fx = 75 * (vx - body.velocity.x) * 5.5,
        fz = 75 * (vz - body.velocity.z) * 5.5,
        force = Math.hypot(fx, fz),
        scale = Math.min(1, 480 / (force || 1));
      body.force.x += fx * scale;
      body.force.z += fz * scale;
      if (Math.hypot(vx, vz) > 0.1) person.yaw = Math.atan2(-vx, -vz);
      body.quaternion.setFromAxisAngle(UP, person.yaw);
      body.aabbNeedsUpdate = true;
    }
  }
  syncPerson(person, dt) {
    const { body, visual } = person;
    visual.group.position.copy(body.position);
    visual.group.quaternion.copy(body.quaternion);
    const moving = person.fallUntil <= this.elapsed && !person.recovering,
      speed = Math.hypot(body.velocity.x, body.velocity.z);
    person.phase += Math.min(speed, 2.4) * dt * 5.4;
    const walk = moving
      ? Math.sin(person.phase) * Math.min(0.48, speed * 0.31)
      : 0.14;
    visual.legs[0].rotation.x = walk;
    visual.legs[1].rotation.x = -walk;
    visual.arms[0].rotation.x = -walk * 0.82;
    visual.arms[1].rotation.x = walk * 0.82;
    visual.arms[0].rotation.z = moving ? 0.08 : 0.72;
    visual.arms[1].rotation.z = moving ? -0.08 : -0.72;
    visual.group.visible =
      body.position.distanceTo(this.sim.vehicle.body.position) <
      (this.options.drawDistance ?? 270);
  }
  // Call after sim.step(dt). Controller forces are queued after each fixed step.
  update(dt) {
    for (const person of this.people)
      this.syncPerson(person, clamp(dt, 0, 0.1));
  }
  dispose() {
    this.sim.world.removeEventListener("postStep", this._postStep);
    this.sim.world.removeContactMaterial(this.contactMaterial);
    for (const person of this.people) {
      this.sim.world.removeBody(person.body);
      for (const m of person.visual.materials) m.dispose();
      for (const g of person.visual.geometries) g.dispose();
    }
    this.people.length = 0;
    this.group.removeFromParent();
  }
}
