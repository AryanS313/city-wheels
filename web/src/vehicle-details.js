import * as THREE from "three";

let policeLabel;
function labelTexture() {
  if (policeLabel) return policeLabel;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8eeef";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#182c42";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("POLICE", 256, 69);
  policeLabel = new THREE.CanvasTexture(canvas);
  policeLabel.colorSpace = THREE.SRGBColorSpace;
  return policeLabel;
}
function cube(root, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  root.add(mesh);
  return mesh;
}

export function addVehicleDetails(visual, record) {
  if (visual.details || visual.disposed) return;
  const group = new THREE.Group();
  visual.root.add(group);
  visual.details = group;
  const uniform = new THREE.MeshStandardMaterial({
    color: record.role === "police" ? "#213347" : "#657785",
    roughness: 0.9,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: ["#b6815f", "#d9ac87", "#754d3d"][record.body.id % 3],
    roughness: 0.85,
  });
  const driver = new THREE.Group();
  group.add(driver);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), skin);
  head.position.set(-0.19, 0.19, 0.02);
  driver.add(head);
  cube(driver, 0.24, 0.24, 0.17, uniform, -0.19, -0.05, 0.065);
  visual.driver = driver;
  if (record.role === "police") {
    const black = new THREE.MeshStandardMaterial({
      color: "#101a21",
      roughness: 0.38,
    });
    cube(group, 0.97, 0.055, 0.19, black, 0, 0.455, 0.12);
    const red = new THREE.MeshStandardMaterial({
      color: "#ec153a",
      emissive: "#ff163c",
      emissiveIntensity: 0,
    });
    const blue = new THREE.MeshStandardMaterial({
      color: "#157aea",
      emissive: "#126dff",
      emissiveIntensity: 0,
    });
    cube(group, 0.4, 0.1, 0.17, red, -0.24, 0.515, 0.12);
    cube(group, 0.4, 0.1, 0.17, blue, 0.24, 0.515, 0.12);
    const decal = new THREE.MeshBasicMaterial({
      map: labelTexture(),
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.07, 0.25), decal);
      plate.position.set(side * 0.868, -0.012, 0.03);
      plate.rotation.y = (side * Math.PI) / 2;
      group.add(plate);
    }
    visual.policeLights = [red, blue];
    const spot = new THREE.PointLight("#267bff", 0, 9, 2);
    spot.position.set(0, 0.72, 0);
    spot.visible = false;
    group.add(spot);
    visual.policeGlow = spot;
  }
  let disposed = false;
  visual.detailsDispose = () => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set(),
      materials = new Set();
    group.traverse((object) => {
      if (object.isMesh) {
        geometries.add(object.geometry);
        materials.add(object.material);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    group.removeFromParent();
    visual.details = visual.driver = visual.policeGlow = null;
    visual.policeLights = null;
  };
}

export function updateVehicleDetails(
  visual,
  record,
  { player = false, time = 0, wanted = false, distance = 0 } = {},
) {
  if (visual.driver) visual.driver.visible = !player && !record.parked;
  if (!visual.policeLights) return;
  const active = wanted && record.policeLights && !record.abandoned && !player;
  const phase = Math.floor(time * 7) % 2;
  visual.policeLights.forEach(
    (material, i) =>
      (material.emissiveIntensity = active ? (phase === i ? 5 : 0.08) : 0),
  );
  if (visual.policeGlow) {
    visual.policeGlow.color.set(phase ? "#207bff" : "#ff2145");
    visual.policeGlow.intensity = active && distance < 55 ? 8 : 0;
    visual.policeGlow.visible = visual.policeGlow.intensity > 0;
  }
}
