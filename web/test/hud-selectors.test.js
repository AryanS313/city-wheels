import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import postcss from "postcss";
const css = fs.readFileSync(
    new URL("../src/style.css", import.meta.url),
    "utf8",
  ),
  main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8"),
  html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const parsed = postcss.parse(css),
  state = main.match(
    /function updateGameplayUI\(\)\s*\{[\s\S]*?document\.body\.classList\.toggle\("([^"]+)"/,
  )?.[1];
test("wanted panel selectors cannot match a body carrying the gameplay state class", () => {
  assert.ok(state);
  const classes = html.match(/id="wanted"\s+class="([^"]+)"/)?.[1].split(/\s+/);
  assert.ok(classes?.length);
  assert.ok(!classes.includes(state));
  parsed.walkRules((rule) => {
    for (const selector of rule.selectors || []) {
      // The original bare .wanted panel selector also matched body.wanted. Check
      // both the legacy class and the currently wired gameplay state.
      for (const token of new Set(["wanted", state])) {
        const rootSelector = new RegExp(
          `^(?:body)?\\.${token}(?:\\.[\\w-]+)*$`,
        );
        if (rootSelector.test(selector.trim()))
          assert.ok(
            !rule.nodes.some(
              (node) =>
                node.type === "decl" &&
                /^(position|width|height|top|right|bottom|left|padding|background|border|z-index)/.test(
                  node.prop,
                ),
            ),
            `Root gameplay state applies panel layout: ${selector}`,
          );
      }
    }
  });
});
test("pursuit text declarations preserve readable sizes at responsive breakpoints", () => {
  let rules = 0;
  parsed.walkRules((rule) => {
    if (rule.selectors?.some((s) => /^#wanted (strong|p)$/.test(s.trim()))) {
      rules++;
      rule.walkDecls("font-size", (decl) =>
        assert.ok(parseFloat(decl.value) >= 14),
      );
    }
  });
  assert.ok(rules >= 4);
});
