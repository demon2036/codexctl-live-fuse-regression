import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildPerformanceComponentSummary,
  performanceComponentNames,
  resolvePerformanceComponent,
} from "../regression/performance-components.mjs";

test("component CPU diagnostics isolate controls and wallpaper with exact module flags", () => {
  assert.deepEqual(performanceComponentNames(), ["controls", "wallpaper"]);
  assert.deepEqual(resolvePerformanceComponent("controls"), {
    modules: { context: true, prompt: true, wallpaper: false },
    phases: ["input", "stream"],
  });
  assert.deepEqual(resolvePerformanceComponent("wallpaper"), {
    modules: { context: false, prompt: false, wallpaper: true },
    phases: ["input", "stream"],
  });
  assert.throws(() => resolvePerformanceComponent("combined"), /Unknown performance component/);
});

test("component summary is revision-bound and strips raw CPU samples", () => {
  const summary = buildPerformanceComponentSummary({
    component: "wallpaper",
    cpu: {
      attemptCount: 1,
      attemptStatuses: ["pass"],
      budgets: {},
      failures: [],
      runs: [{ privatePath: "/Users/private", raw: [99] }],
      status: "pass",
      summary: {},
    },
    source: { dirty: false, revision: "a".repeat(40) },
  });
  assert.equal(summary.schema, "codexctl-performance-component/1");
  assert.equal(summary.status, "pass");
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.throws(() => buildPerformanceComponentSummary({
    component: "wallpaper", cpu: { status: "pass" },
    source: { dirty: false, revision: "stale" },
  }), /revision/);
});

test("component CPU gate permits one bounded invalid resample", async () => {
  const source = await fs.readFile(new URL(
    "../scripts/performance-component-regression.mjs", import.meta.url,
  ), "utf8");
  assert.match(source, /maxAttempts:\s*2/);
  assert.doesNotMatch(source, /maxAttempts:\s*[3-9]/);
});
