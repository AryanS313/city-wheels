// Rules shared by keyboard/touch UI and headless gameplay tests.
export const THEFT_RULES = Object.freeze({
  range: 7,
  speedKph: 12,
  holdSeconds: 1.25,
});

export function nearestTheftTarget(sim) {
  if (sim.vehicle.body.velocity.length() * 3.6 > THEFT_RULES.speedKph)
    return null;
  let nearest = null,
    distance = THEFT_RULES.range;
  for (const record of sim.traffic) {
    if (
      record === sim.vehicle ||
      record.body.velocity.length() * 3.6 > THEFT_RULES.speedKph
    )
      continue;
    if (
      sim.vehicle.body.velocity.vsub(record.body.velocity).length() * 3.6 >
      THEFT_RULES.speedKph
    )
      continue;
    const d = sim.vehicle.body.position.distanceTo(record.body.position);
    if (
      d < distance &&
      Math.abs(record.body.position.y - sim.vehicle.body.position.y) < 2.5
    ) {
      nearest = record;
      distance = d;
    }
  }
  return nearest;
}

export class DrivingSession {
  constructor(sim, life, pursuit) {
    this.sim = sim;
    this.life = life;
    this.pursuit = pursuit;
    this.events = [];
    this.theftTarget = null;
    this.theftSeconds = 0;
    this.stealLatched = false;
    this.candidate = null;
    this.lastState = pursuit.state;
  }
  get wanted() {
    return this.pursuit.state !== "idle";
  }
  get busted() {
    return this.pursuit.state === "busted";
  }
  cancelTheft() {
    this.theftTarget = null;
    this.theftSeconds = 0;
  }
  update(dt, { stealHeld = false } = {}) {
    for (const event of this.life.events.splice(0)) {
      if (this.busted) continue;
      if (!event.player || !["injured", "fatal"].includes(event.outcome))
        continue;
      this.pursuit.reportIncident({
        type: event.outcome === "fatal" ? "fatality" : "injury",
        severity: event.outcome === "fatal" ? 3 : 2,
        position: event.position,
        personId: event.personId,
      });
      this.events.push({ type: "incident", outcome: event.outcome });
    }
    if (!stealHeld) this.stealLatched = false;
    if (this.busted) {
      this.candidate = null;
      this.cancelTheft();
    } else {
      this.candidate = nearestTheftTarget(this.sim);
      if (!stealHeld || !this.candidate || this.stealLatched)
        this.cancelTheft();
      else {
        if (this.theftTarget !== this.candidate) {
          this.theftTarget = this.candidate;
          this.theftSeconds = 0;
        }
        this.theftSeconds += Math.max(0, Math.min(dt, 0.1));
        if (this.theftSeconds >= THEFT_RULES.holdSeconds) this.completeTheft();
      }
    }
    if (this.pursuit.state !== this.lastState) {
      if (this.busted) this.events.push({ type: "busted" });
      else if (this.pursuit.state === "idle" && this.lastState !== "idle")
        this.events.push({ type: "escaped" });
      this.lastState = this.pursuit.state;
    }
  }
  completeTheft() {
    const target = this.theftTarget;
    // Revalidate at completion: a target that drove away cannot be stolen remotely.
    if (!target || nearestTheftTarget(this.sim) !== target) {
      this.cancelTheft();
      return false;
    }
    const wasOccupied = !target.parked;
    const result = this.sim.takeVehicle(target);
    if (
      result === false ||
      result?.ok === false ||
      this.sim.vehicle !== target
    ) {
      this.cancelTheft();
      return false;
    }
    if (wasOccupied) this.life.spawnOccupant?.(target);
    this.sim.pedestrianBodies = this.life.people.map((person) => person.body);
    this.pursuit.reportIncident({
      type: "theft",
      severity: target.role === "police" ? 3 : 1,
      position: target.body.position.toArray(),
    });
    this.events.push({ type: "stolen", record: target });
    this.stealLatched = true;
    this.candidate = null;
    this.cancelTheft();
    return true;
  }
  restart() {
    this.pursuit.reset();
    this.sim.reset();
    this.life.reset();
    this.sim.pedestrianBodies = this.life.people.map((person) => person.body);
    this.events.length = 0;
    this.stealLatched = false;
    this.lastState = this.pursuit.state;
    this.candidate = null;
    this.cancelTheft();
  }
}
