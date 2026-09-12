import * as CANNON from "cannon-es";
const vec = (value) =>
  Array.isArray(value)
    ? new CANNON.Vec3(...value)
    : new CANNON.Vec3(value?.x || 0, value?.y || 0, value?.z || 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Arcade pursuit rules layered over ordinary dynamic police vehicles.
 * A wanted level changes control targets, never world positions or velocities. */
export class PursuitSystem {
  constructor(sim, city, config = {}) {
    this.sim = sim;
    this.city = city;
    this.config = {
      evadeSeconds: 60,
      captureSeconds: 3,
      captureDistance: 6.5,
      captureMaxSpeedKph: 6,
      copCaptureMaxSpeedKph: 14,
      sightDistance: 125,
      sightInterval: 0.2,
      dispatchGraceSeconds: 2.5,
      ...config,
    };
    this.state = "idle";
    this.severity = 0;
    this.unseenSeconds = 0;
    this.captureProgress = 0;
    this.captureSeconds = 0;
    this.elapsed = 0;
    this.incidentAt = -Infinity;
    this.nextSightAt = 0;
    this.lastKnownPosition = sim.vehicle.body.position.clone();
    this.visibleOfficers = [];
    this.events = [];
    this.sequence = 0;
    sim.pursuit = this;
  }
  get officers() {
    return this.sim.allVehicles.filter(
      (v) => v.role === "police" && v !== this.sim.vehicle && !v.abandoned,
    );
  }
  get wanted() {
    return this.state !== "idle";
  }
  get escapeRemaining() {
    return Math.max(0, this.config.evadeSeconds - this.unseenSeconds);
  }
  #emit(type, extra = {}) {
    const event = {
      type,
      sequence: ++this.sequence,
      time: this.elapsed,
      state: this.state,
      severity: this.severity,
      ...extra,
    };
    this.events.push(event);
    if (this.events.length > 64) this.events.shift();
    return event;
  }
  reportIncident(incident = {}) {
    if (incident.player === false || this.state === "busted") return false;
    const kind = incident.outcome || incident.type || "";
    if (kind === "stagger" || kind === "pedestrian-staggered") return false;
    const inferred = /fatal|killed|death/.test(kind)
      ? 2
      : /injur|theft|steal/.test(kind)
        ? 1
        : 0;
    const severity = clamp(Number(incident.severity ?? inferred), 0, 3);
    if (!severity) return false;
    this.severity = Math.max(this.severity, severity);
    this.state = "pursuit";
    this.unseenSeconds = 0;
    this.captureSeconds = 0;
    this.captureProgress = 0;
    this.incidentAt = this.elapsed;
    this.nextSightAt = 0;
    this.lastKnownPosition = incident.position
      ? vec(incident.position)
      : this.sim.vehicle.body.position.clone();
    for (const officer of this.officers) {
      officer.chaseTarget = this.lastKnownPosition.clone();
      officer.nextChaseRouteAt = 0;
      officer.policeLights = true;
      officer.policeHold = false;
    }
    this.#emit("wanted", {
      incidentType: kind,
      position: [
        this.lastKnownPosition.x,
        this.lastKnownPosition.y,
        this.lastKnownPosition.z,
      ],
    });
    return true;
  }
  hasLineOfSight(officer, target = this.sim.vehicle) {
    const from = officer.body.position.clone(),
      to = target.body.position.clone();
    if (from.distanceTo(to) > this.config.sightDistance) return false;
    from.y += 0.38;
    to.y += 0.38;
    // Sample the existing piecewise terrain directly. Casting a125m ray through
    // Cannon's heightfield materializes thousands of cached triangle prisms.
    const length = from.distanceTo(to),
      samples = Math.max(1, Math.ceil(length));
    for (let i = 1; i < samples; i++) {
      const t = i / samples,
        x = from.x + (to.x - from.x) * t,
        y = from.y + (to.y - from.y) * t,
        z = from.z + (to.z - from.z) * t;
      if (this.sim.sampleElevation(x, -z) > y + 0.04) return false;
    }
    let blocked = false;
    this.sim.world.raycastAll(
      from,
      to,
      { skipBackfaces: false, collisionFilterMask: ~2 },
      (hit) => {
        if (
          hit.body === officer.body ||
          hit.body === target.body ||
          hit.body?.isVehicle ||
          hit.body?.isPedestrian
        )
          return;
        const surface = hit.shape?.surface || hit.body?.surface;
        if (
          surface === "building" ||
          surface === "ground" ||
          surface === "obstacle"
        )
          blocked = true;
      },
    );
    return !blocked;
  }
  update(dt) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.elapsed += elapsed;
    if (this.state === "idle") return;
    if (this.state === "busted") {
      Object.assign(this.sim.controls, {
        throttle: 0,
        steer: 0,
        brake: 1,
        handbrake: true,
      });
      return;
    }
    if (this.elapsed >= this.nextSightAt) {
      this.visibleOfficers = this.officers.filter((officer) =>
        this.hasLineOfSight(officer),
      );
      this.nextSightAt = this.elapsed + this.config.sightInterval;
      for (const officer of this.officers)
        officer.hasVisualTarget = this.visibleOfficers.includes(officer);
    }
    if (this.visibleOfficers.length) {
      const reacquired = this.state === "search";
      this.state = "pursuit";
      this.unseenSeconds = 0;
      this.lastKnownPosition.copy(this.sim.vehicle.body.position);
      if (reacquired) this.#emit("spotted");
    } else {
      if (this.state !== "search") {
        this.state = "search";
        this.#emit("searching");
      }
      this.unseenSeconds += elapsed;
      if (this.unseenSeconds + 1e-8 >= this.config.evadeSeconds) {
        this.#clear();
        return;
      }
    }
    for (const officer of this.officers) {
      if (!officer.chaseTarget)
        officer.chaseTarget = this.lastKnownPosition.clone();
      else officer.chaseTarget.copy(this.lastKnownPosition);
      officer.policeLights = true;
    }
    const playerSpeed = this.sim.vehicle.body.velocity.length() * 3.6;
    const close = this.visibleOfficers.some(
      (officer) =>
        officer.body.position.distanceTo(this.sim.vehicle.body.position) <=
          this.config.captureDistance &&
        officer.body.velocity.length() * 3.6 <=
          this.config.copCaptureMaxSpeedKph,
    );
    const grace =
      this.elapsed - this.incidentAt >= this.config.dispatchGraceSeconds;
    if (close && grace && playerSpeed <= this.config.captureMaxSpeedKph)
      this.captureSeconds += elapsed;
    else this.captureSeconds = 0;
    this.captureProgress = clamp(
      this.captureSeconds / this.config.captureSeconds,
      0,
      1,
    );
    if (this.captureSeconds + 1e-8 >= this.config.captureSeconds) {
      this.state = "busted";
      this.captureProgress = 1;
      Object.assign(this.sim.controls, {
        throttle: 0,
        steer: 0,
        brake: 1,
        handbrake: true,
      });
      for (const officer of this.officers) {
        officer.chaseTarget = null;
        officer.policeHold = true;
        officer.controls.throttle = 0;
        officer.controls.brake = 1;
      }
      this.#emit("busted");
    }
  }
  #releasePolice() {
    for (const officer of this.officers) {
      officer.chaseTarget = null;
      officer.policeHold = false;
      officer.hasVisualTarget = false;
      officer.policeLights = false;
      officer.nextChaseRouteAt = 0;
      this.sim.trafficNetwork.rejoin(officer);
    }
  }
  #clear() {
    this.state = "idle";
    this.severity = 0;
    this.captureSeconds = 0;
    this.captureProgress = 0;
    this.visibleOfficers = [];
    this.#releasePolice();
    this.#emit("cleared");
  }
  reset() {
    this.state = "idle";
    this.severity = 0;
    this.unseenSeconds = 0;
    this.captureSeconds = 0;
    this.captureProgress = 0;
    this.visibleOfficers = [];
    this.incidentAt = -Infinity;
    this.#releasePolice();
    this.#emit("reset");
  }
}
