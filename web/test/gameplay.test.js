import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { DrivingSession, nearestTheftTarget } from "../src/gameplay.js";

function fixture() {
  const make = (x) => ({
    body: new CANNON.Body({ mass: 1450, position: new CANNON.Vec3(x, 1, 0) }),
    profile: { name: "GT" },
    health: 1,
  });
  const original = make(0),
    target = make(4),
    other = make(40);
  const sim = {
    vehicle: original,
    traffic: [target, other],
    controls: {},
    takeVehicle(record) {
      const old = this.vehicle;
      this.traffic = this.traffic.filter((r) => r !== record);
      this.traffic.push(old);
      this.vehicle = record;
      return { ok: true };
    },
    reset() {
      this.resets = (this.resets || 0) + 1;
    },
  };
  const life = {
    events: [],
    people: [],
    spawnOccupant(record) {
      this.exited = record;
    },
    reset() {
      this.resets = (this.resets || 0) + 1;
      this.events = [];
    },
  };
  const pursuit = {
    state: "idle",
    incidents: [],
    reportIncident(event) {
      this.incidents.push(event);
      this.state = "pursuit";
    },
    reset() {
      this.state = "idle";
      this.incidents = [];
    },
  };
  return {
    original,
    target,
    other,
    sim,
    life,
    pursuit,
    session: new DrivingSession(sim, life, pursuit),
  };
}
function hold(session, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++)
    session.update(1 / 60, { stealHeld: true });
}

test("injuries and fatalities caused by the player trigger a response; NPC impacts and stumbles do not", () => {
  const f = fixture();
  f.life.events.push(
    { player: false, outcome: "fatal" },
    { player: true, outcome: "stagger" },
    { player: true, outcome: "injured", position: [1, 2, 3], personId: "p1" },
  );
  f.session.update(1 / 60);
  assert.equal(f.pursuit.incidents.length, 1);
  assert.equal(f.pursuit.incidents[0].type, "injury");
  f.life.events.push({
    player: true,
    outcome: "fatal",
    position: [1, 2, 3],
    personId: "p1",
  });
  f.session.update(1 / 60);
  assert.equal(f.pursuit.incidents.at(-1).severity, 3);
  assert.equal(f.life.events.length, 0);
});

test("theft requires a continuous hold, transfers the actual car and cannot repeat while held", () => {
  const f = fixture();
  hold(f.session, 0.6);
  assert.equal(f.sim.vehicle, f.original);
  f.session.update(1 / 60, { stealHeld: false });
  hold(f.session, 0.7);
  assert.equal(f.sim.vehicle, f.original);
  hold(f.session, 0.6);
  assert.equal(f.sim.vehicle, f.target);
  assert.equal(f.life.exited, f.target);
  assert.equal(f.pursuit.incidents[0].type, "theft");
  hold(f.session, 3);
  assert.equal(f.sim.vehicle, f.target);
  assert.equal(f.pursuit.incidents.length, 1);
});

test("a car that moves away, passes on a different level or is too fast cannot be stolen", () => {
  const f = fixture();
  hold(f.session, 1);
  f.target.body.position.x = 9;
  hold(f.session, 1);
  assert.equal(f.sim.vehicle, f.original);
  f.target.body.position.set(3, 5, 0);
  assert.equal(nearestTheftTarget(f.sim), null);
  f.target.body.position.set(3, 1, 0);
  f.target.body.velocity.set(4, 0, 0);
  assert.equal(nearestTheftTarget(f.sim), null);
  f.sim.vehicle.body.velocity.set(-3, 0, 0);
  f.target.body.velocity.set(3, 0, 0);
  assert.equal(nearestTheftTarget(f.sim), null);
});

test("parked car theft does not create a phantom driver and busted blocks further crime/actions", () => {
  const f = fixture();
  f.target.parked = true;
  hold(f.session, 1.3);
  assert.equal(f.life.exited, undefined);
  f.pursuit.state = "busted";
  f.life.events.push({ player: true, outcome: "fatal" });
  f.session.update(1 / 60, { stealHeld: true });
  assert.equal(f.pursuit.state, "busted");
  assert.ok(f.session.events.some((e) => e.type === "busted"));
  f.session.restart();
  assert.equal(f.pursuit.state, "idle");
  assert.equal(f.life.resets, 1);
  assert.equal(f.sim.resets, 1);
  assert.equal(f.session.events.length, 0);
});
