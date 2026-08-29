import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REGRESSION_EXECUTORS } from "../regression/executors.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRIES = [
  "fast-regression.mjs", "app-regression.mjs", "browser-regression.mjs",
  "performance-component-regression.mjs", "performance-regression.mjs",
  "platform-regression.mjs", "regression.mjs",
];

test("[TDD-FAST-GATE-009] every regression command has side-effect-free help", () => {
  for (const name of ENTRIES) {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", name), "--help"], {
      encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.match(result.stdout, /Usage:/);
  }
});

test("command selection rejects an unknown case before any runner starts", () => {
  for (const name of ["fast-regression.mjs", "app-regression.mjs", "browser-regression.mjs", "platform-regression.mjs", "regression.mjs"]) {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", name), "--case", "UNKNOWN-CASE-999",
    ], { encoding: "utf8", timeout: 5000 });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, /Unknown regression case/);
  }
});

test("package commands and catalog executors use the same public entrypoints", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  for (const name of ["test:fast", "test:app", "test:platform", "test:regression"]) {
    assert.equal(typeof pkg.scripts[name], "string");
  }
  for (const executor of REGRESSION_EXECUTORS) {
    const scriptName = executor.command.replace(/^npm run /, "");
    assert.equal(executor.command, `npm run ${scriptName}`);
    assert.equal(typeof pkg.scripts[scriptName], "string", executor.id);
  }
});
