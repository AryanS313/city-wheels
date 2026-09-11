import * as CANNON from 'cannon-es';

/** Coordinates are metres: X east, Y up, Z south. City input uses X east/Y north/Z elevation. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const UP = new CANNON.Vec3(0, 1, 0);
const FORWARD = new CANNON.Vec3(0, 0, -1);
const FIXED_STEP = 1 / 60;
export const VEHICLE_SPEC = Object.freeze({
  mass: 1450, wheelRadius: 0.335, wheelbase: 2.68, track: 1.58,
  springRatePerWheel: 37700, suspensionTravel: 0.24, suspensionRestLength: 0.31,
  peakTorqueNm: 285, finalDrive: 3.70, gearRatios: [3.82, 2.20, 1.52, 1.22, 1.02, 0.84],
  dragCoefficient: 0.31, frontalArea: 2.18, maxSteerRadians: 0.49,
});
const GRIP = { asphalt: [1.05, 0.68], concrete: [1.02, 0.66], paved: [1.03, 0.66], steel: [0.60, 0.24], tracks: [0.60, 0.24], 'cable_car_tracks': [0.60, 0.24], painted: [0.75, 0.38], 'painted_lines': [0.75, 0.38], cobblestone: [0.81, 0.49], cobblestones: [0.81, 0.49], sett: [0.81, 0.49], bricks: [0.81, 0.49], brick: [0.81, 0.49], paving_stones: [0.81, 0.49], gravel: [0.64, 0.49], dirt: [0.61, 0.39], grass: [0.51, 0.29] };
export function surfaceGrip(surface = 'asphalt', wetness = 0) {
  const coefficients = GRIP[String(surface).toLowerCase()] || GRIP.asphalt;
  return lerp(coefficients[0], coefficients[1], clamp(wetness, 0, 1));
}
function point(p) {
  return Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] ?? 0 } : { x: p.x ?? p.xEast ?? 0, y: p.y ?? p.yNorth ?? 0, z: p.z ?? p.zElev ?? p.elevation ?? 0 };
}
function convexHull(points) {
  const sorted = [...points].sort((a,b) => a.x - b.x || a.y - b.y).filter((p,i,a) => !i || p.x !== a[i-1].x || p.y !== a[i-1].y);
  const turn = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const lower = [], upper = [];
  for (const p of sorted) { while(lower.length>1 && turn(lower.at(-2),lower.at(-1),p)<=0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while(upper.length>1 && turn(upper.at(-2),upper.at(-1),p)<=0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}
function terrainInfo(city) {
  const t = city.terrain || {};
  const bounds = t.bounds || city.bounds || {};
  const width = t.width || t.cols || 2, height = t.height || t.rows || 2;
  const cellSize = t.cellSize || 10;
  return { ...t, width, height, cellSize, minX: bounds.minX ?? t.minX ?? -(width - 1) * cellSize / 2, minY: bounds.minY ?? bounds.minNorth ?? t.minY ?? -(height - 1) * cellSize / 2 };
}
export function sampleTerrain(city, xEast, yNorth, heightsOverride) {
  const t = terrainInfo(city), heights = heightsOverride || t.heights;
  if (!heights?.length) return 0;
  const u = clamp((xEast - t.minX) / t.cellSize, 0, t.width - 1);
  const v = clamp((yNorth - t.minY) / t.cellSize, 0, t.height - 1);
  const x = Math.min(Math.floor(u), t.width - 2), y = Math.min(Math.floor(v), t.height - 2);
  const a = u - x, b = v - y;
  // Match Cannon's heightfield triangular interpolation, rather than bilinear saddles.
  const h00 = heights[y * t.width + x] || 0, h10 = heights[y * t.width + x + 1] || 0;
  const h01 = heights[(y + 1) * t.width + x] || 0, h11 = heights[(y + 1) * t.width + x + 1] || 0;
  return a + b <= 1 ? h00 + a * (h10 - h00) + b * (h01 - h00) : h11 + (1 - a) * (h01 - h11) + (1 - b) * (h10 - h11);
}
function roadSegments(city) {
  const segments = [];
  for (const road of city.roads || []) {
    const points = (road.points || []).map(point);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < .5) continue;
      segments.push({ a, b, dx, dy, length, road, index: i - 1, width: road.width ?? road.widthM ?? Math.max(5.8, (road.lanes || 2) * 3.1) });
    }
  }
  // A compact spatial index keeps real-city DEM sampling and road lookup local.
  const grid = new Map(), cellSize = 32;
  for (const segment of segments) {
    const x0 = Math.floor(Math.min(segment.a.x, segment.b.x) / cellSize);
    const x1 = Math.floor(Math.max(segment.a.x, segment.b.x) / cellSize);
    const y0 = Math.floor(Math.min(segment.a.y, segment.b.y) / cellSize);
    const y1 = Math.floor(Math.max(segment.a.y, segment.b.y) / cellSize);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
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
  let best = null, distance = limit;
  let candidates = segments;
  if (segments.spatialGrid && Number.isFinite(limit)) {
    const size = segments.gridCellSize, seen = new Set();
    candidates = [];
    for (let gx = Math.floor((x - limit) / size); gx <= Math.floor((x + limit) / size); gx++) {
      for (let gy = Math.floor((y - limit) / size); gy <= Math.floor((y + limit) / size); gy++) {
        for (const s of segments.spatialGrid.get(`${gx},${gy}`) || []) {
          if (!seen.has(s)) { seen.add(s); candidates.push(s); }
        }
      }
    }
  }
  for (const s of candidates) {
    if (x < Math.min(s.a.x, s.b.x) - distance || x > Math.max(s.a.x, s.b.x) + distance || y < Math.min(s.a.y, s.b.y) - distance || y > Math.max(s.a.y, s.b.y) + distance) continue;
    const t = clamp(((x - s.a.x) * s.dx + (y - s.a.y) * s.dy) / (s.length * s.length), 0, 1);
    const px = s.a.x + s.dx * t, py = s.a.y + s.dy * t, d = Math.hypot(x - px, y - py);
    if (d < distance) { distance = d; best = { ...s, t, distance: d, x: px, y: py, elevation: lerp(s.a.z, s.b.z, t), onRoad: d <= s.width / 2 }; }
  }
  return best;
}
export function findRoad(city, xEast, yNorth) { return nearestRoad(roadSegments(city), xEast, yNorth); }
function railStrips(city) {
  const strips = [];
  for (const railway of city.railways || []) {
    const rawGauge = Number.parseFloat(railway.tags?.gauge ?? railway.gauge);
    const gauge = Number.isFinite(rawGauge) && rawGauge > 0 ? (rawGauge > 10 ? rawGauge / 1000 : rawGauge) : 1.067;
    const points = (railway.points || []).map(point);
    for (let i = 1; i < points.length; i++) {
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len<.5) continue;
      for (const sign of [-1,1]) {
        const ox=dy/len*gauge*.5*sign,oy=-dx/len*gauge*.5*sign;
        strips.push({ points:[{x:a.x+ox,y:a.y+oy,z:a.z},{x:b.x+ox,y:b.y+oy,z:b.z}],width:.28,surface:'steel',railwayId:railway.id });
      }
    }
  }
  return roadSegments({roads:strips});
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
      w.engineForce = clamp(w.engineForce, -longitudinalLimit, longitudinalLimit);
      w.brake = Math.min(w.brake, longitudinalLimit * dt);
    }
    super.updateFriction(dt);
    for (const w of this.wheelInfos) { w.engineForce = w._requestedEngineForce; w.brake = w._requestedBrake; }
  }
}

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
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 8;
    this.world.defaultContactMaterial.friction = .4;
    this.world.defaultContactMaterial.restitution = .03;
    this.segments = roadSegments(city);
    this.railSegments = railStrips(city);
    this.staticBodies = [];
    this.staticChunks = new Map();
    this.#buildGround();
    this.#buildBuildings();
    this.vehicle = this.#createVehicle(this.#getSpawn());
    this.traffic = [];
    this.#buildTraffic(options.trafficCount ?? 6);
  }
  get speedKph() { return this.vehicle.body.velocity.length() * 3.6; }
  get signedSpeedKph() { return this.vehicle.body.vectorToWorldFrame(FORWARD).dot(this.vehicle.body.velocity) * 3.6; }
  get airborne() { return this.vehicle.raycast.numWheelsOnGround === 0; }
  get headingRadians() { const f = this.vehicle.body.vectorToWorldFrame(FORWARD); return Math.atan2(f.x, -f.z); }
  setWeather(wet) { this.wetness = typeof wet === 'boolean' ? Number(wet) : clamp(wet, 0, 1); }
  surfaceAt(xEast, yNorth, elevation, baseSurface = 'asphalt') {
    // The strip geometry is flush with the road: classification changes tyre grip,
    // without introducing raised obstacles at actual rail contact patches.
    const rail = nearestRoad(this.railSegments, xEast, yNorth, .14);
    if (rail && (!Number.isFinite(elevation) || Math.abs(elevation - rail.elevation) < .55)) return 'steel';
    if (['asphalt','paved','concrete'].includes(baseSurface)) {
      const centerline = nearestRoad(this.segments, xEast, yNorth, .10);
      if (centerline && centerline.width >= 6 && !centerline.road.oneway && (!Number.isFinite(elevation) || Math.abs(elevation - centerline.elevation) < .55)) return 'painted_lines';
    }
    return baseSurface;
  }
  sampleElevation(xEast, yNorth) {
    const road = nearestRoad(this.segments, xEast, yNorth, 20);
    return road?.onRoad ? road.elevation + .06 : sampleTerrain(this.city, xEast, yNorth, this.terrainHeights);
  }
  #getSpawn() {
    const source = this.city.spawn || this.city.playerSpawn;
    if (source) { const p = point(source.position || source); return { ...p, headingRadians: source.headingRadians ?? source.heading ?? 0 }; }
    const s = this.segments[Math.floor(this.segments.length / 2)];
    if (s) return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, z: (s.a.z + s.b.z) / 2, headingRadians: Math.atan2(s.dx, s.dy) };
    return { x: 0, y: 0, z: this.sampleElevation(0, 0), headingRadians: 0 };
  }
  #static(shape, position, quaternion, surface = 'asphalt') {
    shape.surface = surface;
    // Keep the heightfield separate; small colliders share spatial compound bodies.
    // Cannon allocates collision matrices per BODY (quadratic), not per shape.
    if (shape instanceof CANNON.Heightfield) {
      const body = new CANNON.Body({ mass: 0, shape });
      if (position) body.position.copy(position);
      if (quaternion) body.quaternion.copy(quaternion);
      body.surface = surface;
      this.world.addBody(body); this.staticBodies.push(body);
      return body;
    }
    const chunkSize = 64;
    const cx = Math.floor(position.x / chunkSize), cz = Math.floor(position.z / chunkSize);
    const key = `${cx},${cz}`;
    let body = this.staticChunks.get(key);
    if (!body) {
      body = new CANNON.Body({ mass: 0 });
      body.position.set((cx + .5) * chunkSize, 0, (cz + .5) * chunkSize);
      body.surface = surface;
      this.staticChunks.set(key, body);
      this.world.addBody(body); this.staticBodies.push(body);
    }
    body.addShape(shape, position.vsub(body.position), quaternion || new CANNON.Quaternion());
    body.aabbNeedsUpdate = true;
    return body;
  }
  #buildGround() {
    const t = terrainInfo(this.city);
    this.terrainHeights = Array.from(t.heights || Array(t.width * t.height).fill(0));
    // Lower sampled terrain immediately under road ribbons, preventing DEM noise from
    // protruding through the engineered road grade. Renderer can use terrainHeights.
    for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) {
      const road = nearestRoad(this.segments, t.minX + col * t.cellSize, t.minY + row * t.cellSize, 20);
      if (road && road.distance < road.width / 2 + t.cellSize * .4) {
        const index = row * t.width + col;
        this.terrainHeights[index] = Math.min(this.terrainHeights[index], road.elevation - .16);
      }
    }
    const data = Array.from({ length: t.width }, (_, x) => Array.from({ length: t.height }, (_, y) => this.terrainHeights[y * t.width + x]));
    const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.#static(new CANNON.Heightfield(data, { elementSize: t.cellSize }), new CANNON.Vec3(t.minX, 0, -t.minY), q, 'grass');
    for (const s of this.segments) {
      const a = new CANNON.Vec3(s.a.x, s.a.z, -s.a.y), b = new CANNON.Vec3(s.b.x, s.b.z, -s.b.y);
      const delta = b.vsub(a), length = delta.length(); delta.normalize();
      const rotation = new CANNON.Quaternion().setFromVectors(FORWARD, delta);
      const center = a.vadd(b).scale(.5); center.y -= .08;
      this.#static(new CANNON.Box(new CANNON.Vec3(s.width / 2, .14, length / 2 + .16)), center, rotation, s.road.surface || 'asphalt');
    }
  }
  #buildBuildings() {
    for (const building of this.city.buildings || []) {
      const footprint = (building.footprint || building.points || []).map(point);
      if (footprint.length < 3) continue;
      const xs = footprint.map(p => p.x), ys = footprint.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const width = maxX - minX, depth = maxY - minY;
      if (width < 1 || depth < 1) continue;
      const height = clamp(building.height ?? building.heightM ?? 9, 2, 280);
      const base = building.baseElevation ?? building.elevation ?? Math.min(...footprint.map(p => p.z));
      // Footprint hulls preserve diagonal street walls. Axis-aligned bounds can
      // protrude into real roads (e.g. Bimbo's 365 Club at the package spawn).
      const hull = convexHull(footprint);
      if (hull.length < 3) continue;
      const cx = hull.reduce((n,p)=>n+p.x,0)/hull.length, cy = hull.reduce((n,p)=>n+p.y,0)/hull.length;
      const vertices = [], faces = [], n = hull.length;
      for (const level of [-height/2,height/2]) for (const p of hull) vertices.push(new CANNON.Vec3((p.x-cx)*.97, level, -(p.y-cy)*.97));
      faces.push(Array.from({length:n},(_,i)=>n-1-i));
      faces.push(Array.from({length:n},(_,i)=>n+i));
      for(let i=0;i<n;i++) { const j=(i+1)%n; faces.push([i,j,j+n,i+n]); }
      const body = this.#static(new CANNON.ConvexPolyhedron({vertices,faces}), new CANNON.Vec3(cx, base + height / 2, -cy), null, 'building');
      body.isBuilding = true;
    }
  }
  #createVehicle(spawn, traffic = false) {
    const body = new CANNON.Body({ mass: VEHICLE_SPEC.mass, linearDamping: .005, angularDamping: .34, allowSleep: false });
    // Lower centre of gravity and the physical, raised chassis geometry are separate.
    body.addShape(new CANNON.Box(new CANNON.Vec3(.89, .275, 2.125)), new CANNON.Vec3(0, .16, 0));
    body.addShape(new CANNON.Box(new CANNON.Vec3(.74, .24, .92)), new CANNON.Vec3(0, .64, .08));
    const raycast = new LoadLimitedVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const [x, z, front] of [[-.79, -1.37, true], [.79, -1.37, true], [-.79, 1.31, false], [.79, 1.31, false]]) {
      raycast.addWheel({
        radius: VEHICLE_SPEC.wheelRadius, directionLocal: new CANNON.Vec3(0, -1, 0), axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, .05, z), isFrontWheel: front,
        suspensionStiffness: 26, suspensionRestLength: .31, maxSuspensionTravel: .24,
        dampingCompression: 3.8, dampingRelaxation: 4.4, maxSuspensionForce: 22000,
        frictionSlip: surfaceGrip('asphalt', this.wetness), rollInfluence: .72,
        customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
      });
    }
    raycast.addToWorld(this.world);
    const record = { body, raycast, wheels: raycast.wheelInfos, health: 1, engineHealth: 1, steeringDamage: 0, steeringAngle: 0, traffic, controls: { throttle: 0, steer: 0, brake: 0, handbrake: false }, gear: 1, rpm: 850, distance: 0, wasAirborne: false, lastImpactTime: -100 };
    body.isVehicle = true;
    body.addEventListener('collide', event => {
      const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (impact < 5.5 || this.elapsed - record.lastImpactTime < .3) return;
      record.lastImpactTime = this.elapsed;
      const damage = clamp((impact - 5.5) * .016, 0, .38);
      record.health = clamp(record.health - damage, .08, 1);
      record.engineHealth = Math.max(.24, record.health);
      const relative = body.pointToLocalFrame(event.contact.bi === body ? event.contact.bi.position.vadd(event.contact.ri) : event.contact.bj.position.vadd(event.contact.rj));
      record.steeringDamage = clamp(record.steeringDamage + Math.sign(relative.x || 1) * damage * .18, -.10, .10);
      if (!traffic) this.events.push({ type: 'collision', impact, damage, time: this.elapsed });
    });
    this.#placeVehicle(record, spawn);
    return record;
  }
  #placeVehicle(record, spawn) {
    const ground = this.sampleElevation(spawn.x, spawn.y);
    record.body.position.set(spawn.x, Math.max(ground, spawn.z || 0) + .72, -spawn.y);
    record.body.quaternion.setFromAxisAngle(UP, -(spawn.headingRadians || 0));
    record.body.velocity.setZero(); record.body.angularVelocity.setZero();
    record.body.force.setZero(); record.body.torque.setZero(); record.body.wakeUp();
    record.body.aabbNeedsUpdate = true;
    for (let i = 0; i < 4; i++) record.raycast.updateWheelTransform(i);
  }
  reset() {
    this.#placeVehicle(this.vehicle, this.#getSpawn());
    this.vehicle.health = this.vehicle.engineHealth = 1;
    this.vehicle.steeringDamage = this.vehicle.steeringAngle = 0;
    this.controls.throttle = this.controls.steer = this.controls.brake = 0;
    this.controls.handbrake = false;
    this.gear = this.vehicle.gear = 1;
    this.rpm = this.vehicle.rpm = 850;
  }
  #buildTraffic(count) {
    const roads = (this.city.roads || []).filter(r => r.points?.length > 1 && !['footway', 'pedestrian', 'steps', 'cycleway', 'path'].includes(r.highway));
    for (let i = 0; i < count && roads.length; i++) {
      const road = roads[Math.floor(((i + .5) / count) * roads.length) % roads.length];
      let route = road.points.map(point);
      if (road.oneway === -1) route.reverse();
      const totalLength = route.slice(1).reduce((sum, p, j) => sum + Math.hypot(p.x - route[j].x, p.y - route[j].y), 0);
      if (totalLength < 25) continue;
      const segmentIndex = Math.min(route.length - 2, Math.floor((route.length - 1) * .2));
      const a = route[segmentIndex], b = route[segmentIndex + 1];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const laneOffset = (road.oneway ? .8 : 1.5);
      const x = a.x + dy / length * laneOffset, y = a.y - dx / length * laneOffset;
      if (Math.hypot(x - this.vehicle.body.position.x, y + this.vehicle.body.position.z) < 25) continue;
      const record = this.#createVehicle({ x, y, z: a.z, headingRadians: Math.atan2(dx, dy) }, true);
      record.route = route; record.targetIndex = segmentIndex + 1; record.road = road; record.laneOffset = laneOffset; record.wait = i * .8;
      this.traffic.push(record);
    }
  }
  #drive(record, controls, dt) {
    const body = record.body, forward = body.vectorToWorldFrame(FORWARD);
    const longitudinal = body.velocity.dot(forward), speed = Math.abs(longitudinal);
    const throttle = clamp(controls.throttle || 0, -1, 1);
    let brake = clamp(controls.brake || 0, 0, 1);
    if ((throttle < 0 && longitudinal > 1.2) || (throttle > 0 && longitudinal < -1.2)) brake = Math.max(brake, Math.abs(throttle) * .82);
    const reversing = throttle < 0 && longitudinal < 1.2;
    const ratios = VEHICLE_SPEC.gearRatios;
    const gear = clamp(record.gear, 1, ratios.length);
    let rpm = speed / VEHICLE_SPEC.wheelRadius * ratios[gear - 1] * VEHICLE_SPEC.finalDrive * 60 / (2 * Math.PI);
    if (rpm > 6100 && record.gear < ratios.length) record.gear++;
    if (rpm < 1850 && record.gear > 1) record.gear--;
    if (reversing) record.gear = 1;
    const ratio = reversing ? 3.38 : ratios[record.gear - 1];
    rpm = speed / VEHICLE_SPEC.wheelRadius * ratio * VEHICLE_SPEC.finalDrive * 60 / (2 * Math.PI);
    // A slipping clutch permits launch and hill starts while idle remains stable.
    record.rpm = clamp(Math.max(850 + Math.abs(throttle) * 1200, rpm), 850, 6800);
    const torque = this.#torqueAt(record.rpm) * record.engineHealth;
    const engineForce = torque * ratio * VEHICLE_SPEC.finalDrive * .87 / VEHICLE_SPEC.wheelRadius * throttle * (brake > .15 ? 0 : 1);
    const maxSteer = lerp(.49, .15, clamp(speed / 35, 0, 1));
    const targetSteering = -clamp(controls.steer || 0, -1, 1) * maxSteer + record.steeringDamage;
    record.steeringAngle += clamp(targetSteering - record.steeringAngle, -2.0 * dt, 2.0 * dt);
    record.raycast.setSteeringValue(record.steeringAngle, 0); record.raycast.setSteeringValue(record.steeringAngle, 1);
    for (let i = 0; i < 4; i++) {
      const w = record.wheels[i];
      const baseSurface = w.raycastResult.shape?.surface || w.raycastResult.body?.surface || 'asphalt';
      const contact = w.raycastResult.hitPointWorld;
      const surface = w.raycastResult.hasHit ? this.surfaceAt(contact.x, -contact.z, contact.y, baseSurface) : baseSurface;
      w.contactSurface = surface;
      let grip = surfaceGrip(surface, this.wetness) * lerp(.76, 1, record.health);
      // Progressive lateral grip falloff approximates a street tyre beyond peak slip.
      const localVelocity = body.vectorToLocalFrame(body.velocity);
      const slipAngle = Math.abs(Math.atan2(localVelocity.x, Math.max(2, Math.abs(localVelocity.z))));
      grip *= lerp(1, .79, clamp((slipAngle - .12) / .48, 0, 1));
      if (controls.handbrake && i > 1) grip *= .60;
      w.frictionSlip = grip;
      // Rear-wheel drive; longitudinal force is bounded per-wheel after suspension loads.
      record.raycast.applyEngineForce(i > 1 ? engineForce / 2 : 0, i);
      const wheelBrakeForce = brake * (i < 2 ? 5500 : 3800) + (controls.handbrake && i > 1 ? 7500 : 0) + 22;
      record.raycast.setBrake(wheelBrakeForce * dt, i);
    }
    // Air resistance and rolling resistance act on the rigid body, never by position edits.
    const v = body.velocity.length();
    if (v > .1) {
      const resistance = .5 * 1.225 * VEHICLE_SPEC.dragCoefficient * VEHICLE_SPEC.frontalArea * v * v;
      body.applyForce(body.velocity.scale(-resistance / v));
    }
    record.distance += speed * dt;
  }
  #torqueAt(rpm) {
    const curve = [[850, 155], [1600, 219], [2700, 270], [3900, 285], [5000, 276], [6100, 236], [6800, 160]];
    for (let i = 1; i < curve.length; i++) if (rpm <= curve[i][0]) return lerp(curve[i - 1][1], curve[i][1], clamp((rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]), 0, 1));
    return curve[curve.length - 1][1];
  }
  #trafficControls(record) {
    const controls = record.controls, body = record.body;
    if (record.wait > 0) { record.wait -= FIXED_STEP; controls.throttle = 0; controls.brake = .7; return; }
    const route = record.route;
    let target = route[record.targetIndex], previous = route[Math.max(0, record.targetIndex - 1)];
    const distance = Math.hypot(target.x - body.position.x, target.y + body.position.z);
    if (distance < Math.max(6, body.velocity.length() * .65) && record.targetIndex < route.length - 1) { record.targetIndex++; target = route[record.targetIndex]; previous = route[record.targetIndex - 1]; }
    const dx = target.x - previous.x, dy = target.y - previous.y, length = Math.hypot(dx, dy) || 1;
    const desiredPoint = new CANNON.Vec3(target.x + dy / length * record.laneOffset, target.z, -target.y + dx / length * record.laneOffset);
    const local = body.pointToLocalFrame(desiredPoint);
    controls.steer = clamp(Math.atan2(local.x, -local.z) * 1.6, -1, 1);
    const targetSpeed = Math.min(32, record.road.speedKph || 32) / 3.6 * lerp(1, .5, Math.abs(controls.steer));
    const speed = body.velocity.length();
    controls.throttle = clamp((targetSpeed - speed) * .35, 0, .72);
    controls.brake = speed > targetSpeed + 1 ? .2 : 0;
    const endDistance = Math.hypot(route.at(-1).x - body.position.x, route.at(-1).y + body.position.z);
    if (record.targetIndex === route.length - 1 && endDistance < 18) { controls.throttle = 0; controls.brake = .6; }
    // These cars obey proximity and yield behaviour; full signal-aware junction routing
    // belongs in the city-agnostic production traffic graph, not this preview.
    for (const other of [this.vehicle, ...this.traffic]) {
      if (other === record) continue;
      const relative = body.pointToLocalFrame(other.body.position);
      const ahead = -relative.z;
      if (ahead > 0 && ahead < Math.max(9, speed * 2.1) && Math.abs(relative.x) < 2.6) { controls.throttle = 0; controls.brake = Math.max(controls.brake, .75); }
    }
  }
  step(dt) {
    this.accumulator += clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps++ < 6) {
      this.elapsed += FIXED_STEP;
      this.#drive(this.vehicle, this.controls, FIXED_STEP);
      for (const car of this.traffic) { this.#trafficControls(car); this.#drive(car, car.controls, FIXED_STEP); }
      this.world.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    for (const car of [this.vehicle, ...this.traffic]) for (let i = 0; i < 4; i++) car.raycast.updateWheelTransform(i);
    const car = this.vehicle;
    this.gear = this.controls.throttle < 0 && this.signedSpeedKph < 4 ? 'R' : car.gear;
    this.rpm = car.rpm;
    this.currentRoad = nearestRoad(this.segments, car.body.position.x, -car.body.position.z, 40);
    this.onRoad = this.currentRoad?.onRoad ?? false;
    const inAir = this.airborne;
    if (car.wasAirborne && !inAir && this.elapsed > 1) this.events.push({ type: 'landed', time: this.elapsed });
    car.wasAirborne = inAir;
    if (this.events.length > 20) this.events.splice(0, this.events.length - 20);
  }
  dispose() {
    this.vehicle.raycast.removeFromWorld(this.world);
    for (const car of this.traffic) car.raycast.removeFromWorld(this.world);
    for (const body of this.staticBodies) this.world.removeBody(body);
  }
}
