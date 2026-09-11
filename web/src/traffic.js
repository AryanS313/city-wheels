import * as CANNON from "cannon-es";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pt = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] || 0 } : p);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (p) => `${Math.round(p.x * 5)},${Math.round(p.y * 5)}`;
/** Deterministic directional lane routing. This is a prototype traffic driver,
 * not a complete traffic-law or intersection simulation. Motion stays dynamic. */
export class TrafficNetwork {
  constructor(city) {
    this.city = city;
    this.bounds = city.bounds || {
      minX: -500,
      maxX: 500,
      minY: -500,
      maxY: 500,
    };
    this.edges = [];
    this.outgoing = new Map();
    this.roads = new Map((city.roads || []).map((r) => [r.id, r]));
    const edges = city.graph?.edges;
    if (edges?.length)
      for (const e of edges) this.#add({ ...e, points: e.points.map(pt) });
    else
      for (const [i, r] of (city.roads || []).entries()) {
        if (!r.points?.length) continue;
        const points = r.points.map(pt),
          from = key(points[0]),
          to = key(points.at(-1));
        if (r.oneway !== -1)
          this.#add({
            id: `${i}+`,
            from,
            to,
            points,
            roadId: r.id,
            speedKph: r.speedKph,
          });
        if (!r.oneway || r.oneway === -1)
          this.#add({
            id: `${i}-`,
            from: to,
            to: from,
            points: [...points].reverse(),
            roadId: r.id,
            speedKph: r.speedKph,
          });
      }
  }
  #add(edge) {
    if (edge.points.length < 2) return;
    edge.road = this.roads.get(edge.roadId) || {};
    if (
      ["footway", "steps", "path", "pedestrian", "cycleway"].includes(
        edge.road.highway,
      )
    )
      return;
    edge.length =
      edge.lengthMeters ||
      edge.points.slice(1).reduce((n, p, i) => n + dist(p, edge.points[i]), 0);
    if (edge.length < 0.5) return;
    this.edges.push(edge);
    if (!this.outgoing.has(edge.from)) this.outgoing.set(edge.from, []);
    this.outgoing.get(edge.from).push(edge);
  }
  #lanePoints(edge) {
    const laneOffset = edge.road.oneway
      ? Math.min(1.1, (edge.road.width || 6.5) * 0.18)
      : Math.min(1.55, (edge.road.width || 6.5) * 0.24);
    return edge.points.map((p, i, a) => {
      const prev = a[Math.max(0, i - 1)],
        next = a[Math.min(a.length - 1, i + 1)],
        dx = next.x - prev.x,
        dy = next.y - prev.y,
        len = Math.hypot(dx, dy) || 1;
      return {
        ...p,
        x: p.x + (dy / len) * laneOffset,
        y: p.y - (dx / len) * laneOffset,
        edgeId: edge.id,
        junction: i === a.length - 1 ? edge.to : null,
        speedKph: edge.speedKph || 32,
      };
    });
  }
  #next(edge, seed) {
    const choices = (this.outgoing.get(edge.to) || []).filter(
      (e) => e.to !== edge.from,
    );
    const options = choices;
    if (!options.length) return null;
    const a = edge.points.at(-2),
      b = edge.points.at(-1),
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy) || 1;
    const ranked = options
      .map((e) => {
        const c = e.points[0],
          d = e.points[1],
          l = dist(c, d) || 1,
          end = e.points.at(-1);
        const margin = Math.min(
          end.x - (this.bounds.minX ?? -500),
          (this.bounds.maxX ?? 500) - end.x,
          end.y - (this.bounds.minY ?? -500),
          (this.bounds.maxY ?? 500) - end.y,
        );
        const deadEnd = !(this.outgoing.get(e.to) || []).some(
          (next) => next.to !== e.from,
        );
        return {
          e,
          dot:
            (dx * (d.x - c.x) + dy * (d.y - c.y)) / (len * l) -
            (margin < 48 ? 2 : 0) -
            (deadEnd ? 3 : 0),
        };
      })
      .sort(
        (a, b) => b.dot - a.dot || String(a.e.id).localeCompare(String(b.e.id)),
      );
    // Most cars continue naturally along a street; occasional turns diversify flow.
    return ranked[seed % 7 === 0 && ranked.length > 1 ? 1 : 0].e;
  }
  spawnCandidates(playerPosition, count) {
    const player = { x: playerPosition.x, y: -playerPosition.z };
    const candidates = [];
    for (const edge of this.edges) {
      if (
        edge.length < 18 ||
        !(this.outgoing.get(edge.to) || []).some((e) => e.to !== edge.from)
      )
        continue;
      const route = this.#lanePoints(edge),
        index = Math.min(route.length - 2, Math.floor(route.length * 0.35)),
        p = route[index],
        next = route[index + 1];
      const d = dist(player, p);
      if (d < 32 || d > 360) continue;
      candidates.push({ d, p, next, edge, index });
    }
    candidates.sort(
      (a, b) => a.d - b.d || String(a.edge.id).localeCompare(String(b.edge.id)),
    );
    const result = [];
    for (const c of candidates) {
      if (result.some((r) => dist(r.spawn, c.p) < 16)) continue;
      result.push({
        spawn: {
          ...c.p,
          headingRadians: Math.atan2(c.next.x - c.p.x, c.next.y - c.p.y),
        },
        routeState: {
          edge: c.edge,
          index: c.index,
          seed: result.length * 17 + 3,
        },
      });
      if (result.length >= count) break;
    }
    return count > 0 ? result : [];
  }
  attach(record, state) {
    record.navigation = {
      edge: state.edge,
      route: this.#lanePoints(state.edge).slice(state.index),
      seed: state.seed,
      transitions: 0,
      stuckTime: 0,
      reverseTime: 0,
      yieldTime: 0,
    };
    record.road = state.edge.road;
    record.route = record.navigation.route;
    this.#extend(record);
  }
  #extend(record) {
    const n = record.navigation;
    let distance = n.route
      .slice(1)
      .reduce((sum, p, i) => sum + dist(p, n.route[i]), 0);
    let guard = 0;
    while (distance < 95 && guard++ < 45) {
      const next = this.#next(n.edge, n.seed + n.transitions);
      if (!next) break;
      const points = this.#lanePoints(next);
      distance += next.length;
      n.route.push(...points.slice(1));
      n.edge = next;
      n.transitions++;
    }
    record.route = n.route;
  }
  update(record, sim, dt) {
    const n = record.navigation,
      c = record.controls,
      body = record.body,
      speed = body.velocity.length();
    if (!n?.route.length) {
      c.throttle = 0;
      c.brake = 0.8;
      return;
    }
    const here = { x: body.position.x, y: -body.position.z };
    // Advance past waypoints using their plane, so overshoot never makes a car
    // turn back toward a stale target and stall at an OSM way boundary.
    while (n.route.length > 2) {
      const a = n.route[0],
        b = n.route[1],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy) || 1;
      const along = ((here.x - b.x) * dx + (here.y - b.y) * dy) / len;
      if (dist(here, b) < 2.8 || (along > 0 && dist(here, b) < 20))
        n.route.shift();
      else break;
    }
    this.#extend(record);
    const lookahead = clamp(4 + speed * 0.75, 4, 13);
    let target = n.route.at(-1),
      walk = 0,
      previous = here;
    for (const p of n.route) {
      walk += dist(previous, p);
      if (walk >= lookahead) {
        target = p;
        break;
      }
      previous = p;
    }
    const local = body.pointToLocalFrame(
      new CANNON.Vec3(target.x, target.z, -target.y),
    );
    const angle = Math.atan2(local.x, -local.z),
      maxSteer = 0.49 - (0.49 - 0.15) * clamp(speed / 35, 0, 1);
    c.steer = clamp(
      Math.atan2(
        2 * 2.68 * Math.sin(angle),
        Math.max(2, Math.hypot(local.x, local.z)),
      ) / maxSteer,
      -1,
      1,
    );
    let desiredSpeed = Math.min(34, target.speedKph || 32) / 3.6;
    desiredSpeed *= 1 - 0.64 * clamp(Math.abs(angle) / 0.9, 0, 1);
    const tail = n.route.at(-1);
    if (
      n.route.length < 6 &&
      !(this.outgoing.get(n.edge.to) || []).some((e) => e.to !== n.edge.from)
    )
      desiredSpeed = Math.min(
        desiredSpeed,
        Math.sqrt(Math.max(0, dist(here, tail) - 4) * 4),
      );
    let hazard = false;
    const vehicles = [sim.vehicle, ...sim.traffic];
    for (const other of vehicles) {
      if (other === record) continue;
      const rel = body.pointToLocalFrame(other.body.position),
        ahead = -rel.z;
      if (Math.abs(rel.y) > 3) continue;
      if (
        ahead > 0 &&
        ahead < Math.max(7, speed * 1.25 + (speed * speed) / 11) &&
        Math.abs(rel.x) < 1.95
      ) {
        const safeSpeed = Math.max(0, (ahead - 6) * 0.62);
        desiredSpeed = Math.min(desiredSpeed, safeSpeed);
        hazard = true;
      }
      // Stable priority prevents mutual yielding. A safety gap still blocks motion.
      if (
        other.body.id < body.id &&
        ahead > 1 &&
        ahead < 13 &&
        Math.abs(rel.x) < 10 &&
        other.body.velocity.length() > 1
      ) {
        const f1 = body.vectorToWorldFrame(new CANNON.Vec3(0, 0, -1)),
          f2 = other.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, -1));
        if (Math.abs(f1.dot(f2)) < 0.65 && n.yieldTime < 2.8) {
          desiredSpeed = Math.min(desiredSpeed, 2);
          n.yieldTime += dt;
        }
      }
    }
    const pedestrians =
      sim.pedestrianBodies ||
      (sim.pedestrians?.length
        ? sim.pedestrians.map((p) => p.body || p)
        : sim.world.bodies.filter((body) => body.isPedestrian));
    for (const pedestrian of pedestrians) {
      if (!pedestrian.position) continue;
      const rel = body.pointToLocalFrame(pedestrian.position),
        ahead = -rel.z;
      if (
        ahead > 0 &&
        ahead < Math.max(8, speed * 1.5) &&
        Math.abs(rel.x) < 2.2 &&
        Math.abs(rel.y) < 3
      ) {
        desiredSpeed = 0;
        hazard = true;
      }
    }
    c.throttle = clamp((desiredSpeed - speed) * 0.42, 0, 0.85);
    c.brake =
      speed > desiredSpeed + 0.5
        ? clamp((speed - desiredSpeed) * 0.22, 0, 0.9)
        : 0;
    if (hazard && desiredSpeed < 0.3) c.brake = Math.max(c.brake, 0.8);
    if (speed > 0.9) n.stuckTime = 0;
    else if (!hazard && desiredSpeed > 1) n.stuckTime += dt;
    if (n.stuckTime > 3.5) {
      n.reverseTime = 1.4;
      n.stuckTime = 0;
    }
    if (n.reverseTime > 0) {
      n.reverseTime -= dt;
      c.throttle = -0.45;
      c.brake = 0;
      c.steer = -Math.sign(angle || 1) * 0.55;
    }
    if (!hazard) n.yieldTime = Math.max(0, n.yieldTime - dt * 0.1);
  }
}
