import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "./style.css";
import * as THREE from "three";
import { CityRenderer } from "./render.js";
import { CitySimulation } from "./physics.js";
import {
  createStreetLayout,
  createStreetVisuals,
  AmbientLife,
} from "./ambient.js";
import { VehicleAudio } from "./audio.js";
import { DrivingEffects } from "./effects.js";
import { PursuitSystem } from "./pursuit.js";
import { DrivingSession, THEFT_RULES } from "./gameplay.js";
import { createCityPlaces, createPlaceVisuals } from "./places.js";

const $ = (id) => document.getElementById(id);
const keys = new Set();
let sim,
  view,
  city,
  playing = false,
  paused = false,
  photo = false,
  frame = 0,
  toastUntil = 0,
  lastTime = performance.now(),
  job = null,
  completed = 0,
  life,
  effects,
  pursuit,
  session,
  districtPlaces,
  sound = false,
  drag = null;
const map = $("minimap").getContext("2d");
const clockHours = {
  golden: "17:30",
  day: "12:00",
  fog: "08:20",
  rain: "16:15",
  night: "22:40",
};
const weatherNames = {
  golden: "Golden hour",
  day: "Clear skies",
  fog: "Bay fog",
  rain: "Rain",
  night: "After dark",
};
const touch = {};
const vehicleAudio = new VehicleAudio();
let mapCache = null;
function toast(text, duration = 3500) {
  $("toast").textContent = text;
  $("toast").classList.add("visible");
  toastUntil = performance.now() + duration;
}
function setWeather(name) {
  view.setWeather(name);
  sim.setWeather(name === "rain" ? 1 : name === "fog" ? 0.2 : 0);
  $("clock").textContent = clockHours[name];
  $("weather-label").textContent = weatherNames[name];
  document
    .querySelectorAll("[data-weather]")
    .forEach((b) => b.classList.toggle("active", b.dataset.weather === name));
  if (playing)
    toast(
      name === "rain"
        ? "Roads are wet. Leave more room to brake."
        : weatherNames[name],
    );
}
function resetInput() {
  keys.clear();
  session?.cancelTheft();
  for (const k of Object.keys(touch)) touch[k] = false;
  if (sim)
    Object.assign(sim.controls, {
      throttle: 0,
      steer: 0,
      brake: 0,
      handbrake: false,
    });
}
function setPaused(value) {
  paused = value;
  resetInput();
  document.body.classList.toggle("paused", value && !$("info").open);
}
function changeCamera() {
  view.mode = (view.mode + 1) % 3;
  $("camera-label").textContent = ["CHASE CAM", "COCKPIT CAM", "CINEMATIC CAM"][
    view.mode
  ];
  toast(["Chase camera", "Cockpit camera", "Cinematic camera"][view.mode]);
}
function setPhoto(value) {
  photo = value;
  resetInput();
  view.setPhoto(value);
  document.body.classList.toggle("photo", value);
  $("photo-ui").hidden = !value;
}
function setupAudio(forceOn = false) {
  try {
    if (forceOn) {
      vehicleAudio.start();
      sound = true;
    } else sound = vehicleAudio.toggle();
    $("sound").textContent = sound ? "SOUND ON" : "SOUND OFF";
    $("sound").setAttribute("aria-pressed", String(sound));
  } catch {
    toast("Audio is unavailable in this browser.");
  }
}
function chooseDestination() {
  const candidates = city.roads.filter(
    (r) => r.points.length > 5 && r.highway !== "service",
  );
  const p = sim.vehicle.body.position;
  let list = candidates
    .map((r) => ({ road: r, p: r.points[Math.floor(r.points.length * 0.6)] }))
    .filter(
      (x) =>
        Math.abs(x.p[0]) < 420 &&
        Math.abs(x.p[1]) < 420 &&
        Math.hypot(x.p[0] - p.x, x.p[1] + p.z) > 150,
    );
  if (!list.length)
    list = candidates.map((r) => ({
      road: r,
      p: r.points[Math.floor(r.points.length / 2)],
    }));
  return list[(completed * 13 + 7) % list.length];
}
function beginJob() {
  if (job) {
    job = null;
    $("mission-title").textContent = "Find your way through the hills.";
    $("mission-detail").textContent =
      "A real 1 km² of San Francisco. Every turn is yours.";
    $("job").innerHTML = "Start a delivery <span>↗</span>";
    toast("Delivery cancelled. Back to free roam.");
    return;
  }
  const d = chooseDestination();
  job = {
    destination: d.p,
    road: d.road.name || "the next block",
    started: sim.elapsed,
  };
  $("mission-title").textContent = "Special delivery";
  $("mission-detail").textContent =
    `Take a parcel to ${job.road}. Follow the amber marker and stop nearby.`;
  $("job").textContent = "Cancel delivery";
  toast(`Parcel collected. Head to ${job.road}.`);
}
function drawMap() {
  const w = 300,
    h = 260,
    s = 0.25,
    cx = w / 2,
    cy = h / 2;
  map.clearRect(0, 0, w, h);
  map.lineCap = "round";
  if (!mapCache) {
    mapCache = document.createElement("canvas");
    mapCache.width = w;
    mapCache.height = h;
    const base = mapCache.getContext("2d");
    base.lineCap = "round";
    for (const b of city.buildings) {
      const p = b.footprint;
      base.beginPath();
      p.forEach((p, i) =>
        i
          ? base.lineTo(cx + p[0] * s, cy - p[1] * s)
          : base.moveTo(cx + p[0] * s, cy - p[1] * s),
      );
      base.closePath();
      base.fillStyle = "#263c46";
      base.fill();
    }
    for (const r of city.roads) {
      base.beginPath();
      r.points.forEach((p, i) =>
        i
          ? base.lineTo(cx + p[0] * s, cy - p[1] * s)
          : base.moveTo(cx + p[0] * s, cy - p[1] * s),
      );
      base.strokeStyle = r.name === "Lombard Street" ? "#b59d6c" : "#65808c";
      base.lineWidth = Math.max(1, r.width * s * 0.4);
      base.stroke();
    }
  }
  map.drawImage(mapCache, 0, 0);
  if (job) {
    const p = job.destination;
    map.beginPath();
    map.arc(
      cx + p[0] * s,
      cy - p[1] * s,
      7 + Math.sin(frame * 0.05),
      0,
      Math.PI * 2,
    );
    map.fillStyle = "#fbc578";
    map.fill();
    map.fillStyle = "#172a34";
    map.fillRect(cx + p[0] * s - 2, cy - p[1] * s - 2, 4, 4);
  }
  for (const car of sim.traffic) {
    map.fillStyle =
      car.role === "police"
        ? session?.wanted && frame % 30 < 15
          ? "#ff556d"
          : "#63baff"
        : car.parked
          ? "#7b919a"
          : "#c2d0d6";
    map.fillRect(
      cx + car.body.position.x * s - 1.5,
      cy + car.body.position.z * s - 1.5,
      3,
      3,
    );
  }
  const p = sim.vehicle.body.position;
  map.save();
  map.translate(cx + p.x * s, cy + p.z * s);
  map.rotate(sim.headingRadians);
  map.beginPath();
  map.moveTo(0, -9);
  map.lineTo(6, 7);
  map.lineTo(0, 4);
  map.lineTo(-6, 7);
  map.closePath();
  map.fillStyle = "#f5c273";
  map.shadowColor = "#e5ac5c";
  map.shadowBlur = 10;
  map.fill();
  map.restore();
}
function updateHUD() {
  const road = sim.currentRoad?.road;
  $("street").textContent = road?.name || city.display?.district || city.name;
  $("speed").textContent = Math.round(sim.speedKph);
  $("gear").textContent = sim.speedKph < 1 ? "N" : sim.gear;
  $("rpm").style.width = `${Math.min(100, sim.rpm / 65)}%`;
  $("vehicle-name").textContent = sim.vehicle.profile?.name || "MERIDIAN GT";
  $("condition").textContent =
    `${Math.round(sim.vehicle.health * 100)}% CONDITION`;
  $("surface").textContent = sim.airborne
    ? "AIRBORNE"
    : sim.onRoad
      ? String(road?.surface || "asphalt")
          .replaceAll("_", " ")
          .toUpperCase()
      : "OFF ROAD";
  drawMap();
  if (job) {
    const p = sim.vehicle.body.position,
      d = Math.hypot(p.x - job.destination[0], p.z + job.destination[1]);
    $("mission-detail").textContent =
      `${job.road} · ${Math.round(d)} m away. Stop at the amber marker.`;
    if (d < 16 && sim.speedKph < 4) {
      completed++;
      job = null;
      $("mission-title").textContent = "Right on time.";
      $("mission-detail").textContent =
        `Delivery complete. ${completed} parcel${completed === 1 ? "" : "s"} delivered this drive.`;
      $("job").innerHTML = "Take another delivery <span>↗</span>";
      toast("Delivery complete. Nice driving.", 5000);
    }
  }
  if (sim.events?.length) {
    for (const event of sim.events.splice(0)) {
      if (event.type === "collision") {
        const hit = event.hitPosition;
        const near =
          hit &&
          Math.hypot(
            hit[0] - sim.vehicle.body.position.x,
            hit[2] - sim.vehicle.body.position.z,
          ) < 30;
        event.isPedestrian = sim.pedestrianBodies.some(
          (body) => body.id === event.otherId,
        );
        if (event.player || near) {
          effects.impact(event);
          vehicleAudio.impact({
            ...event,
            impact: event.impact * (event.player ? 1 : 0.3),
          });
        }
        if (event.player && event.damage > 0.03)
          toast("Impact damage. R recovers and repairs your car.");
      }
      if (event.type === "landed" && event.impact > 4)
        vehicleAudio.impact(event);
    }
  }
  if (toastUntil && performance.now() > toastUntil) {
    $("toast").classList.remove("visible");
    toastUntil = 0;
  }
}
let beacon;
function updateBeacon() {
  if (!beacon) {
    beacon = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6, 0.12, 5, 48),
      new THREE.MeshBasicMaterial({ color: "#ffc775" }),
    );
    ring.rotation.x = Math.PI / 2;
    beacon.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 16, 8),
      new THREE.MeshBasicMaterial({
        color: "#ffd38f",
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    pillar.position.y = 8;
    beacon.add(pillar);
    view.scene.add(beacon);
  }
  beacon.visible = !!job;
  if (job)
    beacon.position.set(
      job.destination[0],
      job.destination[2] + 0.25,
      -job.destination[1],
    );
}
function updateGameplayUI() {
  const wanted = session.wanted;
  document.body.classList.toggle("wanted", wanted);
  $("wanted").hidden = !wanted || session.busted;
  const search = pursuit.state === "search";
  $("wanted").classList.toggle("search", search);
  $("wanted-label").textContent = search ? "SEARCHING" : "WANTED";
  $("wanted-stars").textContent = "★".repeat(
    Math.max(1, Math.min(3, pursuit.severity || 1)),
  );
  const remaining = Math.max(0, 60 - (pursuit.unseenSeconds || 0));
  const capture = pursuit.captureProgress || 0;
  $("pursuit-title").textContent =
    capture > 0
      ? "Police are closing in"
      : search
        ? "Stay out of sight"
        : "Police are pursuing you";
  $("pursuit-detail").textContent =
    capture > 0
      ? "Drive away before you are arrested."
      : search
        ? `${Math.ceil(remaining)} seconds to lose the police.`
        : "Break their line of sight, then stay hidden for 60 seconds.";
  $("pursuit-progress").style.width =
    `${Math.min(100, (capture > 0 ? capture : search ? (60 - remaining) / 60 : 0) * 100)}%`;
  const candidate = session.candidate;
  $("theft").hidden = !candidate || session.busted;
  if (candidate)
    $("theft-label").textContent =
      `Hold to steal ${candidate.profile?.name || "car"} · ${Math.round(candidate.health * 100)}%`;
  $("theft-progress").style.width =
    `${Math.min(100, (session.theftSeconds / THEFT_RULES.holdSeconds) * 100)}%`;
  for (const event of session.events.splice(0)) {
    if (event.type === "incident")
      toast(
        event.outcome === "fatal"
          ? "Fatal collision reported. Police are responding."
          : "Pedestrian injured. Police are responding.",
        5500,
      );
    if (event.type === "stolen") {
      resetInput();
      toast(
        `${event.record.profile?.name || "Car"} stolen. Police have been alerted.`,
        4500,
      );
    }
    if (event.type === "escaped")
      toast("You lost the police. Keep a low profile.", 5000);
    if (event.type === "busted") {
      resetInput();
      $("busted").hidden = false;
      document.body.classList.add("busted");
      $("restart").focus();
    }
  }
}
function restartDrive() {
  if (!session?.busted) return;
  session.restart();
  resetInput();
  job = null;
  completed = 0;
  paused = false;
  photo = false;
  view.setPhoto(false);
  document.body.classList.remove("busted", "paused", "wanted", "photo");
  $("busted").hidden = true;
  $("photo-ui").hidden = true;
  $("mission-title").textContent = "Find your way through the hills.";
  $("mission-detail").textContent = "Free roam through the city.";
  $("job").innerHTML = "Start a delivery <span>↗</span>";
  toast("A fresh start. Drive carefully.", 4000);
}
$("restart").addEventListener("click", restartDrive);
$("steal").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  touch.steal = true;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  $("steal").addEventListener(type, () => {
    touch.steal = false;
  });

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (!sim || !view) return;
  frame++;
  if (playing && !paused && !photo && !session?.busted) {
    let forward = keys.has("KeyW") || keys.has("ArrowUp") || touch.throttle,
      back = keys.has("KeyS") || keys.has("ArrowDown") || touch.brake;
    const left = keys.has("KeyA") || keys.has("ArrowLeft") || touch.left,
      right = keys.has("KeyD") || keys.has("ArrowRight") || touch.right;
    sim.controls.steer = Number(!!right) - Number(!!left);
    sim.controls.throttle = forward
      ? 1
      : back && sim.signedSpeedKph < 1
        ? -0.65
        : 0;
    sim.controls.brake = back && sim.signedSpeedKph >= 1 ? 1 : 0;
    sim.controls.handbrake = keys.has("Space");
    sim.step(dt);
    session.update(dt, { stealHeld: keys.has("KeyE") || touch.steal });
  } else if (!playing && frame < 120) {
    sim.controls.brake = 1;
    sim.step(dt);
  }
  life?.update(paused || photo || session?.busted ? 0 : dt);
  effects?.update(sim, dt, paused || photo || session?.busted);
  view.update(sim, dt, playing);
  if (frame % 5 === 0) updateHUD();
  if (playing) updateGameplayUI();
  if (frame % 10 === 0) updateBeacon();
  vehicleAudio.update(
    sim,
    playing && !paused && !photo && !session?.busted,
    pursuit,
  );
}

async function boot() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/city.json`);
    if (!response.ok)
      throw new Error(`City data could not load (${response.status}).`);
    city = await response.json();
    const district = city.display?.district || city.name;
    document.querySelector(".brand small").textContent =
      city.name.toUpperCase();
    document.querySelector(".map-heading span").textContent =
      district.toUpperCase();
    document.querySelector(".district-tag").innerHTML = "";
    document.querySelector(".district-tag").textContent =
      `${Math.abs(city.origin.lat).toFixed(4)}° ${city.origin.lat >= 0 ? "N" : "S"} / ${Math.abs(city.origin.lon).toFixed(4)}° ${city.origin.lon >= 0 ? "E" : "W"}`;
    document.title = `City Wheels · ${city.name}`;
    document.querySelector(".start-card>p").textContent =
      `${city.display?.subtitle || city.name} Real streets. Real elevation. An open road.`;
    if (
      city.schemaVersion !== 1 ||
      !city.roads?.length ||
      city.terrain?.heights?.length !== city.terrain.width * city.terrain.height
    )
      throw new Error("City package is invalid.");
    $("play").textContent = "Preparing streets and traffic…";
    sim = new CitySimulation(city, {
      trafficCount: 40,
      policeCount: 4,
      parkedCount: 16,
    });
    const groundAt = sim.sampleElevation.bind(sim);
    const objects = createStreetLayout(city, groundAt);
    districtPlaces = createCityPlaces(city, groundAt, {
      streetObjects: objects,
    });
    sim.addObstacles([...objects, ...districtPlaces.obstacles]);
    const streetVisuals = createStreetVisuals(objects, { maxLights: 6 });
    const renderCity = {
      ...city,
      terrain: sim.terrainRenderData || {
        ...city.terrain,
        heights: sim.terrainHeights,
      },
    };
    view = new CityRenderer($("world"), renderCity, {
      sampleElevation: groundAt,
      streetVisuals,
    });
    $("play").textContent = "Loading detailed car…";
    await view.loadVehicles();
    const placesVisuals = createPlaceVisuals(districtPlaces.places);
    view.scene.add(placesVisuals);
    life = new AmbientLife(city, sim, view.scene, {
      objects: [...objects, ...districtPlaces.obstacles],
      count: 150,
      activitySpots: districtPlaces.activitySpots,
    });
    sim.pedestrianBodies = life.people.map((p) => p.body);
    pursuit = new PursuitSystem(sim, city);
    session = new DrivingSession(sim, life, pursuit);
    effects = new DrivingEffects(view.scene);
    view.effects = effects;
    const p = sim.vehicle.body.position;
    view.camera.position.set(p.x + 9, p.y + 5, p.z + 9);
    $("play").disabled = false;
    $("play").textContent = "Take the wheel →";
    requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    $("play").textContent = "Unable to start";
    $("error").hidden = false;
    $("error").textContent =
      `City Wheels could not start: ${error.message} Try a current Chrome, Edge, Firefox or Safari browser with hardware acceleration enabled.`;
  }
}
$("play").addEventListener("click", () => {
  playing = true;
  paused = false;
  sim.controls.brake = 0;
  setupAudio(true);
  document.body.classList.add("playing");
  $("start").hidden = true;
  $("start").style.display = "none";
  toast(
    "WASD to drive · Hold E near a slow car to steal it · C for camera",
    7000,
  );
});
$("help").addEventListener("click", () => {
  $("info").showModal();
  setPaused(true);
});
$("info")
  .querySelector(".close")
  .addEventListener("click", () => $("info").close());
$("info").addEventListener("close", () => setPaused(false));
$("info").addEventListener("click", (e) => {
  if (e.target === $("info")) $("info").close();
});
$("sound").addEventListener("click", () => setupAudio());
$("job").addEventListener("click", beginJob);
document
  .querySelectorAll("[data-weather]")
  .forEach((b) =>
    b.addEventListener("click", () => setWeather(b.dataset.weather)),
  );
$("photo").addEventListener("click", () => setPhoto(true));
$("exit-photo").addEventListener("click", () => setPhoto(false));
$("capture").addEventListener("click", () => {
  view.screenshot();
});
window.addEventListener("keydown", (e) => {
  if (session?.busted) {
    if (e.code === "Enter") restartDrive();
    return;
  }
  if (!playing || $("info").open) return;
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  )
    e.preventDefault();
  if (e.repeat) return;
  if (
    paused &&
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(e.code)
  )
    setPaused(false);
  keys.add(e.code);
  if (e.code === "KeyC") changeCamera();
  if (e.code === "KeyH") vehicleAudio.horn();
  if (e.code === "KeyR") {
    if (session?.wanted) {
      toast("Recovery is unavailable while the police are looking for you.");
      return;
    }
    sim.reset();
    toast("Back on the road. Car repaired.");
    if (paused) setPaused(false);
  }
  if (e.code === "KeyP") setPhoto(!photo);
  if (e.code === "Escape") {
    if (photo) setPhoto(false);
    else setPaused(!paused);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  resetInput();
  if (playing) {
    setPaused(true);
    toast(
      "Paused while the game is unfocused. Press W or click the road to resume.",
      8000,
    );
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetInput();
    if (playing) setPaused(true);
  }
});
document.querySelectorAll("[data-control]").forEach((b) => {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    if (paused && !$("info").open) setPaused(false);
    touch[b.dataset.control] = true;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    b.addEventListener(type, () => (touch[b.dataset.control] = false));
});
$("world").addEventListener("pointerdown", (e) => {
  if (paused && !$("info").open) {
    setPaused(false);
    return;
  }
  if (photo) {
    drag = { x: e.clientX, y: e.clientY };
    $("world").setPointerCapture(e.pointerId);
  }
});
$("world").addEventListener("pointermove", (e) => {
  if (photo && drag) {
    view.orbit.yaw -= (e.clientX - drag.x) * 0.007;
    view.orbit.pitch = Math.max(
      0.05,
      Math.min(1.4, view.orbit.pitch + (e.clientY - drag.y) * 0.007),
    );
    drag = { x: e.clientX, y: e.clientY };
  }
});
$("world").addEventListener("pointerup", () => (drag = null));
$("world").addEventListener(
  "wheel",
  (e) => {
    if (photo) {
      e.preventDefault();
      view.orbit.distance = Math.max(
        3,
        Math.min(45, view.orbit.distance + e.deltaY * 0.02),
      );
    }
  },
  { passive: false },
);
// Opt-in browser-native agent interface; game controls remain usable without WebMCP.
if (navigator.modelContext?.registerTool) {
  navigator.modelContext.registerTool({
    name: "city_wheels_set_weather",
    description: "Change City Wheels weather while driving.",
    inputSchema: {
      type: "object",
      properties: {
        weather: {
          type: "string",
          enum: ["golden", "day", "fog", "rain", "night"],
        },
      },
      required: ["weather"],
    },
    execute: ({ weather }) => {
      if (!view)
        return { content: [{ type: "text", text: "Game is loading." }] };
      setWeather(weather);
      return {
        content: [
          {
            type: "text",
            text: `Weather changed to ${weatherNames[weather]}.`,
          },
        ],
      };
    },
  });
}
boot();
