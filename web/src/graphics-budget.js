export const GRAPHICS_LEVELS = Object.freeze({
  performance: {
    pixelRatio: 0.8,
    maxPixels: 1280 * 720,
    shadowSize: 512,
    shadowInterval: 1 / 10,
    trafficDistance: 240,
    nearDistance: 24,
  },
  balanced: {
    pixelRatio: 1,
    maxPixels: 1600 * 900,
    shadowSize: 1024,
    shadowInterval: 1 / 20,
    trafficDistance: 280,
    nearDistance: 35,
  },
  high: {
    pixelRatio: 1.5,
    maxPixels: 1920 * 1080,
    shadowSize: 2048,
    shadowInterval: 0,
    trafficDistance: 320,
    nearDistance: 50,
  },
});

/** Automatic graphics changes respond to sustained frame cost, not isolated stalls. */
export class GraphicsBudget {
  constructor(mode = "auto") {
    this.setMode(mode);
  }
  setMode(mode) {
    if (mode !== "auto" && !GRAPHICS_LEVELS[mode])
      throw new RangeError("Unknown graphics mode");
    this.mode = mode;
    this.level = mode === "auto" ? "balanced" : mode;
    this.average = 1 / 60;
    this.slowSeconds = this.fastSeconds = 0;
    this.cooldown = 3;
  }
  get settings() {
    return GRAPHICS_LEVELS[this.level];
  }
  pixelRatio(width, height, deviceRatio = 1) {
    return Math.min(
      deviceRatio,
      this.settings.pixelRatio,
      Math.sqrt(this.settings.maxPixels / Math.max(1, width * height)),
    );
  }
  sample(seconds, active = true) {
    if (
      this.mode !== "auto" ||
      !active ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    )
      return false;
    // Bound a single stall's influence without ignoring persistently overloaded
    // devices. Inactive/paused frames are filtered above.
    seconds = Math.min(seconds, 0.25);
    this.average += (seconds - this.average) * 0.08;
    this.cooldown = Math.max(0, this.cooldown - seconds);
    if (this.cooldown) return false;
    this.slowSeconds = this.average > 0.04 ? this.slowSeconds + seconds : 0;
    this.fastSeconds = this.average < 0.023 ? this.fastSeconds + seconds : 0;
    if (this.level === "balanced" && this.slowSeconds > 2)
      this.level = "performance";
    else if (this.level === "performance" && this.fastSeconds > 12)
      this.level = "balanced";
    else return false;
    this.slowSeconds = this.fastSeconds = 0;
    this.cooldown = 6;
    return true;
  }
}

/** Prefer the first pool and fill unused light slots from later fallback pools. */
export function applyPointLightBudget(pools, maximum) {
  let remaining = Math.max(0, Math.floor(maximum));
  for (const lights of pools)
    for (const light of lights ?? []) {
      light.visible =
        remaining > 0 &&
        Number.isFinite(light.intensity) &&
        light.intensity > 0;
      if (light.visible) remaining--;
    }
  return Math.max(0, Math.floor(maximum)) - remaining;
}
