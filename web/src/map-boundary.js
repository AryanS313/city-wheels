import * as THREE from "three";

/** Finite city packages use east/north bounds; outputs use X east, Y up, Z south. */
export function createBoundaryLayout(city, groundAt) {
  const b = city.bounds;
  if (
    !b ||
    !["minX", "maxX", "minY", "maxY"].every((k) => Number.isFinite(b[k])) ||
    b.maxX - b.minX < 5 ||
    b.maxY - b.minY < 5
  )
    throw new RangeError(
      "A district boundary requires finite, ordered city bounds at least five metres wide.",
    );
  if (typeof groundAt !== "function")
    throw new TypeError("A terrain elevation sampler is required.");
  const depth = 0.8,
    inset = 0.55,
    margin = inset - depth / 2,
    segmentLength = 4,
    overlap = 0.12,
    clearance = 3;
  const edges = [
    {
      name: "north",
      fixed: -b.maxY + inset,
      start: b.minX + margin,
      end: b.maxX - margin,
      alongX: true,
    },
    {
      name: "south",
      fixed: -b.minY - inset,
      start: b.minX + margin,
      end: b.maxX - margin,
      alongX: true,
    },
    {
      name: "west",
      fixed: b.minX + inset,
      start: -b.maxY + margin,
      end: -b.minY - margin,
      alongX: false,
    },
    {
      name: "east",
      fixed: b.maxX - inset,
      start: -b.maxY + margin,
      end: -b.minY - margin,
      alongX: false,
    },
  ];
  const layout = [];
  for (const edge of edges) {
    const count = Math.ceil((edge.end - edge.start) / segmentLength),
      step = (edge.end - edge.start) / count;
    for (let i = 0; i < count; i++) {
      const a = Math.max(edge.start, edge.start + i * step - overlap / 2),
        z = Math.min(edge.end, edge.start + (i + 1) * step + overlap / 2);
      let low = Infinity,
        high = -Infinity;
      const samples = Math.ceil((z - a) / 0.5);
      for (let j = 0; j <= samples; j++)
        for (const across of [-depth / 2, 0, depth / 2]) {
          const along = a + ((z - a) * j) / samples,
            x = edge.alongX ? along : edge.fixed + across,
            south = edge.alongX ? edge.fixed + across : along;
          const elevation = groundAt(x, -south);
          if (!Number.isFinite(elevation))
            throw new RangeError(
              `Terrain is not finite at the ${edge.name} district edge.`,
            );
          low = Math.min(low, elevation);
          high = Math.max(high, elevation);
        }
      const middle = (a + z) / 2,
        base = low - 0.4;
      layout.push({
        id: `district-boundary-${city.id || "city"}-${edge.name}-${i}`,
        type: "barrier",
        position: [
          edge.alongX ? middle : edge.fixed,
          base,
          edge.alongX ? edge.fixed : middle,
        ],
        width: z - a,
        depth,
        height: high + clearance - base,
        headingRadians: edge.alongX ? 0 : Math.PI / 2,
        radius: Math.hypot(z - a, depth) / 2,
        districtBoundary: true,
        edge: edge.name,
      });
    }
  }
  return layout;
}

/** Solid panels deliberately match the entire physical box; no hidden wall above them. */
export function createBoundaryVisuals(layout) {
  const group = new THREE.Group();
  group.name = "District perimeter safety barriers";
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    materials = [
      new THREE.MeshStandardMaterial({ color: 0x737979, roughness: 0.94 }),
      new THREE.MeshStandardMaterial({
        color: 0x687b7a,
        roughness: 0.64,
        metalness: 0.48,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xe8b44c,
        roughness: 0.46,
        metalness: 0.24,
        emissive: 0x3b2607,
        emissiveIntensity: 0.2,
      }),
    ];
  const names = [
    "Concrete barrier bases",
    "Steel district edge panels",
    "Reflective safety caps",
  ];
  const meshes = materials.map((material, i) => {
    const mesh = new THREE.InstancedMesh(geometry, material, layout.length);
    mesh.name = names[i];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  const matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0);
  for (const [i, barrier] of layout.entries()) {
    const baseHeight = Math.min(1, barrier.height - 0.2),
      capHeight = 0.12;
    const bands = [
      [0, baseHeight],
      [baseHeight, barrier.height - baseHeight - capHeight],
      [barrier.height - capHeight, capHeight],
    ];
    rotation.setFromAxisAngle(up, barrier.headingRadians);
    bands.forEach(([offset, height], band) => {
      position.set(
        barrier.position[0],
        barrier.position[1] + offset + height / 2,
        barrier.position[2],
      );
      scale.set(barrier.width, height, barrier.depth);
      matrix.compose(position, rotation, scale);
      meshes[band].setMatrixAt(i, matrix);
    });
  }
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  return {
    group,
    layout,
    meshes,
    dispose() {
      for (const mesh of meshes) {
        mesh.dispose();
        mesh.removeFromParent();
      }
      geometry.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent();
    },
  };
}
