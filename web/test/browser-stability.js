// Development-only browser regression runner. Vite removes this import from releases.
// Open /?stability-test, start driving, then use the visible test controls.
export function installStabilityPanel({
  sim,
  view,
  life,
  session,
  pursuit,
  pause,
}) {
  const panel = document.createElement("aside");
  panel.style.cssText =
    "position:fixed;z-index:90;left:20px;top:90px;padding:12px;background:#102632ed;color:white;width:390px;font:12px monospace";
  panel.innerHTML = `<strong>Development stability checks</strong><p><button id="test-switch">Run 60 car switches</button> <button id="test-context">Test display recovery</button> <button id="test-frame">Test stopped-frame recovery</button></p><pre id="test-result" style="white-space:pre-wrap">Ready</pre>`;
  document.body.append(panel);
  const result = panel.querySelector("#test-result");
  let errors = 0,
    contextLosses = 0;
  window.addEventListener("error", () => errors++);
  window.addEventListener("unhandledrejection", () => errors++);
  view.renderer.domElement.addEventListener(
    "webglcontextlost",
    () => contextLosses++,
  );
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const info = () => ({
    ...view.renderer.info.memory,
    programs: view.renderer.info.programs.length,
    draws: view.renderer.info.render.calls,
  });
  panel.querySelector("#test-frame").onclick = () => {
    pause();
    sim.vehicle.body.position.x = NaN;
    sim.rpm = NaN;
    result.textContent =
      "Injected an invalid transform. The drive should stop with a restart screen.";
  };
  panel.querySelector("#test-switch").onclick = async () => {
    const button = panel.querySelector("#test-switch");
    button.disabled = true;
    try {
      pause();
      const base = sim.vehicle.body.position.clone();
      const fleet = [sim.vehicle, ...sim.traffic];
      const subjects = [
        fleet[0],
        ...fleet.filter((c) => c.parked).slice(0, 2),
        ...fleet.filter((c) => c.role === "police").slice(0, 1),
        ...fleet
          .filter((c) => c.role !== "police" && !c.parked && c !== fleet[0])
          .slice(0, 2),
      ];
      for (let i = 0; i < fleet.length; i++) {
        const car = fleet[i];
        car.body.position.set(base.x + 180 + i * 4, base.y, base.z + 100);
        car.body.velocity.setZero();
        car.body.angularVelocity.setZero();
        for (let w = 0; w < 4; w++) car.raycast.updateWheelTransform(w);
      }
      let baseline;
      const durations = [];
      for (let i = 0; i < 60; i++) {
        pursuit.reset();
        const old = sim.vehicle;
        const target = subjects.find(
          (c, j) => j === (subjects.indexOf(old) + 1) % subjects.length,
        );
        old.body.position.copy(base);
        target.body.position.set(base.x + 3.8, base.y, base.z);
        old.body.velocity.setZero();
        target.body.velocity.setZero();
        old.body.angularVelocity.setZero();
        target.body.angularVelocity.setZero();
        target.body.quaternion.setFromAxisAngle(
          { x: 0, y: 1, z: 0 },
          i % 2 ? Math.PI : 0,
        );
        target.parked = i % 2 === 0;
        target.damage = { front: 0.2, rear: 0.1, left: 0.15, right: 0 };
        for (const car of [old, target])
          for (let w = 0; w < 4; w++) car.raycast.updateWheelTransform(w);
        view.mode = i % 3;
        if (i % 12 === 0)
          view.setWeather(
            ["golden", "night", "rain", "day", "fog"][Math.floor(i / 12)],
          );
        view.update(sim, 1 / 60, true);
        const previousVisual = view.carVisuals.get(target);
        const start = performance.now();
        session.theftTarget = target;
        assert(session.completeTheft(), "Theft failed");
        view.update(sim, 1 / 60, true);
        durations.push(performance.now() - start);
        assert(
          view.carVisuals.get(target) === previousVisual,
          "Theft rebuilt car visuals",
        );
        assert(
          view.camera.position.distanceTo(target.body.position) < 20,
          "Camera did not follow stolen car",
        );
        assert(
          [
            ...view.camera.matrixWorld.elements,
            ...view.camera.projectionMatrix.elements,
          ].every(Number.isFinite),
          "Invalid camera matrix",
        );
        for (const visual of view.carVisuals.values())
          for (const root of [visual.root, ...visual.wheels])
            root.traverse((o) => {
              assert(
                o.matrixWorld.elements.every(Number.isFinite),
                "Invalid car transform",
              );
            });
        assert(
          view.renderer.info.programs.every(
            (p) => p.diagnostics?.runnable !== false,
          ),
          "Shader compile failure",
        );
        assert(
          document.querySelector("#recovery").hidden,
          "Runtime recovery screen appeared during theft",
        );
        old.body.position.set(base.x + 80, base.y, base.z + 50);
        for (let w = 0; w < 4; w++) old.raycast.updateWheelTransform(w);
        if (i === 23) baseline = info();
        result.textContent = JSON.stringify(
          {
            switches: i + 1,
            errors,
            contextLosses,
            people: life.people.length,
            gpu: info(),
          },
          null,
          2,
        );
        await frame();
      }
      const end = info();
      assert(
        errors === 0 && contextLosses === 0,
        "Browser error or context loss",
      );
      assert(
        end.geometries <= baseline.geometries + 30 &&
          end.textures <= baseline.textures + 2,
        "GPU resources grew after warmup",
      );
      durations.sort((a, b) => a - b);
      result.textContent = JSON.stringify(
        {
          status: "PASS",
          switches: 60,
          errors,
          contextLosses,
          people: life.people.length,
          baseline,
          end,
          switchMedianMs: durations[30],
          switchP95Ms: durations[57],
        },
        null,
        2,
      );
      pursuit.reset();
      session.events.length = 0;
      view.mode = 0;
    } catch (error) {
      result.textContent = `FAIL: ${error.stack}`;
    } finally {
      button.disabled = false;
    }
  };
  panel.querySelector("#test-context").onclick = () => {
    const extension = view.renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    if (!extension) {
      result.textContent = "Context-loss extension unavailable";
      return;
    }
    result.textContent =
      "Requesting context loss; automatic restore in two seconds.";
    view.renderer.domElement.addEventListener(
      "webglcontextrestored",
      () => {
        result.textContent =
          "PASS: graphics context restored. Click the road to resume.";
      },
      { once: true },
    );
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 2000);
  };
}
