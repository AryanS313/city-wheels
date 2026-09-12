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

function personVisual(seed, activity = "walk", persona = "resident") {
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
    legs = [],
    knees = [];
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
    const knee = new THREE.Group();
    knee.position.y = -0.37;
    leg.add(knee);
    knees.push(knee);
    mesh(knee, capsule, pants, [0, -0.12, 0], [0.06, 0.133, 0.067]);
    mesh(knee, sphere, shoe, [0, -0.331, -0.05], [0.082, 0.062, 0.152]);
  }
  if (rng() > 0.57) {
    const pack = material(0x6f503e);
    mesh(group, sphere, pack, [0, 0.16, 0.18], [0.17, 0.23, 0.09]);
  }
  const accessories = [];
  if (activity === "coffee" || activity === "dine") {
    const cupMaterial = material(0xf4eee2),
      lidMaterial = material(0x3f3733);
    const cup = mesh(
      arms[0],
      new THREE.CylinderGeometry(0.045, 0.036, 0.12, 8),
      cupMaterial,
      [0, -0.56, -0.025],
      [1, 1, 1],
    );
    mesh(cup, sphere, lidMaterial, [0, 0.065, 0], [0.048, 0.012, 0.048]);
    accessories.push(cupMaterial, lidMaterial);
    if (activity === "dine") {
      mesh(group, sphere, cupMaterial, [0, 0.18, -0.43], [0.19, 0.014, 0.16]);
      mesh(
        group,
        sphere,
        lidMaterial,
        [0.02, 0.205, -0.43],
        [0.09, 0.025, 0.07],
      );
    }
  }
  if (activity === "rest" || persona === "unhoused-resident") {
    const belongings = material([0x526456, 0x696879, 0x785e46][seed % 3]);
    accessories.push(belongings);
    mesh(group, capsule, belongings, [0.39, -0.54, 0.03], [0.13, 0.12, 0.17]);
    if (persona === "unhoused-resident")
      mesh(group, sphere, belongings, [0.43, -0.73, 0.04], [0.27, 0.09, 0.14]);
  }
  group.scale.setScalar(0.94 + rng() * 0.12);
  return {
    group,
    arms,
    legs,
    knees,
    materials: [skin, shirt, pants, shoe, hair, eyes, ...accessories],
    geometries: [sphere, capsule, hairGeo],
  };
}

/** Deliberate arcade outcome thresholds, not estimates of real-world injury risk. */
export const PEDESTRIAN_IMPACT_TUNING = Object.freeze({
  staggerMinMps: 1.6,
  injuryMinMps: 6,
  fatalRelativeMps: 15,
  fatalNormalMps: 11,
  repeatContactCooldownSeconds: 1.0,
  minorRecoverySeconds: 3.2,
});
export function classifyPedestrianImpact(
  normalImpactMps,
  relativeSpeedMps,
  tuning = PEDESTRIAN_IMPACT_TUNING,
) {
  if (normalImpactMps < tuning.staggerMinMps) return null;
  if (
    relativeSpeedMps >= tuning.fatalRelativeMps &&
    normalImpactMps >= tuning.fatalNormalMps
  )
    return "fatal";
  if (normalImpactMps >= tuning.injuryMinMps) return "injured";
  return "stagger";
}
const ACTIVITIES = [
  "walk",
  "walk",
  "walk",
  "walk",
  "walk",
  "walk",
  "chat",
  "coffee",
  "dine",
  "rest",
];
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// Articulated transforms are retained, but all residents share four instanced
// draws instead of allocating several thousand independently rendered meshes.
class PersonBatches {
  constructor(group, capacity = 220) {
    this.group = group;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
    });
    this.entries = new Map();
    const shapes = {
      sphere: new THREE.SphereGeometry(1, 10, 8),
      capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
      hair: new THREE.SphereGeometry(
        1,
        10,
        6,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.57,
      ),
      cylinder: new THREE.CylinderGeometry(1, 0.85, 1, 8),
    };
    for (const [kind, geometry] of Object.entries(shapes)) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.material,
        capacity * 32,
      );
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = kind === "sphere" || kind === "capsule";
      mesh.receiveShadow = true;
      mesh.name = `Residents ${kind}`;
      this.entries.set(kind, {
        mesh,
        next: 0,
        matrixFirst: Infinity,
        matrixLast: -1,
        colorFirst: Infinity,
        colorLast: -1,
      });
      group.add(mesh);
    }
    this.matrix = new THREE.Matrix4();
    this.geometryScale = new THREE.Matrix4();
  }
  add(visual) {
    const parts = [];
    visual.group.traverse((node) => {
      if (!node.isMesh) return;
      const params = node.geometry.parameters || {};
      const kind =
        node.geometry.type === "CapsuleGeometry"
          ? "capsule"
          : node.geometry.type === "CylinderGeometry"
            ? "cylinder"
            : params.thetaLength && params.thetaLength < Math.PI
              ? "hair"
              : "sphere";
      const entry = this.entries.get(kind);
      if (entry.next >= entry.mesh.instanceMatrix.count)
        throw new Error("Resident visual pool exceeded");
      const index = entry.next++;
      entry.mesh.count = entry.next;
      entry.mesh.setColorAt(
        index,
        node.material.color || new THREE.Color(0xffffff),
      );
      entry.colorFirst = Math.min(entry.colorFirst, index);
      entry.colorLast = Math.max(entry.colorLast, index);
      const scale =
        kind === "cylinder"
          ? [params.radiusTop || 1, params.height || 1, params.radiusTop || 1]
          : [1, 1, 1];
      parts.push({
        node,
        entry,
        index,
        scale,
        detail:
          Math.max(
            node.scale.x * scale[0],
            node.scale.y * scale[1],
            node.scale.z * scale[2],
          ) < 0.075,
      });
      node.visible = false;
    });
    const geometries = new Set(),
      materials = new Set();
    visual.group.traverse((node) => {
      if (node.isMesh) {
        geometries.add(node.geometry);
        materials.add(node.material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const mat of materials) mat.dispose();
    visual.parts = parts;
    return visual;
  }
  sync(visual, distance) {
    visual.group.updateMatrixWorld(true);
    for (const part of visual.parts) {
      part.entry.matrixFirst = Math.min(part.entry.matrixFirst, part.index);
      part.entry.matrixLast = Math.max(part.entry.matrixLast, part.index);
      if (distance > 600 || (part.detail && distance > 85)) {
        part.entry.mesh.setMatrixAt(part.index, ZERO_MATRIX);
        continue;
      }
      this.matrix.copy(part.node.matrixWorld);
      if (part.scale[0] !== 1 || part.scale[1] !== 1)
        this.matrix.multiply(this.geometryScale.makeScale(...part.scale));
      part.entry.mesh.setMatrixAt(part.index, this.matrix);
    }
  }
  finish() {
    // Preserve pending writes across multiple updates before a render, while
    // uploading only the used range. Color data changes only when people spawn.
    const upload = (attribute, first, last, stride) => {
      if (!attribute || last < first) return;
      let start = first * stride,
        end = (last + 1) * stride;
      for (const range of attribute.updateRanges) {
        start = Math.min(start, range.start);
        end = Math.max(end, range.start + range.count);
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
    };
    for (const entry of this.entries.values()) {
      upload(
        entry.mesh.instanceMatrix,
        entry.matrixFirst,
        entry.matrixLast,
        16,
      );
      upload(entry.mesh.instanceColor, entry.colorFirst, entry.colorLast, 3);
      entry.matrixFirst = entry.colorFirst = Infinity;
      entry.matrixLast = entry.colorLast = -1;
    }
  }
  reset() {
    for (const e of this.entries.values()) {
      e.next = 0;
      e.mesh.count = 0;
    }
  }
  dispose() {
    for (const { mesh } of this.entries.values()) {
      // Instance attributes have their own WebGL buffers, separate from geometry.
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.material.dispose();
  }
}

/** Full-district population. Outcome state remains attached to each physical body. */
export class AmbientLife {
  constructor(city, sim, scene, options = {}) {
    this.city = city;
    this.sim = sim;
    this.scene = scene;
    this.options = options;
    this.elapsed = 0;
    this.people = [];
    this.events = [];
    this.nextId = 0;
    this.visualElapsed = 0;
    this.group = new THREE.Group();
    this.group.name = "District residents";
    scene.add(this.group);
    this.random = seeded(options.seed ?? 7259);
    this.material = new CANNON.Material("ambient-person");
    this.contactMaterial = new CANNON.ContactMaterial(
      this.material,
      sim.world.defaultMaterial,
      { friction: 0.12 / 60, restitution: 0.015 },
    );
    this.personContactMaterial = new CANNON.ContactMaterial(
      this.material,
      this.material,
      { friction: 0.08 / 60, restitution: 0 },
    );
    sim.world.addContactMaterial(this.contactMaterial);
    sim.world.addContactMaterial(this.personContactMaterial);
    for (const body of sim.world.bodies)
      if (!body.material) body.material = sim.world.defaultMaterial;
    this.objects = options.objects || options.streetObjects || [];
    this.index = new LayoutIndex(city);
    this.routes = createSidewalkRoutes(
      city,
      (x, y) => sim.sampleElevation(x, y),
      this.objects,
    );
    this.batches = new PersonBatches(this.group, (options.count ?? 150) + 48);
    this.populate();
    this._postStep = () => this.physicsStep(sim.world.dt || 1 / 60);
    sim.world.addEventListener("postStep", this._postStep);
    this.physicsStep(0);
    this.update(0);
  }
  get populationStats() {
    const stats = {
      count: this.people.length,
      activities: {},
      outcomes: {},
      personas: {},
      drawBatches: this.batches.entries.size,
    };
    for (const p of this.people) {
      stats.activities[p.activity] = (stats.activities[p.activity] || 0) + 1;
      stats.outcomes[p.outcome] = (stats.outcomes[p.outcome] || 0) + 1;
      stats.personas[p.persona] = (stats.personas[p.persona] || 0) + 1;
    }
    return stats;
  }
  vehicles() {
    return this.sim.world.bodies.filter((body) => body.isVehicle);
  }
  focusPosition() {
    return this.sim.playerBody?.position || this.sim.vehicle.body.position;
  }
  refreshPedestrianBodies() {
    this.sim.pedestrianBodies = this.sim.world.bodies.filter(
      (body) => body.isPedestrian,
    );
  }
  furnitureClear(p, ignoreSeat = false, ignoreObstacleIds = []) {
    for (const o of this.objects) {
      if (!o.position || ignoreObstacleIds.includes(o.id)) continue;
      const distance = Math.hypot(p[0] - o.position[0], p[2] - o.position[2]);
      if (
        ignoreSeat &&
        ["chair", "seat", "bench"].some((term) =>
          String(o.kind || o.type || o.id).includes(term),
        ) &&
        distance < 0.65
      )
        continue;
      const radius = o.radius ?? Math.hypot(o.width || 0, o.depth || 0) / 2;
      if (distance < radius + 0.28) return false;
    }
    return true;
  }
  validSpawn(
    p,
    { seated = false, minSpacing = 1.25, ignoreObstacleIds = [] } = {},
  ) {
    if (
      !p?.every(Number.isFinite) ||
      !this.index.clear(p[0], -p[2], 0.24) ||
      !this.furnitureClear(p, seated, ignoreObstacleIds)
    )
      return false;
    if (
      this.people.some(
        (person) =>
          Math.hypot(
            person.body.position.x - p[0],
            person.body.position.z - p[2],
          ) < minSpacing,
      )
    )
      return false;
    return !this.vehicles().some(
      (body) =>
        Math.hypot(body.position.x - p[0], body.position.z - p[2]) < 4.4,
    );
  }
  routeNear(p) {
    let best = null,
      bestDistance = Infinity;
    for (const route of this.routes)
      for (let index = 0; index < route.points.length; index++) {
        const point = route.points[index],
          distance = Math.hypot(point[0] - p[0], point[2] - p[2]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { route, index, p: point, distance };
        }
      }
    return best;
  }
  populate() {
    const requested = this.options.count ?? 150,
      player = this.focusPosition();
    const candidates = [];
    for (const route of this.routes)
      for (let index = 2; index < route.points.length - 2; index += 3) {
        const p = route.points[index],
          distance = Math.hypot(p[0] - player.x, p[2] - player.z);
        if (distance < 7) continue;
        candidates.push({
          route,
          index,
          p,
          distance,
          score: distance + this.random() * 45,
          random: this.random(),
        });
      }
    const spawnPlan = (candidate, extra = {}) => {
      if (
        this.people.length >= requested ||
        !this.validSpawn(candidate.p, {
          seated: extra.posture === "seated",
          minSpacing: extra.activity === "chat" ? 1.0 : 1.05,
          ignoreObstacleIds: extra.ignoreObstacleIds || [],
        })
      )
        return false;
      this.spawn({ ...candidate, ...extra });
      return true;
    };
    // Preserve a visible first drive while distributing most residents across all cells.
    const nearTarget = Math.min(24, Math.floor(requested * 0.2));
    for (const c of [...candidates].sort((a, b) => a.score - b.score)) {
      if (this.people.length >= nearTarget) break;
      spawnPlan(c, {
        activity: ACTIVITIES[this.people.length % ACTIVITIES.length],
      });
    }
    const spots = [...(this.options.activitySpots || [])].sort(
      (a, b) => hash(a.id) - hash(b.id),
    );
    for (const spot of spots) {
      if (this.people.length >= Math.floor(requested * 0.53)) break;
      const participants = spot.participants?.length
        ? spot.participants
        : [
            {
              position: spot.position,
              facing: spot.facing,
              posture: spot.posture,
              seatHeight: spot.seatHeight,
            },
          ];
      for (const participant of participants.slice(
        0,
        spot.capacity || participants.length,
      )) {
        const point = participant.position;
        if (!point) continue;
        const near = this.routeNear(point);
        if (!near || near.distance > 18) continue;
        const p = [
          point[0],
          this.sim.sampleElevation(point[0], -point[2]),
          point[2],
        ];
        const activity = ["chat", "coffee", "dine", "rest"].includes(spot.type)
          ? spot.type
          : "chat";
        spawnPlan(
          { ...near, p },
          {
            activity,
            spotId: spot.id,
            placeId: spot.placeId,
            posture: participant.posture || spot.posture || "standing",
            seatHeight: participant.seatHeight ?? spot.seatHeight ?? 0.45,
            facing: participant.facing ?? spot.facing ?? 0,
            persona: spot.persona || "resident",
            ignoreObstacleIds:
              participant.ignoreObstacleIds ||
              [participant.ownObstacleId].filter(Boolean),
          },
        );
      }
    }
    const bounds = this.city.bounds || {
      minX: -500,
      maxX: 500,
      minY: -500,
      maxY: 500,
    };
    const cellSize = (bounds.maxX - bounds.minX) / 5,
      cells = new Map();
    for (const c of candidates) {
      const key = `${Math.floor((c.p[0] - bounds.minX) / cellSize)},${Math.floor((-c.p[2] - bounds.minY) / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(c);
    }
    for (const list of cells.values()) list.sort((a, b) => a.random - b.random);
    let progress = true;
    while (this.people.length < requested && progress) {
      progress = false;
      for (const [key, list] of [...cells.entries()].sort(
        (a, b) => hash(a[0]) - hash(b[0]),
      )) {
        while (list.length) {
          const c = list.pop();
          const activity = ACTIVITIES[this.people.length % ACTIVITIES.length];
          if (spawnPlan(c, { activity })) {
            progress = true;
            break;
          }
        }
      }
    }
    // Fictional unhoused residents are represented by rest and belongings, with
    // the same appearance distribution, behavior rules, mass, and vulnerability.
    const rests = this.people.filter((p) => p.activity === "rest");
    for (let i = 0; i < Math.min(6, rests.length); i++)
      rests[i].persona = "unhoused-resident";
  }
  spawn(candidate, { occupant = false } = {}) {
    const { route, index = 0, p } = candidate,
      seed = candidate.seed ?? Math.floor(this.random() * 0xffffffff);
    const activity = candidate.activity || "walk",
      persona =
        candidate.persona ||
        (activity === "rest" && seed % 3 === 0
          ? "unhoused-resident"
          : "resident");
    const seated =
      ["seated", "resting"].includes(candidate.posture) &&
      ["dine", "rest", "coffee"].includes(activity);
    const halfSpan = seated ? 0.3 : 0.6,
      bodyHeight = seated ? 0.6 : 1.2;
    const centerOffset = seated ? (candidate.seatHeight ?? 0.45) + 0.52 : 0.85;
    const body = new CANNON.Body({
      mass: 75,
      material: this.material,
      position: new CANNON.Vec3(p[0], p[1] + centerOffset, p[2]),
      fixedRotation: true,
      linearDamping: 0.25,
      angularDamping: 0.5,
      allowSleep: activity !== "walk",
    });
    body.addShape(new CANNON.Cylinder(0.22, 0.22, bodyHeight, 8));
    body.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, halfSpan, 0));
    body.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, -halfSpan, 0));
    body.isPedestrian = true;
    body.surface = "pedestrian";
    body.collisionResponse = true;
    body.collisionFilterGroup = this.options.collisionGroup ?? 4;
    body.collisionFilterMask = this.options.collisionMask ?? -1;
    const direction = this.random() > 0.5 ? 1 : -1,
      target = clamp(index + direction, 0, route.points.length - 1);
    const id = candidate.id || `resident-${this.nextId++}`;
    body.personId = id;
    const visual = this.batches.add(personVisual(seed, activity, persona));
    this.group.add(visual.group);
    const person = {
      id,
      body,
      visual,
      route,
      target,
      direction,
      speed: 1.08 + this.random() * 0.5,
      phase: this.random() * Math.PI * 2,
      fallUntil: 0,
      recovering: false,
      yaw: (candidate.facing ?? 0) + Math.PI,
      seed,
      activity,
      persona,
      seated,
      visualOffsetY: seated ? -0.4 : 0,
      centerOffset,
      anchor: [...p],
      outcome: "healthy",
      lastImpactAt: -100,
      reportedOutcomes: new Set(),
      desiredVelocity: [0, 0],
      nextThinkAt: 0,
      nextVisualAt: 0,
      spotId: candidate.spotId,
      placeId: candidate.placeId,
      occupant,
      alarmedUntil: 0,
      seatHeight: candidate.seatHeight ?? 0.45,
    };
    person.plan = {
      route,
      index,
      p: [...p],
      seed,
      activity,
      persona,
      posture: candidate.posture,
      seatHeight: candidate.seatHeight,
      facing: candidate.facing,
      spotId: candidate.spotId,
      placeId: candidate.placeId,
      id,
    };
    body.addEventListener("collide", (event) => {
      if (!event.body?.isVehicle) return;
      const normal = Math.abs(event.contact.getImpactVelocityAlongNormal());
      const relative = event.body.velocity.vsub(body.velocity).length();
      this.handleVehicleImpact(person, event.body, normal, relative);
    });
    body.quaternion.setFromAxisAngle(UP, person.yaw);
    this.sim.world.addBody(body);
    this.people.push(person);
    this.refreshPedestrianBodies();
    this.syncPerson(person, 0, true);
    return person;
  }
  handleVehicleImpact(person, vehicleBody, normalImpactMps, relativeSpeedMps) {
    if (
      person.outcome === "fatal" ||
      this.elapsed - person.lastImpactAt <
        PEDESTRIAN_IMPACT_TUNING.repeatContactCooldownSeconds
    )
      return null;
    const outcome = classifyPedestrianImpact(
      normalImpactMps,
      relativeSpeedMps,
      this.options.impactTuning || PEDESTRIAN_IMPACT_TUNING,
    );
    if (!outcome || (person.outcome === "injured" && outcome !== "fatal"))
      return null;
    person.lastImpactAt = this.elapsed;
    const { body } = person;
    person.outcome = outcome;
    person.recovering = false;
    person.seated = false;
    person.visualOffsetY = 0;
    person.fallUntil =
      outcome === "stagger"
        ? this.elapsed + PEDESTRIAN_IMPACT_TUNING.minorRecoverySeconds
        : Infinity;
    body.isInjured = outcome === "injured";
    body.isDead = outcome === "fatal";
    body.fixedRotation = false;
    body.updateMassProperties();
    body.linearDamping = outcome === "stagger" ? 0.4 : 0.68;
    body.allowSleep = outcome !== "stagger";
    body.angularVelocity.x += (vehicleBody.velocity.z - body.velocity.z) * 0.25;
    body.angularVelocity.z -= (vehicleBody.velocity.x - body.velocity.x) * 0.25;
    body.wakeUp();
    const severity = outcome === "fatal" ? 2 : outcome === "injured" ? 1 : 0;
    // Repeated solver contacts cannot duplicate a persistent outcome event.
    if (person.reportedOutcomes.has(outcome) && outcome !== "stagger")
      return null;
    person.reportedOutcomes.add(outcome);
    const event = {
      type: "pedestrian-impact",
      outcome,
      severity,
      vehicleId: vehicleBody.id,
      vehicleKey: vehicleBody.vehicleId ?? `vehicle-${vehicleBody.id}`,
      player: vehicleBody === this.sim.vehicle.body,
      position: body.position.toArray(),
      personId: person.id,
      pedestrianId: person.id,
      impactMps: normalImpactMps,
      relativeSpeedMps,
      time: this.elapsed,
    };
    this.events.push(event);
    return event;
  }
  spawnOccupant(record) {
    const car = record?.body || record;
    if (!car?.position) return null;
    const existing = this.people.find((p) => p.occupantVehicleId === car.id);
    if (existing) return existing;
    if (this.people.length >= (this.options.count ?? 150) + 32) return null;
    const center = [car.position.x, car.position.y, car.position.z],
      nearest = this.routeNear(center);
    if (!nearest) return null;
    const options = [];
    for (const route of this.routes)
      for (let i = 0; i < route.points.length; i++) {
        const p = route.points[i],
          d = Math.hypot(p[0] - center[0], p[2] - center[2]);
        if (d >= 3.1 && d <= 16)
          options.push({ route, index: i, p, distance: d });
      }
    options.sort((a, b) => a.distance - b.distance);
    for (const candidate of options)
      if (this.validSpawn(candidate.p)) {
        const person = this.spawn(
          {
            ...candidate,
            activity: "chat",
            id: `occupant-${car.id}-${this.nextId++}`,
          },
          { occupant: true },
        );
        person.occupantVehicleId = car.id;
        person.alarmedUntil = this.elapsed + 8;
        person.yaw = Math.atan2(
          person.body.position.x - car.position.x,
          person.body.position.z - car.position.z,
        );
        return person;
      }
    return null;
  }
  exitOccupant(record) {
    return this.spawnOccupant(record);
  }
  physicsStep(dt) {
    this.elapsed += dt;
    if (dt > 0) {
      this.contactMaterial.friction = 0.12 * dt;
      this.personContactMaterial.friction = 0.08 * dt;
    }
    const vehicles = this.vehicles(),
      player = this.focusPosition(),
      neighbors = new Map();
    for (const p of this.people) {
      const key = `${Math.floor(p.body.position.x / 3)},${Math.floor(p.body.position.z / 3)}`;
      if (!neighbors.has(key)) neighbors.set(key, []);
      neighbors.get(key).push(p);
    }
    for (const person of this.people) {
      const { body, route } = person;
      if (
        person.outcome === "injured" ||
        person.outcome === "fatal" ||
        person.fallUntil > this.elapsed
      )
        continue;
      if (!body.fixedRotation) {
        if (
          vehicles.some(
            (car) =>
              Math.hypot(
                car.position.x - body.position.x,
                car.position.z - body.position.z,
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
          body.linearDamping = 0.25;
          person.recovering = false;
          person.outcome = "healthy";
          person.activity = "walk";
          person.seated = false;
          person.visualOffsetY = 0;
        } else continue;
      }
      const distanceToPlayer = Math.hypot(
        body.position.x - player.x,
        body.position.z - player.z,
      );
      if (this.elapsed >= person.nextThinkAt) {
        person.nextThinkAt =
          this.elapsed +
          (distanceToPlayer < 160 ? 0 : distanceToPlayer < 330 ? 0.06 : 0.14);
        let vx = 0,
          vz = 0;
        if (person.activity === "walk") {
          let target = route.points[person.target];
          if (
            Math.hypot(
              target[0] - body.position.x,
              target[2] - body.position.z,
            ) < 0.65
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
          vx = (dx / distance) * person.speed;
          vz = (dz / distance) * person.speed;
          const cx = Math.floor(body.position.x / 3),
            cz = Math.floor(body.position.z / 3);
          for (let x = cx - 1; x <= cx + 1; x++)
            for (let z = cz - 1; z <= cz + 1; z++)
              for (const other of neighbors.get(`${x},${z}`) || []) {
                if (other === person) continue;
                const ox = body.position.x - other.body.position.x,
                  oz = body.position.z - other.body.position.z,
                  d = Math.hypot(ox, oz);
                if (d > 0 && d < 0.9) {
                  vx += (ox / d) * (0.9 - d) * 2.1;
                  vz += (oz / d) * (0.9 - d) * 2.1;
                }
              }
          for (const car of vehicles) {
            const rx = car.position.x - body.position.x,
              rz = car.position.z - body.position.z;
            if (Math.hypot(rx, rz) < 3.1 && rx * vx + rz * vz > 0) {
              vx *= 0.05;
              vz *= 0.05;
            }
          }
          if (Math.hypot(vx, vz) > 0.1) person.yaw = Math.atan2(-vx, -vz);
        } else {
          // Keep stationary conversations and café patrons at their clear anchor
          // using bounded forces, never overwriting physical position/velocity.
          vx = clamp((person.anchor[0] - body.position.x) * 3, -1, 1);
          vz = clamp((person.anchor[2] - body.position.z) * 3, -1, 1);
        }
        person.desiredVelocity = [vx, vz];
      }
      const [vx, vz] = person.desiredVelocity,
        fx = 75 * (vx - body.velocity.x) * 5.5,
        fz = 75 * (vz - body.velocity.z) * 5.5,
        force = Math.hypot(fx, fz),
        scale = Math.min(1, 480 / (force || 1));
      body.force.x += fx * scale;
      body.force.z += fz * scale;
      body.quaternion.setFromAxisAngle(UP, person.yaw);
      body.aabbNeedsUpdate = true;
    }
  }
  syncPerson(person, dt, force = false) {
    const { body, visual } = person,
      distance = body.position.distanceTo(this.focusPosition());
    if (!force && this.visualElapsed < person.nextVisualAt) return;
    person.nextVisualAt =
      this.visualElapsed + (distance < 110 ? 0 : distance < 250 ? 0.055 : 0.16);
    visual.group.position.copy(body.position);
    visual.group.position.y += person.visualOffsetY;
    visual.group.quaternion.copy(body.quaternion);
    const healthy = person.outcome === "healthy",
      speed = Math.hypot(body.velocity.x, body.velocity.z),
      phase = this.elapsed + person.phase;
    person.phase +=
      healthy && person.activity === "walk"
        ? Math.min(speed, 2.4) * dt * 5.4
        : 0;
    let legs = 0,
      leftArm = 0.1,
      rightArm = -0.1;
    if (healthy && person.activity === "walk") {
      legs = Math.sin(person.phase) * Math.min(0.48, speed * 0.31);
      leftArm = -legs * 0.82;
      rightArm = legs * 0.82;
    } else if (healthy && person.activity === "chat") {
      leftArm = 0.4 + Math.sin(phase * 1.3) * 0.2;
      rightArm = 0.12 + Math.sin(phase * 0.8) * 0.15;
    } else if (
      healthy &&
      (person.activity === "coffee" || person.activity === "dine")
    ) {
      leftArm = 1.05 + Math.pow(Math.max(0, Math.sin(phase * 0.75)), 3) * 1.0;
      rightArm = person.activity === "dine" ? 0.78 : 0.1;
    } else if (healthy && person.activity === "rest") {
      leftArm = 0.35;
      rightArm = 0.35;
    }
    if (person.alarmedUntil > this.elapsed) {
      leftArm = 1.9 + Math.sin(phase * 2) * 0.15;
      rightArm = 1.9 - Math.sin(phase * 2) * 0.15;
    }
    visual.legs[0].rotation.x = person.seated ? Math.PI / 2 : legs;
    visual.legs[1].rotation.x = person.seated ? Math.PI / 2 : -legs;
    visual.knees[0].rotation.x = visual.knees[1].rotation.x = person.seated
      ? person.seatHeight < 0.2
        ? -0.12
        : -Math.PI / 2
      : 0;
    visual.arms[0].rotation.x = leftArm;
    visual.arms[1].rotation.x = rightArm;
    visual.arms[0].rotation.z = healthy ? 0.08 : 0.64;
    visual.arms[1].rotation.z = healthy ? -0.08 : -0.64;
    if (person.outcome === "fatal") {
      visual.arms[0].rotation.x = 0.12;
      visual.arms[1].rotation.x = -0.2;
      visual.legs[0].rotation.x = 0.08;
      visual.legs[1].rotation.x = -0.06;
    }
    this.batches.sync(visual, distance);
  }
  update(dt) {
    this.visualElapsed += clamp(dt, 0, 0.1);
    for (const person of this.people)
      this.syncPerson(person, clamp(dt, 0, 0.1));
    this.batches.finish();
  }
  reset() {
    for (const person of this.people) {
      this.sim.world.removeBody(person.body);
      person.visual.group.removeFromParent();
    }
    this.people = [];
    this.refreshPedestrianBodies();
    this.events.length = 0;
    this.elapsed = 0;
    this.visualElapsed = 0;
    this.nextId = 0;
    this.random = seeded(this.options.seed ?? 7259);
    this.batches.reset();
    this.populate();
    this.physicsStep(0);
    this.update(0);
    return this.people.length;
  }
  dispose() {
    this.sim.world.removeEventListener("postStep", this._postStep);
    this.sim.world.removeContactMaterial(this.contactMaterial);
    this.sim.world.removeContactMaterial(this.personContactMaterial);
    for (const person of this.people) {
      this.sim.world.removeBody(person.body);
      person.visual.group.removeFromParent();
    }
    this.people.length = 0;
    this.refreshPedestrianBodies();
    this.batches.dispose();
    this.group.removeFromParent();
  }
}
