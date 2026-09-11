import * as THREE from "three";
const xyz = (v) => (Array.isArray(v) ? v : [v?.x || 0, v?.y || 0, v?.z || 0]);
/** Bounded impact sparks/dust, physical tyre trails and a short camera impulse. */
export class DrivingEffects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.shake = 0;
    this.shakeAge = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(256 * 3), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(256 * 3), 3),
    );
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.11,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.marks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: "#121a21",
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      1800,
    );
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.markCursor = 0;
    this.previous = [null, null, null, null];
    scene.add(this.marks);
    this.object = new THREE.Object3D();
    this.lastMarkTime = 0;
  }
  impact(event) {
    const strength = Math.min(1, (event.impact || 5) / 22);
    if (event.player !== false) {
      this.shake = Math.max(this.shake, strength * 0.16);
      this.shakeAge = 0;
    }
    const p = xyz(event.hitPosition || event.position);
    if (!event.hitPosition && !event.position) return;
    const flesh = event.otherType === "pedestrian" || event.isPedestrian;
    for (let i = 0; i < Math.round(7 + strength * 18); i++) {
      if (this.particles.length >= 256) this.particles.shift();
      const a = Math.random() * Math.PI * 2,
        s = 0.8 + Math.random() * strength * 6;
      this.particles.push({
        x: p[0],
        y: p[1],
        z: p[2],
        vx: Math.cos(a) * s,
        vy: 1 + Math.random() * 4,
        vz: Math.sin(a) * s,
        life: 0.2 + Math.random() * 0.6,
        maxLife: 0.8,
        color: flesh ? [0.45, 0.4, 0.3] : [1, 0.57, 0.12],
      });
    }
  }
  update(sim, dt, paused = false) {
    if (paused) return;
    this.shakeAge += dt;
    this.shake *= Math.exp(-dt * 8);
    const pos = this.points.geometry.attributes.position,
      col = this.points.geometry.attributes.color;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      pos.setXYZ(i, p.x, p.y, p.z);
      const f = p.life / p.maxLife;
      col.setXYZ(i, p.color[0] * f, p.color[1] * f, p.color[2] * f);
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.particles.length);
    const velocity = sim.vehicle.body.vectorToLocalFrame(
      sim.vehicle.body.velocity,
    );
    const sliding =
      sim.speedKph > 12 &&
      (Math.abs(velocity.x) > 2.3 ||
        sim.controls.handbrake ||
        sim.controls.brake > 0.65);
    if (!sliding) {
      this.previous.fill(null);
      return;
    }
    if (sim.elapsed - this.lastMarkTime < 0.035) return;
    this.lastMarkTime = sim.elapsed;
    for (let i = 0; i < 4; i++) {
      const wheel = sim.vehicle.raycast.wheelInfos[i];
      if (!wheel.isInContact) {
        this.previous[i] = null;
        continue;
      }
      const v = wheel.raycastResult.hitPointWorld,
        p = new THREE.Vector3(v.x, v.y + 0.025, v.z),
        last = this.previous[i];
      this.previous[i] = p;
      if (!last) continue;
      const length = p.distanceTo(last);
      if (length < 0.03 || length > 3) continue;
      this.object.position.copy(last).add(p).multiplyScalar(0.5);
      this.object.rotation.set(
        -Math.PI / 2,
        0,
        Math.atan2(p.x - last.x, p.z - last.z),
      );
      this.object.scale.set(0.19, length, 1);
      this.object.updateMatrix();
      this.marks.setMatrixAt(this.markCursor, this.object.matrix);
      this.markCursor = (this.markCursor + 1) % 1800;
      this.marks.count = Math.min(1800, this.marks.count + 1);
      this.marks.instanceMatrix.needsUpdate = true;
    }
  }
  offset() {
    const t = this.shakeAge * 62;
    return new THREE.Vector3(
      Math.sin(t) * this.shake,
      Math.sin(t * 1.7) * this.shake * 0.7,
      0,
    );
  }
}
