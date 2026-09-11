import * as THREE from "three";
import {
  loadCarAsset,
  createCarVisual,
  updateCarVisual,
} from "./car-visual.js";
import { Sky } from "three/addons/objects/Sky.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const UP = new THREE.Vector3(0, 1, 0);
const V = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
function seeded(n) {
  return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1) + 0.5;
}
export function terrainHeight(city, x, n) {
  const t = city.terrain,
    b = city.bounds,
    u = THREE.MathUtils.clamp(
      ((x - b.minX) / (b.maxX - b.minX)) * (t.width - 1),
      0,
      t.width - 1.0001,
    ),
    v = THREE.MathUtils.clamp(
      ((n - b.minY) / (b.maxY - b.minY)) * (t.height - 1),
      0,
      t.height - 1.0001,
    );
  const i = Math.floor(u),
    j = Math.floor(v),
    a = u - i,
    c = v - j,
    h = t.heights;
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(h[j * t.width + i], h[j * t.width + i + 1], a),
    THREE.MathUtils.lerp(
      h[(j + 1) * t.width + i],
      h[(j + 1) * t.width + i + 1],
      a,
    ),
    c,
  );
}
function grainTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d"),
    d = ctx.createImageData(256, 256);
  let s = 31;
  for (let i = 0; i < d.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    let v = 120 + (s % 55);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function facadeTexture(type) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = type === "glass" ? "#526a73" : "#deddd5";
  ctx.fillRect(0, 0, 256, 256);
  for (let floor = 0; floor < 4; floor++) {
    const y = floor * 64;
    ctx.fillStyle = type === "glass" ? "#334b54" : "#c6c3b9";
    ctx.fillRect(0, y + 59, 256, 5);
    for (let column = 0; column < 4; column++) {
      const x = column * 64;
      ctx.fillStyle = "#f4f1e4";
      ctx.fillRect(x + 14, y + 9, 35, 45);
      ctx.fillStyle = "#253d49";
      ctx.fillRect(x + 17, y + 12, 29, 38);
      ctx.fillStyle = "#739299";
      ctx.fillRect(x + 18, y + 13, 12, 17);
      ctx.fillStyle = "#a9aba1";
      ctx.fillRect(x + 31, y + 13, 2, 38);
      ctx.fillRect(x + 17, y + 31, 29, 2);
      ctx.fillStyle = "#fff9df";
      ctx.fillRect(x + 11, y + 54, 42, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function meshGeometry(pos, uv = []) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class CityRenderer {
  constructor(canvas, city, options = {}) {
    this.options = options;
    this.groundAt =
      options.sampleElevation || ((x, n) => terrainHeight(city, x, n));
    this.city = city;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3500);
    this.clock = 0;
    this.mode = 0;
    this.photo = false;
    this.orbit = { yaw: 0.5, pitch: 0.3, distance: 11 };
    this.materials = {};
    this.lightPosts = [];
    this.carVisuals = new Map();
    this.target = new THREE.Vector3();
    this.sun = new THREE.DirectionalLight("#ffe1af", 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -100,
      right: 100,
      top: 100,
      bottom: -100,
      near: 1,
      far: 800,
    });
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.bias = -0.0001;
    this.scene.add(this.sun, this.sun.target);
    this.ambient = new THREE.HemisphereLight("#c4dbf2", "#6b7460", 2);
    this.scene.add(this.ambient);
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.scene.add(this.sky);
    this.sky.material.uniforms.turbidity.value = 4;
    this.sky.material.uniforms.rayleigh.value = 1.5;
    this.sky.material.uniforms.mieCoefficient.value = 0.006;
    this.sky.material.uniforms.mieDirectionalG.value = 0.85;
    this.createWorld();
    this.createRain();
    this.setWeather("golden");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  resize() {
    const w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  createWorld() {
    const city = this.city,
      t = city.terrain,
      b = city.bounds,
      grain = grainTexture();
    this.materials.ground = new THREE.MeshStandardMaterial({
      color: "#76816b",
      roughness: 1,
      map: grain,
    });
    this.materials.road = new THREE.MeshStandardMaterial({
      color: "#666a70",
      roughness: 0.92,
      map: grain,
    });
    this.materials.sidewalk = new THREE.MeshStandardMaterial({
      color: "#b7b3a5",
      roughness: 0.95,
      map: grain,
    });
    this.materials.line = new THREE.MeshStandardMaterial({
      color: "#e6d4a3",
      roughness: 0.8,
    });
    this.materials.white = new THREE.MeshStandardMaterial({
      color: "#eee5d2",
      roughness: 0.7,
    });
    this.materials.roof = new THREE.MeshStandardMaterial({
      color: "#7b807b",
      roughness: 0.9,
    });
    // Same cell diagonal as Cannon: SW/SE/NW then SE/NE/NW.
    const gridPositions = new Float32Array(t.width * t.height * 3),
      gridUV = new Float32Array(t.width * t.height * 2),
      gridIndices = [];
    for (let row = 0; row < t.height; row++)
      for (let col = 0; col < t.width; col++) {
        const i = row * t.width + col,
          x = b.minX + col * t.cellSize,
          n = b.minY + row * t.cellSize;
        gridPositions.set([x, t.heights[i], -n], i * 3);
        gridUV.set([x / 3, n / 3], i * 2);
        if (row < t.height - 1 && col < t.width - 1) {
          gridIndices.push(
            i,
            i + 1,
            i + t.width,
            i + 1,
            i + t.width + 1,
            i + t.width,
          );
        }
      }
    const terrain = new THREE.BufferGeometry();
    terrain.setAttribute(
      "position",
      new THREE.BufferAttribute(gridPositions, 3),
    );
    terrain.setAttribute("uv", new THREE.BufferAttribute(gridUV, 2));
    terrain.setIndex(gridIndices);
    terrain.computeVertexNormals();
    const ground = new THREE.Mesh(terrain, this.materials.ground);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const roadPositions = [],
      brickPositions = [],
      sidewalkPositions = [],
      linePositions = [],
      whitePositions = [];
    const ribbon = (a, b, width, out, lift = 0) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = Math.hypot(dx, dy);
      if (d < 0.05) return;
      const nx = ((-dy / d) * width) / 2,
        ny = ((dx / d) * width) / 2;
      const v = [
        [a[0] + nx, a[2] + lift, -a[1] - ny],
        [a[0] - nx, a[2] + lift, -a[1] + ny],
        [b[0] + nx, b[2] + lift, -b[1] - ny],
        [b[0] - nx, b[2] + lift, -b[1] + ny],
      ];
      for (const p of v) p[1] = this.groundAt(p[0], -p[2]) + lift;
      for (const i of [0, 1, 2, 1, 3, 2]) out.push(...v[i]);
    };
    const roadEnds = new Map();
    for (const road of city.roads) {
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i],
          c = road.points[i + 1];
        ribbon(a, c, road.width + 2.8, sidewalkPositions, 0.018);
        ribbon(
          a,
          c,
          road.width,
          ["bricks", "brick", "paving_stones", "cobblestone"].includes(
            road.surface,
          )
            ? brickPositions
            : roadPositions,
          0.025,
        );
        if (road.width >= 6 && !road.oneway) {
          ribbon(a, c, 0.13, linePositions, 0.033);
        } else if (road.width > 6 && i % 3 === 0) {
          const mid = a.map((v, j) => (v + c[j]) / 2);
          ribbon(a, mid, 0.12, whitePositions, 0.033);
        }
      }
      for (const p of [road.points[0], road.points.at(-1)]) {
        const key = `${Math.round(p[0])},${Math.round(p[1])}`;
        let e = roadEnds.get(key);
        if (!e) roadEnds.set(key, { p, w: road.width, count: 1 });
        else {
          e.count++;
          e.w = Math.max(e.w, road.width);
        }
      }
    }
    const add = (arr, mat, repeat) => {
      if (!arr.length) return;
      const uv = [];
      for (let i = 0; i < arr.length; i += 3)
        uv.push(arr[i] / repeat, arr[i + 2] / repeat);
      const m = new THREE.Mesh(meshGeometry(arr, uv), mat);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(sidewalkPositions, this.materials.sidewalk, 3);
    add(roadPositions, this.materials.road, 4);
    add(
      brickPositions,
      new THREE.MeshStandardMaterial({
        color: "#ac6c53",
        roughness: 0.85,
        map: grain,
      }),
      0.4,
    );
    add(linePositions, this.materials.line, 1);
    add(whitePositions, this.materials.white, 1);
    // Junction disks close ribbon joins; painted crossings are restricted to actual junctions.
    const junctions = [];
    for (const e of roadEnds.values()) {
      if (e.count < 2) continue;
      const r = e.w / 2;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2,
          c = ((k + 1) / 16) * Math.PI * 2;
        junctions.push(
          e.p[0],
          e.p[2] + 0.105,
          -e.p[1],
          e.p[0] + Math.sin(a) * r,
          e.p[2] + 0.105,
          -e.p[1] + Math.cos(a) * r,
          e.p[0] + Math.sin(c) * r,
          e.p[2] + 0.105,
          -e.p[1] + Math.cos(c) * r,
        );
      }
    }
    for (let i = 0; i < junctions.length; i += 3)
      junctions[i + 1] = this.groundAt(junctions[i], -junctions[i + 2]) + 0.028;
    add(junctions, this.materials.road, 4);
    const railPos = [];
    for (const rail of city.railways || []) {
      const gauge = (parseFloat(rail.tags?.gauge) || 1067) / 1000;
      for (let i = 1; i < rail.points.length; i++) {
        const a = rail.points[i - 1],
          c = rail.points[i],
          dx = c[0] - a[0],
          dy = c[1] - a[1],
          d = Math.hypot(dx, dy);
        if (d < 0.01) continue;
        for (const side of [-1, 1]) {
          const nx = (((-dy / d) * gauge) / 2) * side,
            ny = (((dx / d) * gauge) / 2) * side;
          ribbon(
            [a[0] + nx, a[1] + ny, a[2]],
            [c[0] + nx, c[1] + ny, c[2]],
            0.085,
            railPos,
            0.038,
          );
        }
      }
    }
    add(
      railPos,
      new THREE.MeshStandardMaterial({
        color: "#7c898e",
        metalness: 0.9,
        roughness: 0.24,
      }),
      1,
    );
    this.createBuildings();
    if (this.options.streetVisuals) {
      const props = this.options.streetVisuals;
      this.scene.add(props.group);
      this.streetVisuals = props;
      this.lightPosts = (props.lampPositions || []).map((p) => p.position);
      this.lampMat = new THREE.MeshStandardMaterial({ emissive: "#ffca81" });
      this.nearLights = [];
    } else this.createStreetFurniture();
    this.createBoundary();
  }
  createBuildings() {
    const facade = facadeTexture("house"),
      palette = [
        "#d9cec2",
        "#adb9b2",
        "#d9c7ad",
        "#c9d4d5",
        "#c5b5a5",
        "#e0d5b7",
        "#b5bbc4",
        "#bbcec3",
        "#dac4b1",
      ];
    const buckets = palette.map(() => ({ wall: [], uv: [], roof: [] }));
    const roofPos = [];
    for (let bi = 0; bi < this.city.buildings.length; bi++) {
      const b = this.city.buildings[bi];
      let p = b.footprint;
      if (p.length < 3) continue;
      if (Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) < 0.01)
        p = p.slice(0, -1);
      const bucket = buckets[bi % palette.length];
      let bottom = Math.min(...p.map((v) => v[2])) - 0.5,
        top = Math.max(...p.map((v) => v[2])) + b.height;
      const contour = p.map((v) => new THREE.Vector2(v[0], -v[1]));
      const holes = (b.footprintHoles || []).map((h) =>
        h.map((v) => new THREE.Vector2(v[0], -v[1])),
      );
      const triangles = THREE.ShapeUtils.triangulateShape(contour, holes),
        all = [...contour, ...holes.flat()];
      for (const tr of triangles) {
        for (const ix of [tr[0], tr[2], tr[1]])
          roofPos.push(all[ix].x, top, all[ix].y);
      }
      for (const ring of [p, ...(b.footprintHoles || [])]) {
        for (let j = 0; j < ring.length; j++) {
          const a = ring[j],
            c = ring[(j + 1) % ring.length],
            len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (len < 0.1) continue;
          const verts = [
              [a[0], bottom, -a[1]],
              [c[0], bottom, -c[1]],
              [a[0], top, -a[1]],
              [c[0], top, -c[1]],
            ],
            uv = [
              [0, 0],
              [len / 16, 0],
              [0, (top - bottom) / 13],
              [len / 16, (top - bottom) / 13],
            ];
          for (const k of [0, 1, 2, 1, 3, 2]) {
            bucket.wall.push(...verts[k]);
            bucket.uv.push(...uv[k]);
          }
        }
      }
    }
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b.wall.length) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: palette[i],
        map: facade,
        roughness: 0.83,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(meshGeometry(b.wall, b.uv), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
    const roof = new THREE.Mesh(meshGeometry(roofPos), this.materials.roof);
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.material.side = THREE.DoubleSide;
    this.scene.add(roof);
  }
  createStreetFurniture() {
    const poles = [],
      lights = [],
      treeTrunks = [],
      treeCrowns = [];
    const pmat = new THREE.MeshStandardMaterial({
      color: "#35484c",
      metalness: 0.6,
      roughness: 0.5,
    });
    let count = 0;
    for (const r of this.city.roads) {
      let distance = 0;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1],
          b = r.points[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          d = Math.hypot(dx, dy);
        distance += d;
        if (distance < 40 || d < 0.01) continue;
        distance = 0;
        const side = count++ % 2 ? 1 : -1,
          off = r.width / 2 + 1.25,
          x = b[0] - (dy / d) * off * side,
          z = -b[1] - (dx / d) * off * side,
          y = terrainHeight(this.city, x, -z);
        const pg = new THREE.CylinderGeometry(0.065, 0.11, 7.5, 6);
        pg.translate(x, y + 3.75, z);
        poles.push(pg);
        const arm = new THREE.BoxGeometry(1.9, 0.08, 0.08);
        arm.translate(x + 0.7, y + 7.4, z);
        poles.push(arm);
        const lg = new THREE.BoxGeometry(0.65, 0.12, 0.28);
        lg.translate(x + 1.5, y + 7.35, z);
        lights.push(lg);
        this.lightPosts.push(new THREE.Vector3(x + 1.5, y + 7.1, z));
        if (count % 3 === 0) {
          const tg = new THREE.CylinderGeometry(0.11, 0.18, 3.5, 5);
          tg.translate(x + 3, y + 1.75, z);
          treeTrunks.push(tg);
          const cg = new THREE.IcosahedronGeometry(1.5, 1);
          cg.scale(1, 1.5, 1);
          cg.translate(x + 3, y + 4.3, z);
          treeCrowns.push(cg);
        }
      }
    }
    const combine = (gs, mat, cast = true) => {
      if (gs.length) {
        const g = mergeGeometries(gs),
          m = new THREE.Mesh(g, mat);
        m.castShadow = cast;
        m.receiveShadow = true;
        this.scene.add(m);
        gs.forEach((g) => g.dispose());
        return m;
      }
    };
    combine(poles, pmat);
    this.lampMat = new THREE.MeshStandardMaterial({
      color: "#fff0cc",
      emissive: "#ffcd8f",
      emissiveIntensity: 0,
    });
    combine(lights, this.lampMat, false);
    combine(treeTrunks, new THREE.MeshStandardMaterial({ color: "#766551" }));
    combine(
      treeCrowns,
      new THREE.MeshStandardMaterial({ color: "#536c4b", roughness: 1 }),
    );
    this.nearLights = [];
    for (let i = 0; i < 5; i++) {
      const light = new THREE.PointLight("#ffd39c", 0, 19, 2);
      this.scene.add(light);
      this.nearLights.push(light);
    }
  }
  createBoundary() {
    const b = this.city.bounds,
      p = [];
    for (const [[ax, an], [bx, bn]] of [
      [
        [b.minX, b.minY],
        [b.maxX, b.minY],
      ],
      [
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
      ],
      [
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ],
      [
        [b.minX, b.maxY],
        [b.minX, b.minY],
      ],
    ])
      for (let t = 0; t < 1; t += 0.01) {
        const x = THREE.MathUtils.lerp(ax, bx, t),
          n = THREE.MathUtils.lerp(an, bn, t);
        p.push(x, terrainHeight(this.city, x, n) + 1, -n);
      }
    this.boundary = new THREE.Points(
      meshGeometry(p),
      new THREE.PointsMaterial({
        color: "#ffd39f",
        size: 0.3,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.scene.add(this.boundary);
  }
  createRain() {
    const positions = new Float32Array(1800 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (Math.random() - 0.5) * 100;
      positions[i + 1] = Math.random() * 80;
      positions[i + 2] = (Math.random() - 0.5) * 100;
    }
    this.rain = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      ),
      new THREE.PointsMaterial({
        color: "#b9d4e2",
        size: 0.07,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.rain.visible = false;
    this.scene.add(this.rain);
  }
  async loadVehicles() {
    await loadCarAsset({
      url: `${import.meta.env.BASE_URL}assets/car/model.glb`,
    });
  }
  createCar(color, player) {
    const visual = createCarVisual(color, player);
    this.scene.add(visual.root, ...visual.wheels);
    return visual;
  }
  setWeather(mode) {
    this.weather = mode;
    const cfg = {
      golden: {
        sun: 3.2,
        ambient: 1.0,
        color: "#eed6b5",
        fog: 0.0011,
        elevation: 9,
        azimuth: 240,
        exposure: 1,
      },
      day: {
        sun: 3.5,
        ambient: 1.2,
        color: "#c8ddea",
        fog: 0.0009,
        elevation: 48,
        azimuth: 210,
        exposure: 1,
      },
      fog: {
        sun: 0.5,
        ambient: 1.25,
        color: "#b0bdc0",
        fog: 0.0075,
        elevation: 18,
        azimuth: 250,
        exposure: 1,
      },
      rain: {
        sun: 0.45,
        ambient: 0.95,
        color: "#7d929f",
        fog: 0.0045,
        elevation: 16,
        azimuth: 220,
        exposure: 1,
      },
      night: {
        sun: 0.03,
        ambient: 0.28,
        color: "#0c1828",
        fog: 0.002,
        elevation: -8,
        azimuth: 260,
        exposure: 1.25,
      },
    }[mode];
    this.cfg = cfg;
    this.scene.fog = new THREE.FogExp2(cfg.color, cfg.fog);
    this.sun.intensity = cfg.sun;
    this.ambient.intensity = cfg.ambient;
    this.renderer.toneMappingExposure = cfg.exposure;
    const direction = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - cfg.elevation),
      THREE.MathUtils.degToRad(cfg.azimuth),
    );
    this.sky.material.uniforms.sunPosition.value.copy(direction);
    this.sunDirection = direction;
    this.sky.visible = mode === "golden" || mode === "day";
    this.scene.background = new THREE.Color(cfg.color);
    const captureScene = new THREE.Scene();
    captureScene.background = new THREE.Color(cfg.color);
    const skyCopy = this.sky.clone();
    skyCopy.visible = this.sky.visible;
    captureScene.add(skyCopy);
    captureScene.add(new THREE.HemisphereLight(cfg.color, "#535447", 1));
    const generator = new THREE.PMREMGenerator(this.renderer);
    const environment = generator.fromScene(captureScene, 0.06, 0.1, 500000);
    this.skyEnvironment?.dispose();
    this.skyEnvironment = environment;
    this.scene.environment = environment.texture;
    generator.dispose();
    this.rain.visible = mode === "rain";
    this.materials.road.roughness = mode === "rain" ? 0.16 : 0.9;
    this.materials.road.color.set(mode === "rain" ? "#303e48" : "#666a70");
    this.lampMat.emissiveIntensity =
      mode === "night" ? 5 : mode === "rain" || mode === "fog" ? 1 : 0.05;
  }
  setPhoto(on) {
    this.photo = on;
    this.orbit.yaw = 0.7;
    this.orbit.pitch = 0.3;
    this.orbit.distance = 11;
  }
  update(sim, dt, playing) {
    this.clock += dt;
    const car = sim.vehicle,
      body = car.body;
    for (const record of [car, ...sim.traffic]) {
      let visual = this.carVisuals.get(record);
      if (!visual) {
        visual = this.createCar(
          record === car
            ? "#bc8050"
            : ["#b4c4ce", "#704e46", "#a4ad9c"][this.carVisuals.size % 3],
          record === car,
        );
        this.carVisuals.set(record, visual);
      }
      updateCarVisual(visual, record, {
        dt,
        weather: this.weather,
        cockpit: record === car && this.mode === 1 && !this.photo,
        controls: record === car ? sim.controls : record.controls,
      });
      const visible =
        record === car ||
        record.body.position.distanceTo(car.body.position) < 285;
      visual.root.visible = visible;
      visual.wheels.forEach((wheel) => (wheel.visible = visible));
    }
    const bp = new THREE.Vector3().copy(body.position),
      q = new THREE.Quaternion().copy(body.quaternion);
    const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    heading.y = 0;
    heading.normalize();
    const yaw = Math.atan2(-heading.x, -heading.z);
    let desired, look;
    if (this.photo || !playing) {
      const o = this.orbit;
      if (!playing) o.yaw = this.clock * 0.045 + 0.4;
      desired = bp
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(o.yaw) * Math.cos(o.pitch) * o.distance,
            Math.sin(o.pitch) * o.distance + 1.1,
            Math.cos(o.yaw) * Math.cos(o.pitch) * o.distance,
          ),
        );
      look = bp.clone().addScaledVector(UP, 0.5);
    } else if (this.mode === 1) {
      desired = bp
        .clone()
        .add(new THREE.Vector3(0, 0.23, -0.58).applyQuaternion(q));
      look = bp.clone().add(new THREE.Vector3(0, 0.1, -8).applyQuaternion(q));
    } else if (this.mode === 2) {
      desired = bp
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(this.clock * 0.12) * 14,
            6,
            Math.cos(this.clock * 0.12) * 14,
          ),
        );
      look = bp.clone().addScaledVector(UP, 0.6);
    } else {
      desired = bp
        .clone()
        .addScaledVector(heading, -8.5 - Math.min(sim.speedKph / 80, 2))
        .addScaledVector(UP, 3.5);
      look = bp.clone().addScaledVector(heading, 6).addScaledVector(UP, 0.7);
    }
    desired.y = Math.max(desired.y, this.groundAt(desired.x, -desired.z) + 0.7);
    if (this.mode === 1 && !this.photo) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
    if (playing && !this.photo && this.effects)
      this.camera.position.add(this.effects.offset());
    this.camera.lookAt(look);
    this.camera.fov =
      this.mode === 1
        ? 75
        : this.photo
          ? 45
          : 55 + Math.min(sim.speedKph / 20, 8);
    this.camera.updateProjectionMatrix();
    this.sun.position.copy(bp).addScaledVector(this.sunDirection, 300);
    this.sun.target.position.copy(bp);
    this.sun.target.updateMatrixWorld();
    this.streetVisuals?.updateLights(
      this.weather === "night"
        ? 1
        : this.weather === "rain" || this.weather === "fog"
          ? 0.3
          : 0,
      bp,
    );
    if (this.weather === "night" || this.weather === "rain") {
      const closest = [...this.lightPosts].sort(
        (a, b) => a.distanceToSquared(bp) - b.distanceToSquared(bp),
      );
      for (let i = 0; i < this.nearLights.length; i++) {
        if (closest[i]) this.nearLights[i].position.copy(closest[i]);
        this.nearLights[i].intensity = this.weather === "night" ? 18 : 5;
      }
    } else this.nearLights.forEach((l) => (l.intensity = 0));
    if (this.rain.visible) {
      this.rain.position.copy(bp);
      const p = this.rain.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setY(i, (p.getY(i) - dt * 32 + 80) % 80);
        p.setX(i, ((p.getX(i) - dt * 3 + 150) % 100) - 50);
      }
      p.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    const a = document.createElement("a");
    a.download = `city-wheels-${this.weather}.png`;
    a.href = this.renderer.domElement.toDataURL("image/png");
    a.click();
  }
}
