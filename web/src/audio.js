/** Small procedural audio engine. Every sound follows live simulation telemetry. */
export class VehicleAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
  }
  start() {
    if (!this.context) this.create();
    this.context.resume();
    this.enabled = true;
  }
  toggle() {
    if (!this.context) this.start();
    else this.enabled = !this.enabled;
    return this.enabled;
  }
  create() {
    const ctx = (this.context = new (window.AudioContext ||
      window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(ctx.destination);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 500;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);
    this.harmonics = [1, 2, 4].map((order, index) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = index === 0 ? "triangle" : "sawtooth";
      gain.gain.value = [0.7, 0.22, 0.06][index];
      osc.frequency.value = 40 * order;
      osc.connect(gain);
      gain.connect(this.engineGain);
      osc.start();
      return { osc, order };
    });
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    let s = 91237;
    for (let i = 0; i < samples.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      samples[i] = (s / 4294967296) * 2 - 1;
    }
    const loop = () => {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      n.start();
      return n;
    };
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = "bandpass";
    this.skidFilter.frequency.value = 1600;
    this.skidFilter.Q.value = 0.7;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    loop().connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 430;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop().connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "lowpass";
    sirenFilter.frequency.value = 1600;
    this.sirenGain.connect(sirenFilter);
    sirenFilter.connect(this.master);
    this.sirens = [1, 1.008].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 650 * detune;
      osc.connect(this.sirenGain);
      osc.start();
      return { osc, detune };
    });
  }
  update(sim, active, pursuit) {
    if (!this.context) return;
    const t = this.context.currentTime,
      on = this.enabled && active;
    const officers = pursuit?.officers || [];
    const nearest = officers.reduce(
      (d, officer) =>
        Math.min(
          d,
          (officer.body || officer.record?.body)?.position.distanceTo(
            sim.vehicle.body.position,
          ) ?? Infinity,
        ),
      Infinity,
    );
    const chasing =
      pursuit && pursuit.state !== "idle" && pursuit.state !== "busted";
    this.sirenGain.gain.setTargetAtTime(
      on && chasing ? Math.max(0, 1 - nearest / 180) * 0.16 : 0,
      t,
      0.18,
    );
    for (const { osc, detune } of this.sirens)
      osc.frequency.setTargetAtTime(
        (700 + Math.sin(sim.elapsed * 4.6) * 310) * detune,
        t,
        0.025,
      );
    for (const { osc, order } of this.harmonics)
      osc.frequency.setTargetAtTime(
        Math.max(24, (sim.rpm / 60) * 2) * order,
        t,
        0.1,
      );
    this.engineFilter.frequency.setTargetAtTime(
      250 + sim.rpm * 0.2 + Math.abs(sim.controls.throttle) * 500,
      t,
      0.1,
    );
    this.engineGain.gain.setTargetAtTime(
      on ? 0.045 + Math.abs(sim.controls.throttle) * 0.065 : 0,
      t,
      0.1,
    );
    const body = sim.vehicle.body,
      local = body.vectorToLocalFrame(body.velocity),
      slip = Math.abs(local.x);
    const skid =
      !sim.airborne && sim.speedKph > 15
        ? Math.min(
            1,
            Math.max(slip - 1.8, 0) * 0.14 + (sim.controls.handbrake ? 0.4 : 0),
          )
        : 0;
    this.skidGain.gain.setTargetAtTime(on ? skid * 0.2 : 0, t, 0.04);
    this.windGain.gain.setTargetAtTime(
      on ? Math.min(0.055, (sim.speedKph * sim.speedKph) / 180000) : 0,
      t,
      0.2,
    );
  }
  impact(event) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context,
      t = ctx.currentTime;
    const severity = Math.min(1, Math.max(0.1, (event.impact || 8) / 22));
    const noise = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    noise.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700 + severity * 2500, t);
    filter.frequency.exponentialRampToValueAtTime(140, t + 0.4);
    gain.gain.setValueAtTime(severity * 0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + severity * 0.35);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start();
    noise.stop(t + 0.6);
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    const thud = ctx.createOscillator(),
      bass = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(110, t);
    thud.frequency.exponentialRampToValueAtTime(28, t + 0.18);
    bass.gain.setValueAtTime(severity * 0.5, t);
    bass.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    thud.connect(bass);
    bass.connect(this.master);
    thud.start();
    thud.stop(t + 0.35);
    thud.onended = () => {
      thud.disconnect();
      bass.disconnect();
    };
  }
  horn() {
    if (!this.enabled || !this.context) return;
    const ctx = this.context,
      t = ctx.currentTime;
    for (const hz of [330, 440]) {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = hz;
      g.gain.setValueAtTime(0.045, t);
      g.gain.setTargetAtTime(0.0001, t + 0.25, 0.06);
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      osc.stop(t + 0.6);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    }
  }
}
