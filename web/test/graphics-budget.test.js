import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphicsBudget,
  applyPointLightBudget,
} from "../src/graphics-budget.js";

test("auto graphics relieves sustained slow frames while ignoring pauses and isolated stalls", () => {
  const budget = new GraphicsBudget();
  budget.sample(3, true);
  for (let i = 0; i < 120; i++) budget.sample(0.1, false);
  assert.equal(budget.level, "balanced");
  for (let i = 0; i < 180; i++) budget.sample(0.05);
  assert.equal(budget.level, "performance");
  for (let i = 0; i < 240; i++) budget.sample(1 / 60);
  assert.equal(
    budget.level,
    "performance",
    "Avoid rapid resolution oscillation",
  );
  for (let i = 0; i < 1200; i++) budget.sample(1 / 60);
  assert.equal(budget.level, "balanced");
});

test("auto graphics also reduces quality during sustained severe overload", () => {
  const budget = new GraphicsBudget();
  for (let i = 0; i < 60; i++) budget.sample(0.5);
  assert.equal(budget.level, "performance");
  assert.ok(budget.average <= 0.25);
});

test("manual graphics stay selected and rendering respects pixel budgets on large retina displays", () => {
  const budget = new GraphicsBudget("high");
  for (let i = 0; i < 1000; i++) budget.sample(0.1);
  assert.equal(budget.level, "high");
  const ratio = budget.pixelRatio(3840, 2160, 2);
  assert.ok(3840 * 2160 * ratio * ratio <= budget.settings.maxPixels + 1);
  budget.setMode("performance");
  assert.ok(budget.pixelRatio(1280, 720, 2) <= 0.8);
  assert.throws(() => budget.setMode("invalid"));
});

test("street and fallback pools share one budget, restore on quality increases, and hide zero-intensity lights", () => {
  const street = Array.from({ length: 6 }, () => ({
    intensity: 34,
    visible: true,
  }));
  const fallback = Array.from({ length: 5 }, () => ({
    intensity: 18,
    visible: true,
  }));
  assert.equal(applyPointLightBudget([street, fallback], 2), 2);
  assert.equal(street.filter((light) => light.visible).length, 2);
  assert.ok(fallback.every((light) => !light.visible));
  assert.equal(applyPointLightBudget([street, fallback], 6), 6);
  assert.ok(street.every((light) => light.visible));
  street.forEach((light) => {
    light.intensity = 0;
  });
  assert.equal(applyPointLightBudget([street, fallback], 3), 3);
  assert.ok(street.every((light) => !light.visible));
  assert.equal(fallback.filter((light) => light.visible).length, 3);
  fallback.forEach((light) => {
    light.intensity = 0;
  });
  assert.equal(applyPointLightBudget([street, fallback], 3), 0);
  assert.ok([...street, ...fallback].every((light) => !light.visible));
  fallback.forEach((light) => {
    light.intensity = 18;
  });
  assert.equal(applyPointLightBudget([undefined, fallback], 2), 2);
});
