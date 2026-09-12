import gameStyles from "../src/style.css?inline";
/** DOM/layout regression: no WebGL or simulation access is needed. */
export async function runWantedLayoutRegression({
  cssUrl = null,
  htmlUrl = new URL("../index.html", import.meta.url),
  stateClass = "is-wanted",
} = {}) {
  const read = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load layout fixture: ${url}`);
    return response.text();
  };
  const [css, html] = await Promise.all([
    cssUrl ? read(cssUrl) : gameStyles,
    read(htmlUrl),
  ]);
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  const results = [];
  for (const [width, height] of [
    [1366, 900],
    [390, 844],
    [844, 390],
  ]) {
    const iframe = document.createElement("iframe");
    iframe.title = `HUD regression ${width} by ${height}`;
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`;
    const loaded = new Promise((resolve) =>
      iframe.addEventListener("load", resolve, { once: true }),
    );
    iframe.srcdoc = markup.replace("</head>", `<style>${css}</style></head>`);
    document.body.append(iframe);
    await loaded;
    const doc = iframe.contentDocument,
      win = iframe.contentWindow,
      body = doc.body,
      panel = doc.getElementById("wanted");
    body.className = "playing";
    doc.querySelector("#start")?.setAttribute("hidden", "");
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const snapshot = () => ({
      body: rect(body),
      game: rect(doc.getElementById("game")),
      world: rect(doc.getElementById("world")),
      panel: rect(panel),
      titleFont: Number.parseFloat(
        win.getComputedStyle(doc.getElementById("pursuit-title")).fontSize,
      ),
      detailFont: Number.parseFloat(
        win.getComputedStyle(doc.getElementById("pursuit-detail")).fontSize,
      ),
      missionHidden:
        win.getComputedStyle(doc.getElementById("mission")).display === "none",
      graphics: doc.getElementById("graphics")
        ? rect(doc.getElementById("graphics"))
        : null,
    });
    panel.hidden = true;
    const before = snapshot();
    body.classList.add(stateClass, "wanted");
    panel.hidden = false;
    const wanted = snapshot();
    panel.classList.add("search");
    const searching = snapshot();
    body.classList.remove(stateClass, "wanted");
    panel.hidden = true;
    const cleared = snapshot();
    const errors = [];
    if (wanted.graphics) {
      const p = wanted.graphics;
      if (
        p.x < 0 ||
        p.y < 0 ||
        p.x + p.width > width + 0.5 ||
        p.y + p.height > height + 0.5
      )
        errors.push("Graphics selector leaves viewport");
    }
    for (const [state, metrics] of Object.entries({
      wanted,
      searching,
      cleared,
    })) {
      for (const element of ["body", "game", "world"])
        for (const property of ["x", "y", "width", "height"]) {
          if (
            Math.abs(metrics[element][property] - before[element][property]) >
            0.5
          )
            errors.push(
              `${state}: ${element}.${property} changed ${before[element][property]} → ${metrics[element][property]}`,
            );
        }
      if (state !== "cleared") {
        const p = metrics.panel;
        if (
          p.x < 0 ||
          p.y < 0 ||
          p.x + p.width > width + 0.5 ||
          p.y + p.height > height + 0.5
        )
          errors.push(`${state}: panel leaves viewport`);
        if (metrics.titleFont < 16 || metrics.detailFont < 14)
          errors.push(`${state}: alert text is too small`);
        if (!metrics.missionHidden)
          errors.push(`${state}: mission card overlaps wanted card`);
      }
    }
    if (
      Math.abs(wanted.world.width - width) > 0.5 ||
      Math.abs(wanted.world.height - height) > 0.5
    )
      errors.push("Wanted state no longer fills the viewport");
    results.push({
      viewport: { width, height },
      status: errors.length ? "FAIL" : "PASS",
      before,
      wanted,
      searching,
      cleared,
      errors,
    });
    iframe.remove();
  }
  return {
    status: results.every((r) => r.status === "PASS") ? "PASS" : "FAIL",
    results,
  };
}
