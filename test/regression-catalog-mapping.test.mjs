import test from "node:test";
import assert from "node:assert/strict";
import { regressionCases } from "../regression/catalog/index.mjs";
import { readSpecScenarios } from "../regression/spec-scenarios.mjs";

function key(value) {
  return [value.capability, value.requirement, value.scenario].join("\0");
}

test("[TDD-CATALOG-NEW-CASE-012] every OpenSpec Scenario maps to a stable regression case", async () => {
  const scenarios = await readSpecScenarios();
  const mapped = new Map(regressionCases
    .filter((entry) => entry.kind === "scenario")
    .map((entry) => [key(entry), entry.id]));
  const missing = scenarios.filter((scenario) => !mapped.has(key(scenario)));
  assert.deepEqual(missing, []);
  assert.equal(mapped.size, scenarios.length);
  assert.equal(scenarios.length, 70);
});

test("[TDD-CROSS-LAYER-MAPPING-014] multi-layer cases retain one executor per declared boundary", () => {
  const entries = regressionCases.filter(({ layers }) => layers.length > 1);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.deepEqual(entry.executors.map(({ layer }) => layer), entry.layers, entry.id);
    assert.equal(new Set(entry.executors.map(({ id }) => id)).size, entry.layers.length, entry.id);
  }
});
