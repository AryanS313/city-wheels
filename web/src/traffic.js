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
    this.nodePositions = new Map();
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
    this.nodePositions.set(edge.from, edge.points[0]);
    this.nodePositions.set(edge.to, edge.points.at(-1));
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
      if (d < 26) continue;
      candidates.push({ d, p, next, edge, index });
    }
    candidates.sort(
      (a, b) => a.d - b.d || String(a.edge.id).localeCompare(String(b.edge.id)),
    );
    const result = [],
      chosen = [];
    const nearbyCount = Math.min(count, Math.ceil(count * 0.35));
    const add = (c) => {
      if (chosen.some((p) => dist(p, c.p) < 13)) return false;
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
      chosen.push(c.p);
      return true;
    };
    for (const c of candidates) {
      if (result.length >= nearbyCount) break;
      add(c);
    }
    while (result.length < count) {
      let best = null,
        bestScore = -1;
      for (const c of candidates) {
        const separation = Math.min(...chosen.map((p) => dist(p, c.p)));
        if (separation < 13) continue;
        // Farthest-point coverage distributes the rest across the whole tile,
        // while the initial group guarantees traffic in the player's vicinity.
        if (separation > bestScore) {
          bestScore = separation;
          best = c;
        }
      }
      if (!best) break;
      add(best);
    }
    return count > 0 ? result : [];
  }
  parkedCandidates(playerPosition, count, existing = []) {
    const result = [],
      used = existing.map((v) => ({
        x: v.body.position.x,
        y: -v.body.position.z,
      }));
    const intersections = (this.city.intersections || []).map((i) =>
      pt(i.position || i),
    );
    for (const road of this.city.roads || []) {
      if ((road.width || 0) < 9.75 || !road.points?.length) continue;
      const points = road.points.map(pt);
      for (let i = 3; i < points.length - 3; i += 3) {
        const p = points[i],
          a = points[i - 1],
          b = points[i + 1],
          dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy) || 1;
        const offset = road.width / 2 - 1.08;
        const parked = {
          x: p.x + (dy / len) * offset,
          y: p.y - (dx / len) * offset,
          z: p.z,
        };
        if (
          intersections.some((j) => dist(j, p) < 14) ||
          used.some((j) => dist(j, parked) < 10) ||
          dist({ x: playerPosition.x, y: -playerPosition.z }, parked) < 12
        )
          continue;
        result.push({
          spawn: { ...parked, headingRadians: Math.atan2(dx, dy) },
        });
        used.push(parked);
        if (result.length >= count) return count > 0 ? result : [];
      }
    }
    return count > 0 ? result : [];
  }
  nearestEdge(position, heading = null) {
    const p = { x: position.x, y: -position.z };
    let best = null;
    for (const edge of this.edges)
      for (let i = 0; i < edge.points.length - 1; i++) {
        const a = edge.points[i],
          b = edge.points[i + 1],
          dx = b.x - a.x,
          dy = b.y - a.y,
          l2 = dx * dx + dy * dy;
        const t = clamp(
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (l2 || 1),
            0,
            1,
          ),
          distance = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        const directionPenalty = heading
          ? Math.max(
              0,
              1 - (heading.x * dx - heading.z * dy) / Math.sqrt(l2 || 1),
            ) * 6
          : 0;
        const score = distance + directionPenalty;
        if (!best || score < best.score) best = { edge, index: i, t, score };
      }
    return best;
  }
  rejoin(record) {
    const state = this.nearestEdge(
      record.body.position,
      record.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, -1)),
    );
    if (state) this.attach(record, { ...state, seed: record.body.id });
  }
  pathBetween(from, to) {
    if (from === to) return [];
    const goal = this.nodePositions.get(to);
    if (!goal) return null;
    const open = [{ node: from, cost: 0, priority: 0 }],
      costs = new Map([[from, 0]]),
      came = new Map();
    let count = 0;
    while (open.length && count++ < 6000) {
      open.sort((a, b) => a.priority - b.priority);
      const current = open.shift();
      if (current.cost !== costs.get(current.node)) continue;
      if (current.node === to) {
        const result = [];
        let cursor = to;
        while (cursor !== from) {
          const e = came.get(cursor);
          if (!e) return null;
          result.push(e);
          cursor = e.from;
        }
        return result.reverse();
      }
      for (const edge of this.outgoing.get(current.node) || []) {
        const nextCost = current.cost + edge.length;
        if (nextCost < (costs.get(edge.to) ?? Infinity)) {
          costs.set(edge.to, nextCost);
          came.set(edge.to, edge);
          open.push({
            node: edge.to,
            cost: nextCost,
            priority: nextCost + dist(edge.points.at(-1), goal),
          });
        }
      }
    }
    return null;
  }
  routeTo(record, worldTarget) {
    const start = this.nearestEdge(
        record.body.position,
        record.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, -1)),
      ),
      goal = this.nearestEdge(worldTarget);
    if (!start || !goal) return false;
    let route,
      edges = [];
    if (start.edge.id === goal.edge.id && goal.index >= start.index)
      route = this.#lanePoints(start.edge).slice(start.index, goal.index + 2);
    else {
      const middle = this.pathBetween(start.edge.to, goal.edge.from);
      if (!middle) return false;
      edges = [start.edge, ...middle, goal.edge];
      route = this.#lanePoints(start.edge).slice(start.index);
      for (const e of middle) route.push(...this.#lanePoints(e).slice(1));
      route.push(...this.#lanePoints(goal.edge).slice(1, goal.index + 2));
    }
    if (route.length < 2) return false;
    record.navigation = {
      edge: goal.edge,
      route,
      seed: record.body.id,
      transitions: edges.length,
      stuckTime: record.navigation?.stuckTime || 0,
      reverseTime: 0,
      yieldTime: 0,
    };
    record.route = route;
    return true;
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
    if (record.chaseTarget) return;
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
    if (record.chaseTarget && sim.elapsed >= (record.nextChaseRouteAt || 0)) {
      this.routeTo(record, record.chaseTarget);
      record.nextChaseRouteAt = sim.elapsed + 1.1;
    }
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
    // Within an unobstructed close chase, steer toward the actual target rather
    // than a lane waypoint behind it. All motion still uses tyre forces.
    const closeChase =
      record.chaseTarget &&
      record.hasVisualTarget &&
      body.position.distanceTo(record.chaseTarget) < 23;
    if (closeChase)
      target = {
        x: record.chaseTarget.x,
        y: -record.chaseTarget.z,
        z: record.chaseTarget.y,
        speedKph: 45,
      };
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
    let desiredSpeed =
      (record.chaseTarget
        ? Math.min(68, Math.max(32, (sim.speedKph || 0) + 20))
        : Math.min(34, target.speedKph || 32)) / 3.6;
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
      if (other === record || (record.chaseTarget && other === sim.vehicle))
        continue;
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
        // Police can move around a stopped queue; ordinary traffic continues to
        // wait. Low-speed physical contact can push a blocker, never teleport it.
        if (
          record.chaseTarget &&
          other.body.velocity.length() < 1.4 &&
          ahead < 15
        ) {
          desiredSpeed = Math.max(desiredSpeed, 1.7);
          record.avoidUntil = sim.elapsed + 1;
          record.avoidDirection = rel.x > 0.3 ? -1 : rel.x < -0.3 ? 1 : -1;
          hazard = false;
        }
      }
      // Stable priority prevents mutual yielding. A safety gap still blocks motion.
      if (
        !record.chaseTarget &&
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
    if (record.chaseTarget && sim.elapsed < (record.avoidUntil || 0))
      c.steer = clamp(c.steer + (record.avoidDirection || -1) * 0.55, -1, 1);
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
    if (closeChase)
      desiredSpeed = Math.min(
        desiredSpeed,
        Math.max(
          0,
          (body.position.distanceTo(record.chaseTarget) - 4.5) * 1.25,
        ) +
          ((sim.speedKph || 0) / 3.6) * 0.6,
      );
    c.throttle = clamp(
      (desiredSpeed - speed) * 0.42,
      0,
      record.chaseTarget ? 1 : 0.85,
    );
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
