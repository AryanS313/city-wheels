import * as THREE from "three";

// All exported positions use THREE/Cannon metres: X east, Y up, Z south.
// Geographic names come only from supplied OSM tags; fallback businesses are fictional.
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hash = (s) => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
function nearest(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1));
  const px = a[0] + dx * t,
    py = a[1] + dy * t;
  return { x: px, y: py, distance: Math.hypot(x - px, y - py) };
}
function inside(x, y, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
class Index {
  constructor(city, objects) {
    this.cells = new Map();
    this.size = 24;
    this.bounds = city.bounds;
    this.objects = objects;
    this.roads = [];
    const insert = (v, x0, y0, x1, y1) => {
      for (
        let x = Math.floor(x0 / this.size);
        x <= Math.floor(x1 / this.size);
        x++
      )
        for (
          let y = Math.floor(y0 / this.size);
          y <= Math.floor(y1 / this.size);
          y++
        ) {
          const k = `${x},${y}`;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push(v);
        }
    };
    for (const road of city.roads || [])
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i],
          width = road.width || 6.5,
          r = width * 0.5 + 18,
          v = { type: "road", a, b, width, road };
        this.roads.push(v);
        insert(
          v,
          Math.min(a[0], b[0]) - r,
          Math.min(a[1], b[1]) - r,
          Math.max(a[0], b[0]) + r,
          Math.max(a[1], b[1]) + r,
        );
      }
    for (const building of city.buildings || []) {
      const ring = building.footprint;
      if (!ring?.length) continue;
      insert(
        { type: "building", ring, building },
        Math.min(...ring.map((p) => p[0])) - 3,
        Math.min(...ring.map((p) => p[1])) - 3,
        Math.max(...ring.map((p) => p[0])) + 3,
        Math.max(...ring.map((p) => p[1])) + 3,
      );
    }
  }
  around(x, y) {
    return (
      this.cells.get(
        `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`,
      ) || []
    );
  }
  road(x, y) {
    let best = null;
    for (const r of this.around(x, y)) {
      if (r.type !== "road") continue;
      const p = nearest(x, y, r.a, r.b);
      if (!best || p.distance < best.distance) best = { ...r, ...p };
    }
    return best;
  }
  clear(x, y, r = 0.3, walkway = 1.45) {
    const b = this.bounds;
    if (x < b.minX + 4 || x > b.maxX - 4 || y < b.minY + 4 || y > b.maxY - 4)
      return false;
    for (const item of this.around(x, y)) {
      if (
        item.type === "road" &&
        nearest(x, y, item.a, item.b).distance < item.width / 2 + r + walkway
      )
        return false;
      if (item.type === "building") {
        if (inside(x, y, item.ring)) return false;
        for (let i = 0; i < item.ring.length; i++)
          if (
            nearest(x, y, item.ring[i], item.ring[(i + 1) % item.ring.length])
              .distance <
            r + 0.12
          )
            return false;
      }
    }
    for (const o of this.objects)
      if (
        Math.hypot(x - o.position[0], y + o.position[2]) <
        r + (o.radius ?? 0.25) + 0.5
      )
        return false;
    return true;
  }
}
function frontage(building, index, groundAt) {
  const ring = building.footprint;
  let best = null;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (length < 4) continue;
    const sign = area >= 0 ? 1 : -1,
      nx = (dy / length) * sign,
      ny = (-dx / length) * sign;
    const x = (a[0] + b[0]) * 0.5,
      y = (a[1] + b[1]) * 0.5,
      r = index.road(x, y);
    if (!r || r.distance > 22) continue;
    const facing = ((r.x - x) * nx + (r.y - y) * ny) / (r.distance || 1),
      gap = r.distance - r.width * 0.5;
    if (facing < 0.65 || gap < 0.6 || inside(x + nx * 0.3, y + ny * 0.3, ring))
      continue;
    const ground = groundAt(x + nx * 0.3, y + ny * 0.3);
    if (!Number.isFinite(ground)) continue;
    const score = r.distance + Math.max(0, 7 - length) * 0.7 + (1 - facing) * 8;
    if (!best || score < best.score)
      best = {
        position: [x + nx * 0.085, ground, -y - ny * 0.085],
        normal: [nx, ny],
        yaw: Math.atan2(nx, -ny),
        width: Math.min(5.8, length - 0.55),
        edgeLength: length,
        gap,
        roadId: r.road.id,
        street:
          r.road.name ||
          building.tags?.["addr:street"] ||
          "Neighbourhood street",
        score,
      };
  }
  return best;
}
const actualType = (b) =>
  b.tags?.amenity === "cafe"
    ? "cafe"
    : ["restaurant", "bar", "fast_food"].includes(b.tags?.amenity)
      ? "restaurant"
      : ["hotel", "motel", "hostel"].includes(b.tags?.tourism)
        ? "hotel"
        : null;
const fictional = {
  cafe: [
    "Switchback Coffee",
    "Baylight Coffee",
    "Corner Cup",
    "Fogbank Cafe",
    "Morning Climb",
    "Juniper Coffee",
    "Hilltop Espresso",
    "Blue Door Cafe",
  ],
  restaurant: [
    "Harbor Table",
    "The Bay Pantry",
    "Copper Pot Kitchen",
    "Sunset Supper",
    "Olive & Thyme",
    "The Corner Plate",
    "Northside Noodles",
    "Terrace Kitchen",
    "Sea Glass Kitchen",
    "The Evening Table",
  ],
  hotel: [
    "Baylight Guesthouse",
    "The Terrace Inn",
    "Northside Rooms",
    "Hillview Lodge",
  ],
  home: ["Neighbourhood Home"],
};
const palettes = {
  cafe: ["#cfaa6c", "#295a55"],
  restaurant: ["#c8876b", "#563d45"],
  hotel: ["#c1b9a2", "#2f4657"],
  home: ["#d3c6b3", "#566e58"],
  rest: ["#9b9e8a", "#505f63"],
};
function local(place, x, z, up = 0) {
  const c = Math.cos(place.yaw),
    s = Math.sin(place.yaw);
  return [
    place.position[0] + c * x + s * z,
    place.position[1] + up,
    place.position[2] - s * x + c * z,
  ];
}
function grounded(position, groundAt) {
  const p = [...position];
  p[1] = groundAt(p[0], -p[2]);
  return p;
}
function obstacle(id, kind, p, width, depth, height, yaw = 0) {
  return {
    id,
    type: "barrier",
    kind,
    position: p,
    width,
    depth,
    height,
    headingRadians: yaw,
    rotation: yaw,
    radius: Math.hypot(width, depth) * 0.5,
    halfExtents: [width / 2, height / 2, depth / 2],
  };
}

/** Validated public descriptors, shared activity spots and matching physical fixtures. */
export function createCityPlaces(
  city,
  groundAt,
  { streetObjects = [], maxPlaces = 38, restAreas = 5 } = {},
) {
  const index = new Index(city, streetObjects),
    places = [],
    activitySpots = [],
    obstacles = [],
    used = new Set(),
    counts = { cafe: 0, restaurant: 0, hotel: 0, home: 0 },
    candidates = [];
  for (const building of city.buildings || []) {
    if (
      !building.footprint?.length ||
      ["garage", "garages", "shed", "roof"].includes(building.tags?.building)
    )
      continue;
    if (
      !actualType(building) &&
      (building.tags?.amenity ||
        building.tags?.tourism ||
        building.tags?.shop ||
        building.name)
    )
      continue;
    const front = frontage(building, index, groundAt);
    if (front) candidates.push({ building, front, kind: actualType(building) });
  }
  candidates.sort(
    (a, b) =>
      (a.kind ? 0 : 1) - (b.kind ? 0 : 1) ||
      hash(a.building.id) - hash(b.building.id),
  );
  const quotas = { cafe: 9, restaurant: 10, hotel: 9, home: 10 };
  for (const c of candidates) {
    if (places.length >= maxPlaces) break;
    const b = c.building,
      f = c.front;
    if (
      places.some(
        (p) =>
          Math.hypot(
            p.position[0] - f.position[0],
            p.position[2] - f.position[2],
          ) < 23,
      )
    )
      continue;
    let kind = c.kind;
    if (kind && counts[kind] >= quotas[kind]) continue;
    if (!kind) {
      const cell = `${Math.floor(f.position[0] / 160)},${Math.floor(f.position[2] / 160)}`;
      const preferred = [
        "home",
        "cafe",
        "restaurant",
        "home",
        "cafe",
        "restaurant",
        "hotel",
      ][hash(cell + b.id) % 7];
      kind =
        counts[preferred] < quotas[preferred]
          ? preferred
          : Object.keys(quotas).find((k) => counts[k] < quotas[k]);
      if (!kind) continue;
    }
    const known = !!c.kind && !!(b.tags?.name || b.name),
      sourceName = b.tags?.name || b.name;
    if (known && used.has(sourceName)) continue;
    let name = known
      ? sourceName
      : kind === "home"
        ? b.tags?.["addr:housenumber"]
          ? `${b.tags["addr:housenumber"]} · HOME`
          : "NEIGHBOURHOOD HOME"
        : fictional[kind][counts[kind] % fictional[kind].length];
    const place = {
      id: `place-${b.id}`,
      kind,
      name,
      source: known ? "osm-tag" : "fictional-gameplay",
      fictional: !known,
      buildingId: b.id,
      osmId: b.osmId ?? null,
      address: known
        ? [b.tags?.["addr:housenumber"], b.tags?.["addr:street"]]
            .filter(Boolean)
            .join(" ")
        : null,
      ...f,
      palette: palettes[kind],
      props: [],
      activityIds: [],
    };
    counts[kind]++;
    if (known) used.add(sourceName);
    places.push(place);
  }
  const occupied = [];
  function safe(p, r, spacing = 0.2) {
    if (!Number.isFinite(p[1]) || !index.clear(p[0], -p[2], r)) return false;
    return !occupied.some(
      (o) =>
        Math.hypot(p[0] - o.position[0], p[2] - o.position[2]) <
        r + o.radius + spacing,
    );
  }
  function addFixture(place, kind, p, w, d, h, yaw = place.yaw) {
    const o = obstacle(
      `${place.id}-${kind}-${place.props.length}`,
      kind,
      p,
      w,
      d,
      h,
      yaw,
    );
    obstacles.push(o);
    occupied.push(o);
    place.props.push(o);
    return o;
  }
  for (const place of places) {
    const { kind } = place;
    // Seating is placed against the facade, leaving at least 1.45 m clear by every road edge.
    if (kind === "cafe" || kind === "restaurant") {
      for (const along of [-1.55, 1.55]) {
        const table = grounded(local(place, along, 0.87), groundAt),
          seats = [-0.79, 0.79].map((dx) =>
            grounded(local(place, along + dx, 0.87), groundAt),
          );
        if (
          !safe(table, 0.61) ||
          seats.some((p) => !safe(p, 0.32)) ||
          Math.max(...[table, ...seats].map((p) => p[1])) -
            Math.min(...[table, ...seats].map((p) => p[1])) >
            0.32
        )
          continue;
        const tableObject = addFixture(place, "table", table, 0.86, 0.86, 0.75);
        const participants = [];
        for (let i = 0; i < seats.length; i++) {
          const p = seats[i],
            yaw = place.yaw + (i === 0 ? Math.PI / 2 : -Math.PI / 2);
          const chair = addFixture(place, "chair", p, 0.42, 0.43, 0.475, yaw);
          participants.push({
            position: [...p],
            facing: yaw,
            posture: "seated",
            seatHeight: 0.44,
            ownObstacleId: chair.id,
            ignoreObstacleIds: [chair.id, tableObject.id],
          });
        }
        const spot = {
          id: `${place.id}-table-${place.activityIds.length}`,
          placeId: place.id,
          type: kind === "cafe" ? "coffee" : "dine",
          position: [...seats[0]],
          facing: participants[0].facing,
          capacity: 2,
          participants,
          label: place.name,
          tablePosition: [...table],
          tableId: tableObject.id,
        };
        activitySpots.push(spot);
        place.activityIds.push(spot.id);
      }
    }
    // Doorstep conversations use empty pedestrian anchors, never the center of a solid table.
    for (const along of [0, -2.1, 2.1]) {
      const p = grounded(local(place, along, 0.85), groundAt),
        p2 = grounded(local(place, along + 1, 0.85), groundAt);
      if (!safe(p, 0.31) || !safe(p2, 0.31)) continue;
      const spot = {
        id: `${place.id}-chat`,
        placeId: place.id,
        type: "chat",
        position: p,
        facing: place.yaw,
        capacity: 2,
        label: place.name,
        participants: [
          { position: p, facing: place.yaw + Math.PI / 2 },
          { position: p2, facing: place.yaw - Math.PI / 2 },
        ],
      };
      activitySpots.push(spot);
      place.activityIds.push(spot.id);
      break;
    }
    // Homes and hotels get small planters only when they fit outside the clear walking corridor.
    if (kind === "home" || kind === "hotel")
      for (const along of [-place.width * 0.35, place.width * 0.35]) {
        const p = grounded(local(place, along, 0.43), groundAt);
        if (safe(p, 0.29)) addFixture(place, "planter", p, 0.4, 0.4, 0.54);
      }
  }
  // Fictional, quiet rest pockets in open public space. These never assert real residents' locations.
  const restCandidates = [];
  for (const road of city.roads || []) {
    let distance = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      distance += length;
      if (length < 0.5 || distance < 34) continue;
      distance = 0;
      for (const side of [-1, 1]) {
        const nx = (dy / length) * side,
          ny = (-dx / length) * side,
          x = (a[0] + b[0]) * 0.5 + nx * ((road.width || 6.5) / 2 + 4),
          y = (a[1] + b[1]) * 0.5 + ny * ((road.width || 6.5) / 2 + 4);
        restCandidates.push({
          position: [x, groundAt(x, y), -y],
          yaw: Math.atan2(nx, -ny),
          roadId: road.id,
          street: road.name || "Neighbourhood street",
          seed: hash(`${road.id}:${i}:${side}`),
        });
      }
    }
  }
  restCandidates.sort((a, b) => a.seed - b.seed);
  let restCount = 0;
  for (const c of restCandidates) {
    if (restCount >= restAreas) break;
    if (
      !safe(c.position, 1.05) ||
      places.some(
        (p) =>
          p.kind === "rest" &&
          Math.hypot(
            p.position[0] - c.position[0],
            p.position[2] - c.position[2],
          ) < 100,
      )
    )
      continue;
    const p = {
      ...c,
      id: `rest-pocket-${restCount + 1}`,
      kind: "rest",
      name: "Quiet rest area",
      fictional: true,
      source: "fictional-gameplay",
      palette: palettes.rest,
      width: 2.3,
      props: [],
      activityIds: [],
    };
    const seat = grounded(local(p, 0, 0), groundAt),
      bag = grounded(local(p, 0.65, 0.4), groundAt);
    if (!safe(bag, 0.28) || Math.abs(bag[1] - seat[1]) > 0.17) continue;
    const mat = addFixture(
      p,
      "rest-mat",
      grounded(local(p, 0, -0.15), groundAt),
      0.64,
      1.48,
      0.09,
    );
    addFixture(p, "backpack", bag, 0.36, 0.29, 0.45);
    const spot = {
      id: `${p.id}-rest`,
      placeId: p.id,
      type: "rest",
      position: seat,
      facing: p.yaw,
      capacity: 1,
      label: p.name,
      participants: [
        {
          position: seat,
          facing: p.yaw,
          posture: "resting",
          seatHeight: 0.09,
          ownObstacleId: mat.id,
        },
      ],
      respectfulContext:
        "A resident taking a quiet rest with personal belongings; same interactions and vulnerability as any resident.",
    };
    activitySpots.push(spot);
    p.activityIds.push(spot.id);
    places.push(p);
    restCount++;
  }
  return {
    places,
    activitySpots,
    obstacles,
    statistics: {
      venues: places.filter((p) => p.kind !== "rest").length,
      restAreas: restCount,
      activitySpots: activitySpots.length,
      solidFixtures: obstacles.length,
      osmNamed: places.filter((p) => p.source === "osm-tag").length,
      fictional: places.filter((p) => p.fictional).length,
      byKind: counts,
    },
    coordinateSystem: "X=east,Y=elevation,Z=south; metres",
    clearWalkingMargin: 1.45,
  };
}

function textTexture(label, subtitle, color) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 192;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 768, 192);
  ctx.strokeStyle = "#dbcda8";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 748, 172);
  ctx.fillStyle = "#fff9e9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.min(57, 1050 / Math.max(8, label.length));
  ctx.font = `600 ${size}px Georgia,serif`;
  ctx.fillText(label, 384, 76, 710);
  ctx.font = "500 23px sans-serif";
  ctx.fillText(subtitle.toUpperCase(), 384, 138, 710);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function addBatch(group, geometry, material, list) {
  if (!list.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, list.length),
    o = new THREE.Object3D();
  list.forEach((t, i) => {
    o.position.fromArray(t.p);
    o.rotation.set(...(t.r || [0, t.yaw || 0, 0]));
    o.scale.fromArray(t.s || [1, 1, 1]);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    if (t.color) mesh.setColorAt(i, new THREE.Color(t.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

/** The visible furniture below uses exactly the same ground transforms as obstacles. */
export function createPlaceVisuals(input) {
  const places = Array.isArray(input) ? input : input.places,
    group = new THREE.Group();
  group.name = "City storefronts and public rest pockets";
  const box = new THREE.BoxGeometry(1, 1, 1),
    cylinder = new THREE.CylinderGeometry(1, 1, 1, 12),
    sphere = new THREE.SphereGeometry(1, 8, 6);
  const wood = new THREE.MeshStandardMaterial({
      color: "#714f36",
      roughness: 0.82,
    }),
    metal = new THREE.MeshStandardMaterial({
      color: "#303a39",
      roughness: 0.55,
      metalness: 0.3,
    }),
    cream = new THREE.MeshStandardMaterial({
      color: "#e9dfc8",
      roughness: 0.8,
    }),
    glass = new THREE.MeshPhysicalMaterial({
      color: "#2c4d55",
      metalness: 0.35,
      roughness: 0.18,
      transparent: true,
      opacity: 0.83,
    }),
    green = new THREE.MeshStandardMaterial({
      color: "#547c42",
      roughness: 0.95,
    }),
    cloth = new THREE.MeshStandardMaterial({ color: "#fff", roughness: 1 });
  const batches = {
    wood: [],
    metal: [],
    cream: [],
    glass: [],
    cloth: [],
    plant: [],
    cups: [],
    food: [],
  };
  const add = (bucket, p, s, yaw = 0, color) =>
    batches[bucket].push({ p, s, yaw, color });
  for (const place of places) {
    if (place.kind !== "rest") {
      const signY = place.kind === "home" ? 2.05 : 2.9,
        signWidth = Math.min(place.width, place.kind === "home" ? 1.5 : 5.3);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(signWidth, place.kind === "home" ? 0.43 : 0.82),
        new THREE.MeshStandardMaterial({
          map: textTexture(
            place.name,
            place.kind === "home"
              ? "Private home"
              : place.kind === "hotel"
                ? "Rooms · welcome"
                : place.kind === "cafe"
                  ? "Coffee · bakery"
                  : "Kitchen · dining",
            place.palette[1],
          ),
          color: "#fff9e9",
          roughness: 0.85,
        }),
      );
      sign.position.fromArray(local(place, 0, 0.11, signY));
      sign.rotation.y = place.yaw;
      group.add(sign);
      const door = local(place, 0, 0.09, 1.0);
      add("glass", door, [0.92, 1.95, 0.06], place.yaw);
      add("cream", local(place, -0.51, 0.12, 1), [0.07, 2.12, 0.1], place.yaw);
      add("cream", local(place, 0.51, 0.12, 1), [0.07, 2.12, 0.1], place.yaw);
      add("cream", local(place, 0, 0.12, 2.05), [1.1, 0.1, 0.1], place.yaw);
      add("metal", local(place, 0.31, 0.18, 1), [0.05, 0.27, 0.045], place.yaw);
      if (place.kind !== "home") {
        const depth = Math.max(0.15, Math.min(0.95, place.gap - 0.45));
        for (let i = 0; i < 12; i++)
          batches.cloth.push({
            p: local(
              place,
              -place.width / 2 + ((i + 0.5) * place.width) / 12,
              0.08 + depth / 2,
              2.36,
            ),
            s: [place.width / 12, 0.07, depth],
            r: [-0.12, place.yaw, 0],
            color: i % 2 ? place.palette[0] : place.palette[1],
          });
        // Two alternating instanced valance bands make venue canopies identifiable at driving speed.
        for (let i = 0; i < 12; i++)
          add(
            "cloth",
            local(
              place,
              -place.width / 2 + ((i + 0.5) * place.width) / 12,
              0.1 + depth,
              2.24,
            ),
            [place.width / 12, 0.22, 0.045],
            place.yaw,
            i % 2 ? place.palette[0] : place.palette[1],
          );
        for (const side of [-1, 1]) {
          add(
            "glass",
            local(place, side * Math.min(1.63, place.width * 0.3), 0.08, 1.18),
            [Math.max(0.65, place.width * 0.27), 1.6, 0.05],
            place.yaw,
          );
          add(
            "cream",
            local(place, side * Math.min(1.63, place.width * 0.3), 0.12, 0.38),
            [Math.max(0.8, place.width * 0.29), 0.08, 0.12],
            place.yaw,
          );
        }
      }
    }
    for (const prop of place.props) {
      const p = prop.position,
        yaw = prop.headingRadians;
      if (prop.kind === "table") {
        add("wood", [p[0], p[1] + 0.71, p[2]], [0.86, 0.08, 0.86], yaw);
        add("metal", [p[0], p[1] + 0.34, p[2]], [0.095, 0.68, 0.095]);
        add("metal", [p[0], p[1] + 0.05, p[2]], [0.55, 0.07, 0.5], yaw);
        for (const side of [-1, 1]) {
          const q = [
            p[0] + Math.cos(yaw) * side * 0.23,
            p[1] + 0.82,
            p[2] - Math.sin(yaw) * side * 0.23,
          ];
          add("cups", q, [0.048, 0.12, 0.048]);
          add(
            "food",
            [
              q[0] + Math.sin(yaw) * 0.16,
              p[1] + 0.765,
              q[2] + Math.cos(yaw) * 0.16,
            ],
            [0.105, 0.012, 0.105],
          );
          if (place.kind === "restaurant")
            add(
              "plant",
              [
                q[0] + Math.sin(yaw) * 0.16,
                p[1] + 0.79,
                q[2] + Math.cos(yaw) * 0.16,
              ],
              [0.065, 0.025, 0.065],
            );
        }
      } else if (prop.kind === "chair") {
        add("wood", [p[0], p[1] + 0.44, p[2]], [0.42, 0.07, 0.42], yaw);
        const c = Math.cos(yaw),
          s = Math.sin(yaw);
        add(
          "wood",
          [p[0] - s * 0.19, p[1] + 0.66, p[2] - c * 0.19],
          [0.42, 0.29, 0.045],
          yaw,
        );
        for (const x of [-0.16, 0.16])
          for (const z of [-0.16, 0.16])
            add(
              "metal",
              [p[0] + c * x + s * z, p[1] + 0.21, p[2] - s * x + c * z],
              [0.035, 0.42, 0.035],
              yaw,
            );
      } else if (prop.kind === "planter") {
        add("cream", [p[0], p[1] + 0.22, p[2]], [0.4, 0.44, 0.4], yaw);
        add("plant", [p[0], p[1] + 0.47, p[2]], [0.23, 0.22, 0.23]);
      } else if (prop.kind === "rest-mat") {
        add(
          "cloth",
          [p[0], p[1] + 0.045, p[2]],
          [0.64, 0.09, 1.48],
          yaw,
          "#707e78",
        );
        add(
          "cloth",
          [p[0], p[1] + 0.11, p[2]],
          [0.55, 0.055, 0.76],
          yaw,
          "#927d66",
        );
      } else if (prop.kind === "backpack") {
        add(
          "cloth",
          [p[0], p[1] + 0.21, p[2]],
          [0.32, 0.42, 0.27],
          yaw,
          "#695b46",
        );
        add("metal", [p[0], p[1] + 0.3, p[2] + 0.15], [0.2, 0.12, 0.025], yaw);
      }
    }
  }
  addBatch(group, box, wood, batches.wood);
  addBatch(group, box, metal, batches.metal);
  addBatch(group, box, cream, batches.cream);
  addBatch(group, box, glass, batches.glass);
  addBatch(group, box, cloth, batches.cloth);
  addBatch(group, sphere, green, batches.plant);
  addBatch(group, cylinder, cream, batches.cups);
  addBatch(group, cylinder, cream, batches.food);
  group.userData.placeCount = places.length;
  group.userData.activitySpots = Array.isArray(input)
    ? []
    : input.activitySpots;
  return group;
}
