import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

// Detailed CarConcept: Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0.
// Preserve ATTRIBUTION.md and CC-BY-4.0.txt beside the distributed model.
let template = null;
let loading = null;
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const wheelNames = ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"];
const wheelPositions = [
  [-0.79, -0.235, -1.37],
  [0.79, -0.235, -1.37],
  [-0.79, -0.235, 1.31],
  [0.79, -0.235, 1.31],
];
const tmpV = new THREE.Vector3(),
  tmpQ = new THREE.Quaternion();
const attr = ["position", "normal", "uv", "uv1"];

/** Await before enabling Play. Self-contained GLB; no Draco, remote textures, or decoder. */
export async function loadCarAsset(options = {}) {
  if (template) return template;
  if (options.scene) return prepareCarAsset(options.scene);
  if (!loading) {
    const loader = new GLTFLoader();
    loading = loader
      .loadAsync(
        options.url ??
          `${import.meta.env?.BASE_URL ?? "/"}assets/car/model.glb`,
        options.onProgress,
      )
      .then((gltf) => prepareCarAsset(gltf.scene))
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}
export function isCarAssetReady() {
  return template !== null;
}

/** Bake the source node transforms once; car-local axes become +X right,+Y up,-Z forward. */
export function prepareCarAsset(scene) {
  scene.updateMatrixWorld(true);
  const front = scene
    .getObjectByName("WheelFrontL")
    .getWorldPosition(new THREE.Vector3());
  const rear = scene
    .getObjectByName("WheelRearL")
    .getWorldPosition(new THREE.Vector3());
  const frontR = scene
    .getObjectByName("WheelFrontR")
    .getWorldPosition(new THREE.Vector3());
  const rotation = new THREE.Matrix4().makeRotationY(Math.PI);
  front.applyMatrix4(rotation);
  rear.applyMatrix4(rotation);
  frontR.applyMatrix4(rotation);
  const sx = 1.58 / Math.abs(frontR.x - front.x);
  const sz = 2.68 / Math.abs(rear.z - front.z);
  const sy = 0.875; // Source tires ~0.383 m radius -> 0.335 m. Vertical units are metres.
  const offset = new THREE.Vector3(
    -(front.x + frontR.x) * 0.5 * sx,
    -0.235 - front.y * sy,
    -1.37 - front.z * sz,
  );
  const normalizer = new THREE.Matrix4()
    .makeTranslation(...offset.toArray())
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .multiply(rotation);
  const buckets = new Map();
  const steeringMeshes = [];
  const glass = [];
  const wheelPivots = wheelNames.map((name) => scene.getObjectByName(name));
  const originalWheelCenters = wheelPivots.map((p) =>
    p.getWorldPosition(new THREE.Vector3()).applyMatrix4(rotation),
  );
  const inverseSteer = wheelPivots.map((p) => {
    const axis = new THREE.Vector3()
      .setFromMatrixColumn(p.matrixWorld, 0)
      .transformDirection(rotation);
    const sign = Math.sign(axis.x) || 1;
    return new THREE.Matrix4().makeRotationY(
      Math.atan2(axis.z * sign, axis.x * sign),
    );
  });
  scene.traverse((node) => {
    if (
      !node.isMesh ||
      node.name === "License_Plate" ||
      node.name === "License Plate" ||
      node.name === "InteriorSteeringEmblem"
    )
      return;
    let ancestor = node,
      wheelIndex = -1;
    while (ancestor) {
      wheelIndex = wheelNames.indexOf(ancestor.name);
      if (wheelIndex >= 0) break;
      ancestor = ancestor.parent;
    }
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(
      (wheelIndex >= 0 ? rotation : normalizer)
        .clone()
        .multiply(node.matrixWorld),
    );
    let category = "body";
    if (wheelIndex >= 0) {
      geometry.translate(
        ...originalWheelCenters[wheelIndex].clone().negate().toArray(),
      );
      geometry.applyMatrix4(inverseSteer[wheelIndex]);
      geometry.scale(0.875, 0.875, 0.875);
      category = `wheel${wheelIndex}`;
    } else if (
      /InteriorSteering(Wheel|Dash|Handle|Cylinder|Emblem)/.test(node.name)
    )
      category = "steering";
    else if (node.name === "BodyRoofPanel") category = "cabin";
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    // Sample nodes use one material per primitive. Preserve all material maps and PBR properties.
    const source = mats[0];
    const deform =
      wheelIndex < 0 &&
      /^Body/.test(node.name) &&
      !/Windshield|Window|Pillar|Roof/.test(node.name);
    for (const key of Object.keys(geometry.attributes))
      if (!attr.includes(key)) geometry.deleteAttribute(key);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv)
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 2),
          2,
        ),
      );
    if (!geometry.attributes.uv1)
      geometry.setAttribute("uv1", geometry.attributes.uv.clone());
    const key = `${category}|${source.uuid}|${deform ? 1 : 0}`;
    if (!buckets.has(key))
      buckets.set(key, { category, source, deform, geometries: [], names: [] });
    buckets.get(key).geometries.push(geometry);
    buckets.get(key).names.push(node.name);
    if (node.name === "BodyWindshield") glass.push(geometry.clone());
  });
  const groups = [];
  for (const bucket of buckets.values()) {
    const geometry =
      bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);
    if (!geometry)
      throw new Error(`Cannot merge car material ${bucket.source.name}`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    groups.push({ ...bucket, geometry, geometries: undefined });
  }
  const windshield = glass.length ? mergeGeometries(glass, false) : null;
  template = {
    groups,
    windshield,
    source: "Khronos CarConcept",
    triangleCount: groups.reduce(
      (n, g) =>
        n +
        (g.geometry.index?.count ?? g.geometry.attributes.position.count) / 3,
      0,
    ),
  };
  return template;
}

function lineTexture(cracks = false) {
  const side = 256,
    data = new Uint8Array(side * side * 4);
  let seed = cracks ? 7129 : 299;
  const random = () =>
    (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  function line(x0, y0, x1, y1, opacity, width = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let j = 0; j <= steps; j++) {
      const x = Math.round(x0 + ((x1 - x0) * j) / steps),
        y = Math.round(y0 + ((y1 - y0) * j) / steps);
      for (let dx = 0; dx < width; dx++) {
        if (x + dx < 0 || x + dx >= side || y < 0 || y >= side) continue;
        const i = (y * side + x + dx) * 4;
        data[i] = cracks ? 225 : 167;
        data[i + 1] = cracks ? 239 : 170;
        data[i + 2] = cracks ? 243 : 173;
        data[i + 3] = opacity;
      }
    }
  }
  if (cracks) {
    const cx = 97,
      cy = 147;
    for (let ray = 0; ray < 17; ray++) {
      let x = cx,
        y = cy,
        angle = (ray / 17) * Math.PI * 2;
      for (let j = 0; j < 7; j++) {
        const a = angle + (random() - 0.5) * 0.55,
          length = 13 + random() * 15;
        const nx = x + Math.cos(a) * length,
          ny = y + Math.sin(a) * length;
        line(x, y, nx, ny, 110 + Math.floor(random() * 120));
        if (j > 1 && random() > 0.5)
          line(
            nx,
            ny,
            nx + Math.cos(a + 0.6) * 21,
            ny + Math.sin(a + 0.6) * 21,
            100,
          );
        x = nx;
        y = ny;
      }
    }
    for (let i = 0; i < 30; i++) {
      const r = 17 + random() * 80,
        a = random() * Math.PI * 2;
      line(
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
        cx + Math.cos(a + 0.22) * r,
        cy + Math.sin(a + 0.22) * r,
        100,
      );
    }
  } else {
    for (let i = 0; i < 23; i++) {
      const x = 25 + random() * 155,
        y = 68 + random() * 105;
      line(
        x,
        y,
        x + 12 + random() * 48,
        y - 7 + random() * 12,
        100 + Math.floor(random() * 95),
        1,
      );
    }
  }
  const texture = new THREE.DataTexture(data, side, side, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
let scratchesTexture, cracksTexture;

// Preserve the real body silhouette in distant traffic with a shared vertex
// clustering LOD. Near cars and the player's interior always use source detail.
function trafficGeometry(source) {
  const p = source.attributes.position,
    bins = new Map(),
    remap = new Uint32Array(p.count),
    vertices = [],
    uvs = [];
  const uv = source.attributes.uv,
    step = 0.055;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const key = `${Math.round(x / step)},${Math.round(y / step)},${Math.round(z / step)}`;
    let b = bins.get(key);
    if (!b) {
      b = { index: bins.size, x: 0, y: 0, z: 0, u: 0, v: 0, n: 0 };
      bins.set(key, b);
    }
    b.x += x;
    b.y += y;
    b.z += z;
    b.u += uv?.getX(i) || 0;
    b.v += uv?.getY(i) || 0;
    b.n++;
    remap[i] = b.index;
  }
  for (const b of bins.values()) {
    vertices.push(b.x / b.n, b.y / b.n, b.z / b.n);
    uvs.push(b.u / b.n, b.v / b.n);
  }
  const indices = [],
    index = source.index,
    count = index?.count ?? p.count;
  for (let i = 0; i < count; i += 3) {
    const a = remap[index ? index.getX(i) : i],
      b = remap[index ? index.getX(i + 1) : i + 1],
      c = remap[index ? index.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", geometry.attributes.uv.clone());
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Returned wheels are WORLD-space siblings: add root and ...wheels to your scene. */
export function createCarVisual(
  color = "#ae4228",
  player = true,
  options = {},
) {
  if (!template)
    throw new Error("Await loadCarAsset() before creating the detailed car.");
  const root = new THREE.Group();
  root.name = "City Wheels / detailed car";
  const cabin = new THREE.Group();
  root.add(cabin);
  const steering = new THREE.Group();
  root.add(steering);
  const wheels = wheelNames.map((name) => {
    const wheel = new THREE.Group();
    wheel.name = name;
    return wheel;
  });
  const materials = new Map(),
    bodyMeshes = [],
    deformMeshes = [],
    paintMaterials = [];
  const brakeMaterials = [],
    headMaterials = [];
  let windshieldMesh;
  for (const item of template.groups) {
    if (
      !player &&
      item.names.every((name) => /^Interior|^Engine$|^Axles$/.test(name))
    )
      continue;
    let material = materials.get(item.source.uuid);
    if (!material) {
      material = item.source.clone();
      materials.set(item.source.uuid, material);
      if (/^Paint/.test(material.name)) {
        material.color.set(color);
        material.metalness = 0.72;
        material.roughness = 0.24;
        if ("clearcoat" in material) {
          material.clearcoat = 1;
          material.clearcoatRoughness = 0.075;
        }
        paintMaterials.push(material);
      }
      if (/Glass/.test(material.name)) {
        material.transparent = true;
        material.opacity = 0.48;
        material.transmission = player ? 0.68 : 0;
        material.roughness = 0.07;
        material.depthWrite = false;
      }
      if (/Brakelight/.test(material.name)) brakeMaterials.push(material);
      if (/Headlight/.test(material.name)) headMaterials.push(material);
      if (!player && material.transmission) material.transmission = 0;
    }
    const geometry =
      options.detail === "medium" && !player
        ? (item.trafficGeometry ??= trafficGeometry(item.geometry))
        : item.geometry;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = item.names.join("+");
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (item.category.startsWith("wheel"))
      wheels[Number(item.category.slice(5))].add(mesh);
    else if (item.category === "cabin") cabin.add(mesh);
    else if (item.category === "steering") steering.add(mesh);
    else root.add(mesh);
    if (item.deform)
      deformMeshes.push({
        mesh,
        original: geometry.attributes.position.array,
        unique: false,
      });
    if (item.category === "body" && /^Paint/.test(material.name))
      bodyMeshes.push(mesh);
  }
  const steeringCenter = new THREE.Box3()
    .setFromObject(steering)
    .getCenter(new THREE.Vector3());
  for (const mesh of steering.children) {
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.translate(
      -steeringCenter.x,
      -steeringCenter.y,
      -steeringCenter.z,
    );
  }
  steering.position.copy(steeringCenter);
  if (template.windshield && player) {
    const geometry = template.windshield.clone();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox,
      p = geometry.attributes.position,
      n = geometry.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) - bounds.min.x) / (bounds.max.x - bounds.min.x);
      uv[i * 2 + 1] =
        (p.getY(i) - bounds.min.y) /
        Math.max(0.01, bounds.max.y - bounds.min.y);
      p.setXYZ(
        i,
        p.getX(i) + n.getX(i) * 0.004,
        p.getY(i) + n.getY(i) * 0.004,
        p.getZ(i) + n.getZ(i) * 0.004,
      );
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    cracksTexture ??= lineTexture(true);
    windshieldMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: cracksTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    windshieldMesh.renderOrder = 4;
    root.add(windshieldMesh);
  }
  const lamps = [];
  if (player)
    for (const x of [-0.65, 0.65]) {
      const light = new THREE.SpotLight("#fff3df", 0, 70, 0.42, 0.6, 1.5);
      light.position.set(x, 0.03, -1.92);
      light.target.position.set(x, -0.35, -40);
      root.add(light, light.target);
      lamps.push(light);
    }
  const visual = {
    root,
    group: root,
    wheels,
    cabin,
    steering,
    lamps,
    paint: paintMaterials[0],
    paintMaterials,
    taillight: brakeMaterials[0],
    brakeMaterials,
    headMaterials,
    bodyMeshes,
    deformMeshes,
    windshieldMesh,
    damage: { front: 0, rear: 0, left: 0, right: 0 },
    decals: [],
    player,
  };
  visual.detail = options.detail || "full";
  visual.dispose = () => {
    root.removeFromParent();
    wheels.forEach((w) => w.removeFromParent());
    for (const m of materials.values()) m.dispose();
    for (const mesh of steering.children) mesh.geometry.dispose();
    if (windshieldMesh) {
      windshieldMesh.geometry.dispose();
      windshieldMesh.material.dispose();
    }
    deformMeshes.forEach((d) => {
      if (d.unique) d.mesh.geometry.dispose();
    });
    visual.decals.forEach((d) => {
      d.geometry.dispose();
      d.material.dispose();
    });
  };
  return visual;
}

export function applyCarDamage(visual, damage = {}) {
  const zones = Object.fromEntries(
    ["front", "rear", "left", "right"].map((k) => [k, clamp(damage[k] ?? 0)]),
  );
  if (
    Object.keys(zones).every(
      (k) => Math.abs(zones[k] - visual.damage[k]) < 0.005,
    )
  )
    return;
  visual.damage = zones;
  for (const item of visual.deformMeshes) {
    const { mesh, original } = item;
    if (!item.unique) {
      mesh.geometry = mesh.geometry.clone();
      item.unique = true;
    }
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = original[i * 3],
        y = original[i * 3 + 1],
        z = original[i * 3 + 2];
      const f = clamp((-z - 0.65) / 1.38) ** 2 * zones.front,
        r = clamp((z - 0.65) / 1.45) ** 2 * zones.rear;
      const l = clamp((-x - 0.35) / 0.56) ** 2 * zones.left,
        q = clamp((x - 0.35) / 0.56) ** 2 * zones.right;
      const ripple = Math.sin(x * 15 + z * 9) * 0.035;
      pos.setXYZ(
        i,
        x + (l - q) * 0.29 + (f + r) * ripple,
        y - (f + r) * 0.09 + (l + q) * ripple,
        z + f * 0.57 - r * 0.48 + (l + q) * ripple,
      );
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  for (const material of visual.paintMaterials)
    material.roughness = 0.24 + Math.max(...Object.values(zones)) * 0.21;
  if (visual.windshieldMesh)
    visual.windshieldMesh.material.opacity = clamp((zones.front - 0.24) * 1.7);
  // Small projected scratches follow the real deformed panel surface, rather than floating planes.
  for (const old of visual.decals) {
    old.removeFromParent();
    old.geometry.dispose();
    old.material.dispose();
  }
  visual.decals = [];
  if (!visual.player) return;
  scratchesTexture ??= lineTexture(false);
  visual.root.updateMatrixWorld(true);
  const inv = visual.root.matrixWorld.clone().invert();
  const projectors = {
    front: { p: [0.27, 0.08, -2.0], r: [0, Math.PI, 0] },
    rear: { p: [-0.24, 0.04, 2.0], r: [0, 0, 0] },
    left: { p: [-0.86, 0.1, 0.1], r: [0, -Math.PI / 2, 0] },
    right: { p: [0.86, 0.1, 0.1], r: [0, Math.PI / 2, 0] },
  };
  for (const [zone, d] of Object.entries(zones)) {
    if (d < 0.035) continue;
    const spec = projectors[zone],
      center = new THREE.Vector3(...spec.p).applyMatrix4(
        visual.root.matrixWorld,
      );
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(...spec.r))
      .premultiply(visual.root.quaternion);
    for (const body of visual.bodyMeshes) {
      const geometry = new DecalGeometry(
        body,
        center,
        new THREE.Euler().setFromQuaternion(q),
        new THREE.Vector3(0.85, 0.5, 0.85),
      );
      if (!geometry.attributes.position.count) {
        geometry.dispose();
        continue;
      }
      geometry.applyMatrix4(inv);
      const decal = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          map: scratchesTexture,
          transparent: true,
          opacity: clamp(d * 3, 0.15, 0.85),
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          roughness: 0.7,
          metalness: 0.5,
        }),
      );
      decal.renderOrder = 3;
      visual.root.add(decal);
      visual.decals.push(decal);
    }
  }
}

/** record is CitySimulation.vehicle/traffic record; copies real physics transforms. */
export function updateCarVisual(visual, record, options = {}) {
  if (typeof options === "number") options = { dt: options };
  options.night ??= options.weather === "night";
  options.wet ??= options.weather === "rain" || options.weather === "fog";
  visual.root.position.copy(record.body.position);
  visual.root.quaternion.copy(record.body.quaternion);
  record.raycast?.wheelInfos.forEach((info, i) => {
    if (info.worldTransform) {
      visual.wheels[i].position.copy(info.worldTransform.position);
      visual.wheels[i].quaternion.copy(info.worldTransform.quaternion);
    }
  });
  const controls = options.controls ?? record.controls ?? {};
  visual.lamps.forEach(
    (light) => (light.intensity = options.night ? 85 : options.wet ? 25 : 0),
  );
  visual.brakeMaterials.forEach(
    (m) =>
      (m.emissiveIntensity =
        controls.brake > 0.02 ? 4 : options.night ? 1.4 : 0.35),
  );
  visual.headMaterials.forEach(
    (m) => (m.emissiveIntensity = options.night ? 2 : 0.25),
  );
  visual.steering.rotation.z =
    -(record.steeringAngle ?? controls.steer ?? 0) * 2.2;
  visual.cabin.visible = !options.cockpit;
  applyCarDamage(visual, options.damage ?? record.damage);
}
