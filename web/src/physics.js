import * as CANNON from "cannon-es";
import earcut from "earcut";
import { TrafficNetwork } from "./traffic.js";

/** Coordinates are metres: X east, Y up, Z south. City input uses X east/Y north/Z elevation. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const UP = new CANNON.Vec3(0, 1, 0);
const FORWARD = new CANNON.Vec3(0, 0, -1);
const FIXED_STEP = 1 / 60;
export const VEHICLE_SPEC = Object.freeze({
  mass: 1450,
  wheelRadius: 0.335,
  wheelbase: 2.68,
  track: 1.58,
  springRatePerWheel: 37700,
  suspensionTravel: 0.24,
  suspensionRestLength: 0.31,
  peakTorqueNm: 285,
  finalDrive: 3.7,
  gearRatios: [3.82, 2.2, 1.52, 1.22, 1.02, 0.84],
  dragCoefficient: 0.31,
  frontalArea: 2.18,
  maxSteerRadians: 0.49,
});
const GRIP = {
  asphalt: [1.05, 0.68],
  concrete: [1.02, 0.66],
  paved: [1.03, 0.66],
  steel: [0.6, 0.24],
  tracks: [0.6, 0.24],
  cable_car_tracks: [0.6, 0.24],
  painted: [0.75, 0.38],
  painted_lines: [0.75, 0.38],
  cobblestone: [0.81, 0.49],
  cobblestones: [0.81, 0.49],
  sett: [0.81, 0.49],
  bricks: [0.81, 0.49],
  brick: [0.81, 0.49],
  paving_stones: [0.81, 0.49],
  gravel: [0.64, 0.49],
  dirt: [0.61, 0.39],
  grass: [0.51, 0.29],
};
export function surfaceGrip(surface = "asphalt", wetness = 0) {
  const coefficients = GRIP[String(surface).toLowerCase()] || GRIP.asphalt;
  return lerp(coefficients[0], coefficients[1], clamp(wetness, 0, 1));
}
function point(p) {
  return Array.isArray(p)
    ? { x: p[0], y: p[1], z: p[2] ?? 0 }
    : {
        x: p.x ?? p.xEast ?? 0,
        y: p.y ?? p.yNorth ?? 0,
        z: p.z ?? p.zElev ?? p.elevation ?? 0,
      };
}
function terrainInfo(city) {
  const t = city.terrain || {};
  const bounds = t.bounds || city.bounds || {};
  const width = t.width || t.cols || 2,
    height = t.height || t.rows || 2;
  const cellSize = t.cellSize || 10;
  return {
    ...t,
    width,
    height,
    cellSize,
    minX: bounds.minX ?? t.minX ?? (-(width - 1) * cellSize) / 2,
    minY:
      bounds.minY ??
      bounds.minNorth ??
      t.minY ??
      (-(height - 1) * cellSize) / 2,
  };
}
export function sampleTerrain(city, xEast, yNorth, heightsOverride) {
  const t = terrainInfo(city),
    heights = heightsOverride || t.heights;
  if (!heights?.length) return 0;
  const u = clamp((xEast - t.minX) / t.cellSize, 0, t.width - 1);
  const v = clamp((yNorth - t.minY) / t.cellSize, 0, t.height - 1);
  const x = Math.min(Math.floor(u), t.width - 2),
    y = Math.min(Math.floor(v), t.height - 2);
  const a = u - x,
    b = v - y;
  // Match Cannon's heightfield triangular interpolation, rather than bilinear saddles.
  const h00 = heights[y * t.width + x] || 0,
    h10 = heights[y * t.width + x + 1] || 0;
  const h01 = heights[(y + 1) * t.width + x] || 0,
    h11 = heights[(y + 1) * t.width + x + 1] || 0;
  return a + b <= 1
    ? h00 + a * (h10 - h00) + b * (h01 - h00)
    : h11 + (1 - a) * (h01 - h11) + (1 - b) * (h10 - h11);
}
function roadSegments(city) {
  const segments = [];
  for (const road of city.roads || []) {
    const points = (road.points || []).map(point);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;
      segments.push({
        a,
        b,
        dx,
        dy,
        length,
        road,
        index: i - 1,
        width:
          road.width ?? road.widthM ?? Math.max(5.8, (road.lanes || 2) * 3.1),
      });
    }
  }
  // A compact spatial index keeps real-city DEM sampling and road lookup local.
  const grid = new Map(),
    cellSize = 32;
  for (const segment of segments) {
    const x0 = Math.floor(Math.min(segment.a.x, segment.b.x) / cellSize);
    const x1 = Math.floor(Math.max(segment.a.x, segment.b.x) / cellSize);
    const y0 = Math.floor(Math.min(segment.a.y, segment.b.y) / cellSize);
    const y1 = Math.floor(Math.max(segment.a.y, segment.b.y) / cellSize);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(segment);
      }
  }
  segments.spatialGrid = grid;
  segments.gridCellSize = cellSize;
  return segments;
}
function nearestRoad(segments, x, y, limit = Infinity) {
  let best = null,
    distance = limit;
  let candidates = segments;
  if (segments.spatialGrid && Number.isFinite(limit)) {
    const size = segments.gridCellSize,
      seen = new Set();
    candidates = [];
    for (
      let gx = Math.floor((x - limit) / size);
      gx <= Math.floor((x + limit) / size);
      gx++
    ) {
      for (
        let gy = Math.floor((y - limit) / size);
        gy <= Math.floor((y + limit) / size);
        gy++
      ) {
        for (const s of segments.spatialGrid.get(`${gx},${gy}`) || []) {
          if (!seen.has(s)) {
            seen.add(s);
            candidates.push(s);
          }
        }
      }
    }
  }
  for (const s of candidates) {
    if (
      x < Math.min(s.a.x, s.b.x) - distance ||
      x > Math.max(s.a.x, s.b.x) + distance ||
      y < Math.min(s.a.y, s.b.y) - distance ||
      y > Math.max(s.a.y, s.b.y) + distance
    )
      continue;
    const t = clamp(
      ((x - s.a.x) * s.dx + (y - s.a.y) * s.dy) / (s.length * s.length),
      0,
      1,
    );
    const px = s.a.x + s.dx * t,
      py = s.a.y + s.dy * t,
      d = Math.hypot(x - px, y - py);
    if (d < distance) {
      distance = d;
      best = {
        ...s,
        t,
        distance: d,
        x: px,
        y: py,
        elevation: lerp(s.a.z, s.b.z, t),
        onRoad: d <= s.width / 2,
      };
    }
  }
  return best;
}
export function findRoad(city, xEast, yNorth) {
  return nearestRoad(roadSegments(city), xEast, yNorth);
}
function railStrips(city) {
  const strips = [];
  for (const railway of city.railways || []) {
    const rawGauge = Number.parseFloat(railway.tags?.gauge ?? railway.gauge);
    const gauge =
      Number.isFinite(rawGauge) && rawGauge > 0
        ? rawGauge > 10
          ? rawGauge / 1000
          : rawGauge
        : 1.067;
    const points = (railway.points || []).map(point);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      for (const sign of [-1, 1]) {
        const ox = (dy / len) * gauge * 0.5 * sign,
          oy = (-dx / len) * gauge * 0.5 * sign;
        strips.push({
          points: [
            { x: a.x + ox, y: a.y + oy, z: a.z },
            { x: b.x + ox, y: b.y + oy, z: b.z },
          ],
          width: 0.28,
          surface: "steel",
          railwayId: railway.id,
        });
      }
    }
  }
  return roadSegments({ roads: strips });
}

/** RaycastVehicle is a rigid-body suspension model; this adds load-limited tyres.
 * Cannon does not clamp straight-line engine force when lateral impulse is zero.
 * Clamp longitudinal force explicitly to mu * normal load to cover this case.
 */
class LoadLimitedVehicle extends CANNON.RaycastVehicle {
  updateFriction(dt) {
    for (const w of this.wheelInfos) {
      w._requestedEngineForce = w.engineForce;
      w._requestedBrake = w.brake;
      const normalLoad = Math.min(w.suspensionForce, w.maxSuspensionForce);
      const longitudinalLimit = Math.max(0, normalLoad) * w.frictionSlip;
      w.engineForce = clamp(
        w.engineForce,
        -longitudinalLimit,
        longitudinalLimit,
      );
      w.brake = Math.min(w.brake, longitudinalLimit * dt);
    }
    super.updateFriction(dt);
    for (const w of this.wheelInfos) {
      w.engineForce = w._requestedEngineForce;
      w.brake = w._requestedBrake;
    }
  }
}

export const VEHICLE_PROFILES = Object.freeze([
  {
    name: "Commuter",
    color: "#8ca5b9",
    powerMultiplier: 0.78,
    mass: 1320,
    gripMultiplier: 0.95,
    style: "compact",
  },
  {
    name: "Bay Cruiser",
    color: "#d0b880",
    powerMultiplier: 0.98,
    mass: 1530,
    gripMultiplier: 1,
    style: "sedan",
  },
  {
    name: "Apex GT",
    color: "#ba3929",
    powerMultiplier: 1.3,
    mass: 1390,
    gripMultiplier: 1.08,
    style: "sport",
  },
  {
    name: "Pacific V8",
    color: "#353e56",
    powerMultiplier: 1.16,
    mass: 1680,
    gripMultiplier: 0.97,
    style: "muscle",
  },
  {
    name: "Sunset Classic",
    color: "#629f91",
    powerMultiplier: 0.88,
    mass: 1450,
    gripMultiplier: 0.98,
    style: "classic",
  },
  {
    name: "Night Runner",
    color: "#e8e3d9",
    powerMultiplier: 1.2,
    mass: 1410,
    gripMultiplier: 1.04,
    style: "coupe",
  },
]);
const POLICE_PROFILE = {
  name: "SFPD Interceptor",
  color: "#e9e9e6",
  powerMultiplier: 1.24,
  mass: 1550,
  gripMultiplier: 1.06,
  style: "police",
};

export class CitySimulation {
  constructor(city, options = {}) {
    this.city = city;
    this.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    this.wetness = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.gear = 1;
    this.rpm = 850;
    this.onRoad = true;
    this.currentRoad = null;
    this.events = [];
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.81, 0),
      allowSleep: true,
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 8;
    this.world.defaultContactMaterial.friction = 0.28;
    this.world.defaultContactMaterial.restitution = 0.1;
    this.segments = roadSegments(city);
    this.railSegments = railStrips(city);
    this.staticBodies = [];
    this.staticChunks = new Map();
    this.#buildGround();
    this.#buildBuildings();
    this.obstacles = [];
    this.addObstacles(options.obstacles || []);
    this.pedestrians = options.pedestrians || [];
    this.vehicle = this.#createVehicle(this.#getSpawn());
    this.traffic = [];
    this.trafficNetwork = new TrafficNetwork(city);
    this.#buildTraffic(options.trafficCount ?? 40, options.policeCount ?? 4);
    this.#buildParked(options.parkedCount ?? 0);
    this.allVehicles = [this.vehicle, ...this.traffic];
    this.pursuit = null;
  }
  get speedKph() {
    return this.vehicle.body.velocity.length() * 3.6;
  }
  get signedSpeedKph() {
    return (
      this.vehicle.body
        .vectorToWorldFrame(FORWARD)
        .dot(this.vehicle.body.velocity) * 3.6
    );
  }
  get airborne() {
    return this.vehicle.raycast.numWheelsOnGround === 0;
  }
  get headingRadians() {
    const f = this.vehicle.body.vectorToWorldFrame(FORWARD);
    return Math.atan2(f.x, -f.z);
  }
  setWeather(wet) {
    this.wetness = typeof wet === "boolean" ? Number(wet) : clamp(wet, 0, 1);
  }
  surfaceAt(xEast, yNorth, elevation, baseSurface = "asphalt") {
    if (baseSurface === "grass" || baseSurface === "ground") {
      const road = nearestRoad(this.segments, xEast, yNorth, 18);
      baseSurface = road?.onRoad ? road.road.surface || "asphalt" : "grass";
    }
    // The strip geometry is flush with the road: classification changes tyre grip,
    // without introducing raised obstacles at actual rail contact patches.
    const rail = nearestRoad(this.railSegments, xEast, yNorth, 0.14);
    if (
      rail &&
      (!Number.isFinite(elevation) ||
        Math.abs(elevation - rail.elevation) < 0.55)
    )
      return "steel";
    if (["asphalt", "paved", "concrete"].includes(baseSurface)) {
      const centerline = nearestRoad(this.segments, xEast, yNorth, 0.1);
      if (
        centerline &&
        centerline.width >= 6 &&
        !centerline.road.oneway &&
        (!Number.isFinite(elevation) ||
          Math.abs(elevation - centerline.elevation) < 0.55)
      )
        return "painted_lines";
    }
    return baseSurface;
  }
  sampleElevation(xEast, yNorth) {
    return sampleTerrain(this.groundData, xEast, yNorth);
  }
  #getSpawn() {
    const source = this.city.spawn || this.city.playerSpawn;
    if (source) {
      const p = point(source.position || source);
      return {
        ...p,
        headingRadians: source.headingRadians ?? source.heading ?? 0,
      };
    }
    const s = this.segments[Math.floor(this.segments.length / 2)];
    if (s)
      return {
        x: (s.a.x + s.b.x) / 2,
        y: (s.a.y + s.b.y) / 2,
        z: (s.a.z + s.b.z) / 2,
        headingRadians: Math.atan2(s.dx, s.dy),
      };
    return { x: 0, y: 0, z: this.sampleElevation(0, 0), headingRadians: 0 };
  }
  #static(shape, position, quaternion, surface = "asphalt") {
    shape.surface = surface;
    // Keep the heightfield separate; small colliders share spatial compound bodies.
    // Cannon allocates collision matrices per BODY (quadratic), not per shape.
    if (shape instanceof CANNON.Heightfield) {
      const body = new CANNON.Body({ mass: 0, shape });
      if (position) body.position.copy(position);
      if (quaternion) body.quaternion.copy(quaternion);
      body.surface = surface;
      this.world.addBody(body);
      this.staticBodies.push(body);
      return body;
    }
    const chunkSize = 64;
    const cx = Math.floor(position.x / chunkSize),
      cz = Math.floor(position.z / chunkSize);
    const key = `${cx},${cz}`;
    let body = this.staticChunks.get(key);
    if (!body) {
      body = new CANNON.Body({ mass: 0 });
      body.position.set((cx + 0.5) * chunkSize, 0, (cz + 0.5) * chunkSize);
      body.surface = surface;
      this.staticChunks.set(key, body);
      this.world.addBody(body);
      this.staticBodies.push(body);
    }
    body.addShape(
      shape,
      position.vsub(body.position),
      quaternion || new CANNON.Quaternion(),
    );
    body.aabbNeedsUpdate = true;
    return body;
  }
  #buildGround() {
    const source = terrainInfo(this.city);
    // A single continuous heightfield replaces overlapping road boxes and their
    // vertical end faces. The raster follows surveyed road elevations and blends
    // into the DEM beyond the asphalt, so intersections have one physical surface.
    const subdivision = source.width > 128 ? 2 : 1;
    const width = (source.width - 1) * subdivision + 1,
      height = (source.height - 1) * subdivision + 1;
    const cellSize = source.cellSize / subdivision;
    const heights = new Array(width * height);
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const x = source.minX + col * cellSize,
          y = source.minY + row * cellSize;
        const original = sampleTerrain(this.city, x, y);
        const road = nearestRoad(this.segments, x, y, 22);
        if (road) {
          const shoulder = road.width * 0.5 + 1.4;
          const blend = clamp((shoulder + 4 - road.distance) / 4, 0, 1);
          const smooth = blend * blend * (3 - 2 * blend);
          heights[row * width + col] = lerp(
            original,
            road.elevation + 0.06,
            smooth,
          );
        } else heights[row * width + col] = original;
      }
    const terrain = {
      width,
      height,
      cellSize,
      bounds: { minX: source.minX, minY: source.minY },
      heights,
    };
    this.groundData = { terrain };
    this.terrainRenderData = terrain;
    // Compatibility with the native terrain grid; use terrainRenderData for exact
    // rendering at the collider resolution and sampleElevation for road ribbons.
    this.terrainRenderHeights = Array.from(
      { length: source.width * source.height },
      (_, i) =>
        sampleTerrain(
          this.groundData,
          source.minX + (i % source.width) * source.cellSize,
          source.minY + Math.floor(i / source.width) * source.cellSize,
        ),
    );
    this.terrainHeights = this.terrainRenderHeights;
    const data = Array.from({ length: width }, (_, x) =>
      Array.from({ length: height }, (_, y) => heights[y * width + x]),
    );
    const q = new CANNON.Quaternion().setFromAxisAngle(
      new CANNON.Vec3(1, 0, 0),
      -Math.PI / 2,
    );
    this.groundBody = this.#static(
      new CANNON.Heightfield(data, { elementSize: cellSize }),
      new CANNON.Vec3(source.minX, 0, -source.minY),
      q,
      "ground",
    );
  }
  #buildBuildings() {
    this.buildingColliderCount = 0;
    for (const building of this.city.buildings || []) {
      const footprint = (building.footprint || building.points || []).map(
        point,
      );
      if (footprint.length < 3) continue;
      const rings = [
        footprint,
        ...(building.footprintHoles || []).map((r) => r.map(point)),
      ];
      const coords = [],
        vertices2 = [],
        holes = [];
      for (let r = 0; r < rings.length; r++) {
        if (r) holes.push(vertices2.length);
        for (const p of rings[r]) {
          coords.push(p.x, p.y);
          vertices2.push(p);
        }
      }
      const triangles = earcut(coords, holes, 2);
      const height = clamp(building.height ?? building.heightM ?? 9, 2, 280);
      const base =
        building.baseElevation ??
        building.elevation ??
        Math.min(...footprint.map((p) => p.z));
      // Triangle prisms exactly decompose a concave footprint and courtyard holes.
      // A hull would silently fill alleys/open courtyards and create ghost walls.
      for (let i = 0; i < triangles.length; i += 3) {
        let tri = triangles.slice(i, i + 3).map((j) => vertices2[j]);
        const area =
          (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) -
          (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
        if (Math.abs(area) < 0.025) continue;
        if (area < 0) tri.reverse();
        const cx = tri.reduce((v, p) => v + p.x, 0) / 3,
          cy = tri.reduce((v, p) => v + p.y, 0) / 3;
        const vertices = [];
        for (const h of [-height / 2, height / 2])
          for (const p of tri)
            vertices.push(new CANNON.Vec3(p.x - cx, h, -(p.y - cy)));
        const shape = new CANNON.ConvexPolyhedron({
          vertices,
          faces: [
            [2, 1, 0],
            [3, 4, 5],
            [0, 1, 4, 3],
            [1, 2, 5, 4],
            [2, 0, 3, 5],
          ],
        });
        shape.buildingId = building.id;
        this.#static(
          shape,
          new CANNON.Vec3(cx, base + height / 2, -cy),
          null,
          "building",
        );
        this.buildingColliderCount++;
      }
    }
  }
  addObstacles(obstacles) {
    for (const obstacle of obstacles) {
      if (this.obstacles.some((o) => o.id === obstacle.id)) continue;
      const p = obstacle.position,
        position = Array.isArray(p)
          ? new CANNON.Vec3(...p)
          : new CANNON.Vec3(p.x, p.y, p.z);
      const height =
        obstacle.height ??
        (obstacle.type === "tree" ? 5 : obstacle.type === "bollard" ? 1 : 6);
      let shape;
      if (obstacle.type === "barrier")
        shape = new CANNON.Box(
          new CANNON.Vec3(
            (obstacle.width ?? 3) / 2,
            height / 2,
            (obstacle.depth ?? 0.45) / 2,
          ),
        );
      else
        shape = new CANNON.Cylinder(
          obstacle.radius ?? 0.13,
          obstacle.radius ?? 0.13,
          height,
          10,
        );
      shape.obstacleId = obstacle.id;
      shape.obstacleType = obstacle.type;
      position.y += height / 2;
      const rotation = new CANNON.Quaternion().setFromAxisAngle(
        UP,
        obstacle.headingRadians ?? 0,
      );
      const body = this.#static(shape, position, rotation, "obstacle");
      this.obstacles.push({ ...obstacle, body, shape });
    }
  }
  #createVehicle(spawn, traffic = false, profile = null) {
    profile = {
      ...(profile || {
        name: "City Wheels GT",
        color: "#a93822",
        powerMultiplier: 1,
        mass: 1450,
        gripMultiplier: 1,
        style: "sport",
      }),
    };
    const body = new CANNON.Body({
      mass: profile.mass,
      linearDamping: 0.005,
      angularDamping: 0.34,
      allowSleep: false,
    });
    // Fit the low concept-car silhouette: body front-2.246/rear1.894m,
    // roof+.43m. The previous tall cabin would collide above the visible roof.
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.865, 0.21, 2.07)),
      new CANNON.Vec3(0, -0.09, -0.176),
    );
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.7, 0.16, 0.88)),
      new CANNON.Vec3(0, 0.27, -0.04),
    );
    const raycast = new LoadLimitedVehicle({
      chassisBody: body,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });
    for (const [x, z, front] of [
      [-0.79, -1.37, true],
      [0.79, -1.37, true],
      [-0.79, 1.31, false],
      [0.79, 1.31, false],
    ]) {
      raycast.addWheel({
        radius: VEHICLE_SPEC.wheelRadius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, 0.05, z),
        isFrontWheel: front,
        suspensionStiffness: 26,
        suspensionRestLength: 0.31,
        maxSuspensionTravel: 0.24,
        dampingCompression: 3.8,
        dampingRelaxation: 4.4,
        maxSuspensionForce: 22000,
        frictionSlip: surfaceGrip("asphalt", this.wetness),
        rollInfluence: 0.72,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    raycast.addToWorld(this.world);
    const record = {
      body,
      profile,
      tuning: { power: 1, grip: 1, brakes: 1 },
      role: profile.style === "police" ? "police" : "civilian",
      parked: false,
      abandoned: false,
      raycast,
      wheels: raycast.wheelInfos,
      health: 1,
      engineHealth: 1,
      steeringDamage: 0,
      steeringAngle: 0,
      traffic,
      controls: { throttle: 0, steer: 0, brake: 0, handbrake: false },
      gear: 1,
      rpm: 850,
      distance: 0,
      damage: { front: 0, rear: 0, left: 0, right: 0 },
      wasAirborne: false,
      lastImpactTime: -100,
    };
    body.isVehicle = true;
    record.id = body.vehicleId = `vehicle-${body.id}`;
    body.vehicleRecord = record;
    body.addEventListener("collide", (event) => {
      const contact = event.contact,
        impact = Math.abs(contact.getImpactVelocityAlongNormal());
      if (impact < 1.8 || this.elapsed - record.lastImpactTime < 0.16) return;
      record.lastImpactTime = this.elapsed;
      const ownIsI = contact.bi === body,
        other = ownIsI ? contact.bj : contact.bi;
      const hit = body.position.vadd(ownIsI ? contact.ri : contact.rj);
      const relative = body.pointToLocalFrame(hit);
      const worldNormal = contact.ni.scale(ownIsI ? -1 : 1);
      const localNormal = body.vectorToLocalFrame(worldNormal);
      const zone =
        Math.abs(localNormal.z) > Math.abs(localNormal.x)
          ? relative.z < 0
            ? "front"
            : "rear"
          : relative.x < 0
            ? "left"
            : "right";
      const reducedMass =
        other.mass > 0
          ? (body.mass * other.mass) / (body.mass + other.mass)
          : body.mass;
      const energy = 0.5 * reducedMass * impact * impact;
      const damage = clamp((energy - 3500) / 600000, 0, 0.42);
      record.damage[zone] = clamp(record.damage[zone] + damage, 0, 1);
      record.health = clamp(
        1 - Object.values(record.damage).reduce((a, b) => a + b, 0) * 0.32,
        0.1,
        1,
      );
      // Cosmetic scrapes stay cosmetic; only substantial front damage reduces power.
      record.engineHealth =
        1 - clamp((record.damage.front - 0.25) / 0.75, 0, 1) * 0.6;
      record.steeringDamage = clamp(
        (record.damage.left - record.damage.right) * 0.028,
        -0.025,
        0.025,
      );
      const normal = contact.ni.scale(ownIsI ? -1 : 1);
      this.events.push({
        type: "collision",
        vehicleId: body.id,
        player: record === this.vehicle,
        vehicleKey: record.id,
        otherId: other.id,
        obstacleId: (ownIsI ? contact.sj : contact.si)?.obstacleId,
        impact,
        damage,
        zone,
        energy,
        hitPosition: [hit.x, hit.y, hit.z],
        normal: [normal.x, normal.y, normal.z],
        time: this.elapsed,
      });
    });
    this.#placeVehicle(record, spawn);
    return record;
  }
  #placeVehicle(record, spawn) {
    const ground = this.sampleElevation(spawn.x, spawn.y);
    record.body.position.set(
      spawn.x,
      Math.max(ground, spawn.z || 0) + 0.72,
      -spawn.y,
    );
    record.body.quaternion.setFromAxisAngle(UP, -(spawn.headingRadians || 0));
    record.body.velocity.setZero();
    record.body.angularVelocity.setZero();
    record.body.force.setZero();
    record.body.torque.setZero();
    record.body.wakeUp();
    record.body.aabbNeedsUpdate = true;
    for (let i = 0; i < 4; i++) record.raycast.updateWheelTransform(i);
  }
  reset(options = {}) {
    if (
      this.pursuit &&
      ["pursuit", "search"].includes(this.pursuit.state) &&
      !options.force
    )
      return false;
    this.pursuit?.reset();
    let spawn = this.#getSpawn();
    const blocked = (p) =>
      this.traffic.some(
        (car) =>
          Math.hypot(car.body.position.x - p.x, -car.body.position.z - p.y) <
          5.8,
      );
    if (blocked(spawn)) {
      const forward = {
        x: Math.sin(spawn.headingRadians),
        y: Math.cos(spawn.headingRadians),
      };
      for (const offset of [-9, 9, -18, 18, -30, 30, -45, 45]) {
        const road = nearestRoad(
          this.segments,
          spawn.x + forward.x * offset,
          spawn.y + forward.y * offset,
          16,
        );
        if (!road) continue;
        const direction =
          road.dx * forward.x + road.dy * forward.y >= 0 ? 1 : -1;
        const dx = (road.dx / road.length) * direction,
          dy = (road.dy / road.length) * direction;
        const candidate = {
          x: road.x + dy * 1.15,
          y: road.y - dx * 1.15,
          z: road.elevation,
          headingRadians: Math.atan2(dx, dy),
        };
        if (!blocked(candidate)) {
          spawn = candidate;
          break;
        }
      }
    }
    this.#placeVehicle(this.vehicle, spawn);
    this.vehicle.health = this.vehicle.engineHealth = 1;
    this.vehicle.damage = { front: 0, rear: 0, left: 0, right: 0 };
    this.vehicle.steeringDamage = this.vehicle.steeringAngle = 0;
    this.controls.throttle = this.controls.steer = this.controls.brake = 0;
    this.controls.handbrake = false;
    this.gear = this.vehicle.gear = 1;
    this.rpm = this.vehicle.rpm = 850;
    return true;
  }
  #buildTraffic(count, policeCount) {
    const candidates = this.trafficNetwork.spawnCandidates(
      this.vehicle.body.position,
      count,
    );
    const policeIndices = new Set(
      Array.from({ length: Math.min(policeCount, candidates.length) }, (_, i) =>
        Math.floor(
          (i * candidates.length) / Math.min(policeCount, candidates.length),
        ),
      ),
    );
    for (const [index, candidate] of candidates.entries()) {
      const profile = policeIndices.has(index)
        ? POLICE_PROFILE
        : VEHICLE_PROFILES[index % VEHICLE_PROFILES.length];
      const record = this.#createVehicle(candidate.spawn, true, profile);
      this.trafficNetwork.attach(record, candidate.routeState);
      this.traffic.push(record);
    }
  }
  #buildParked(count) {
    let added = 0;
    for (const candidate of this.trafficNetwork.parkedCandidates(
      this.vehicle.body.position,
      count,
      this.traffic,
    )) {
      const record = this.#createVehicle(
        candidate.spawn,
        true,
        VEHICLE_PROFILES[(added + 2) % VEHICLE_PROFILES.length],
      );
      record.parked = true;
      record.controls.brake = 1;
      this.traffic.push(record);
      added++;
    }
  }
  canTakeVehicle(target) {
    const record =
      typeof target === "object"
        ? target
        : this.allVehicles.find((v) => v.id === target || v.body.id === target);
    if (!record || record === this.vehicle || !this.traffic.includes(record))
      return { ok: false, reason: "Choose another vehicle" };
    if (this.pursuit?.state === "busted")
      return { ok: false, reason: "Restart after being busted" };
    const distance = this.vehicle.body.position.distanceTo(
      record.body.position,
    );
    if (distance > 7)
      return { ok: false, reason: "Get within7metres", distance };
    const speed =
      Math.max(
        this.vehicle.body.velocity.length(),
        record.body.velocity.length(),
      ) * 3.6;
    const relativeSpeed =
      this.vehicle.body.velocity.vsub(record.body.velocity).length() * 3.6;
    if (speed > 12 || relativeSpeed > 12)
      return {
        ok: false,
        reason: "Slow both cars below12km/h",
        distance,
        speed,
      };
    return { ok: true, vehicle: record, distance, speed };
  }
  takeVehicle(target) {
    const check = this.canTakeVehicle(target);
    if (!check.ok) return check;
    const previous = this.vehicle,
      record = check.vehicle,
      index = this.traffic.indexOf(record);
    // Exchange ownership only. The solver keeps both original bodies, transforms,
    // momentum, damage, profiles and tuning; no theft teleport or repair occurs.
    this.traffic[index] = previous;
    this.vehicle = record;
    previous.traffic = true;
    previous.parked = true;
    previous.abandoned = true;
    previous.chaseTarget = null;
    previous.controls = { throttle: 0, steer: 0, brake: 0.9, handbrake: false };
    record.traffic = false;
    record.parked = false;
    record.abandoned = false;
    record.chaseTarget = null;
    record.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    Object.assign(this.controls, {
      throttle: 0,
      steer: 0,
      brake: 0,
      handbrake: false,
    });
    this.gear = record.gear;
    this.rpm = record.rpm;
    if (this.pursuit) this.pursuit.nextSightAt = 0;
    this.events.push({
      type: "vehicle-taken",
      vehicleId: record.body.id,
      previousVehicleId: previous.body.id,
      player: true,
      time: this.elapsed,
    });
    return { ok: true, vehicle: record, previous };
  }
  #drive(record, controls, dt) {
    const body = record.body,
      forward = body.vectorToWorldFrame(FORWARD);
    const longitudinal = body.velocity.dot(forward),
      speed = Math.abs(longitudinal);
    const throttle = clamp(controls.throttle || 0, -1, 1);
    let brake = clamp(controls.brake || 0, 0, 1);
    if (
      (throttle < 0 && longitudinal > 1.2) ||
      (throttle > 0 && longitudinal < -1.2)
    )
      brake = Math.max(brake, Math.abs(throttle) * 0.82);
    const reversing = throttle < 0 && longitudinal < 1.2;
    const ratios = VEHICLE_SPEC.gearRatios;
    const gear = clamp(record.gear, 1, ratios.length);
    let rpm =
      ((speed / VEHICLE_SPEC.wheelRadius) *
        ratios[gear - 1] *
        VEHICLE_SPEC.finalDrive *
        60) /
      (2 * Math.PI);
    if (rpm > 6100 && record.gear < ratios.length) record.gear++;
    if (rpm < 1850 && record.gear > 1) record.gear--;
    if (reversing) record.gear = 1;
    const ratio = reversing ? 3.38 : ratios[record.gear - 1];
    rpm =
      ((speed / VEHICLE_SPEC.wheelRadius) *
        ratio *
        VEHICLE_SPEC.finalDrive *
        60) /
      (2 * Math.PI);
    // A slipping clutch permits launch and hill starts while idle remains stable.
    record.rpm = clamp(
      Math.max(850 + Math.abs(throttle) * 1200, rpm),
      850,
      6800,
    );
    const torque =
      this.#torqueAt(record.rpm) *
      record.engineHealth *
      record.profile.powerMultiplier *
      (record.tuning.power || 1);
    const engineForce =
      ((torque * ratio * VEHICLE_SPEC.finalDrive * 0.87) /
        VEHICLE_SPEC.wheelRadius) *
      throttle *
      (brake > 0.15 ? 0 : 1);
    const maxSteer = lerp(0.49, 0.15, clamp(speed / 35, 0, 1));
    const targetSteering =
      -clamp(controls.steer || 0, -1, 1) * maxSteer + record.steeringDamage;
    record.steeringAngle += clamp(
      targetSteering - record.steeringAngle,
      -2.0 * dt,
      2.0 * dt,
    );
    record.raycast.setSteeringValue(record.steeringAngle, 0);
    record.raycast.setSteeringValue(record.steeringAngle, 1);
    for (let i = 0; i < 4; i++) {
      const w = record.wheels[i];
      const baseSurface =
        w.raycastResult.shape?.surface ||
        w.raycastResult.body?.surface ||
        "asphalt";
      const contact = w.raycastResult.hitPointWorld;
      const surface = w.raycastResult.hasHit
        ? this.surfaceAt(contact.x, -contact.z, contact.y, baseSurface)
        : baseSurface;
      w.contactSurface = surface;
      let grip =
        surfaceGrip(surface, this.wetness) *
        lerp(0.76, 1, record.health) *
        record.profile.gripMultiplier *
        (record.tuning.grip || 1);
      // Progressive lateral grip falloff approximates a street tyre beyond peak slip.
      const localVelocity = body.vectorToLocalFrame(body.velocity);
      const slipAngle = Math.abs(
        Math.atan2(localVelocity.x, Math.max(2, Math.abs(localVelocity.z))),
      );
      grip *= lerp(1, 0.79, clamp((slipAngle - 0.12) / 0.48, 0, 1));
      if (controls.handbrake && i > 1) grip *= 0.6;
      w.frictionSlip = grip;
      // Rear-wheel drive; longitudinal force is bounded per-wheel after suspension loads.
      record.raycast.applyEngineForce(i > 1 ? engineForce / 2 : 0, i);
      const wheelBrakeForce =
        brake * (i < 2 ? 5500 : 3800) +
        (controls.handbrake && i > 1 ? 7500 : 0);
      record.raycast.setBrake(
        wheelBrakeForce * dt * (record.tuning.brakes || 1),
        i,
      );
    }
    // Air resistance and rolling resistance act on the rigid body, never by position edits.
    const v = body.velocity.length();
    if (v > 0.1) {
      const resistance =
        0.5 *
        1.225 *
        VEHICLE_SPEC.dragCoefficient *
        VEHICLE_SPEC.frontalArea *
        v *
        v;
      body.applyForce(body.velocity.scale(-resistance / v));
    }
    if (record.raycast.numWheelsOnGround > 0 && speed > 0.08) {
      const rolling = Math.min(
        body.mass * 9.81 * 0.012,
        (speed * body.mass) / dt,
      );
      body.applyForce(forward.scale(-Math.sign(longitudinal) * rolling));
    }
    record.distance += speed * dt;
  }
  #torqueAt(rpm) {
    const curve = [
      [850, 155],
      [1600, 219],
      [2700, 270],
      [3900, 285],
      [5000, 276],
      [6100, 236],
      [6800, 160],
    ];
    for (let i = 1; i < curve.length; i++)
      if (rpm <= curve[i][0])
        return lerp(
          curve[i - 1][1],
          curve[i][1],
          clamp(
            (rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]),
            0,
            1,
          ),
        );
    return curve[curve.length - 1][1];
  }
  step(dt) {
    this.accumulator += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps++ < 6) {
      this.elapsed += FIXED_STEP;
      this.pursuit?.update(FIXED_STEP);
      if (this.pursuit?.state === "busted")
        Object.assign(this.controls, {
          throttle: 0,
          steer: 0,
          brake: 1,
          handbrake: true,
        });
      this.#drive(this.vehicle, this.controls, FIXED_STEP);
      for (const car of this.traffic) {
        if (car.parked || car.policeHold)
          Object.assign(car.controls, {
            throttle: 0,
            steer: 0,
            brake: 1,
            handbrake: false,
          });
        else this.trafficNetwork.update(car, this, FIXED_STEP);
        this.#drive(car, car.controls, FIXED_STEP);
      }
      this.world.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    for (const car of [this.vehicle, ...this.traffic])
      for (let i = 0; i < 4; i++) car.raycast.updateWheelTransform(i);
    const car = this.vehicle;
    this.gear =
      this.controls.throttle < 0 && this.signedSpeedKph < 4 ? "R" : car.gear;
    this.rpm = car.rpm;
    this.currentRoad = nearestRoad(
      this.segments,
      car.body.position.x,
      -car.body.position.z,
      40,
    );
    this.onRoad = this.currentRoad?.onRoad ?? false;
    const inAir = this.airborne;
    if (car.wasAirborne && !inAir && this.elapsed > 1)
      this.events.push({ type: "landed", time: this.elapsed });
    car.wasAirborne = inAir;
    if (this.events.length > 20) this.events.splice(0, this.events.length - 20);
  }
  dispose() {
    this.vehicle.raycast.removeFromWorld(this.world);
    for (const car of this.traffic) car.raycast.removeFromWorld(this.world);
    for (const body of this.staticBodies) this.world.removeBody(body);
  }
}
