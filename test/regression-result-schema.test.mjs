import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRegressionSummary,
  validateRegressionSummary,
} from "../regression/result-schema.mjs";
import { resultIsCurrent, writeRegressionResults } from "../regression/results.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function validSummary() {
  return {
    schema: "codexctl-regression-summary/1",
    runId: "11111111-2222-4333-8444-555555555555",
    revision: "a".repeat(40),
    dirty: false,
    status: "pass",
    startedAt: "2026-08-27T00:00:00.000Z",
    completedAt: "2026-08-27T00:00:01.000Z",
    environment: {
      appVersion: "1.0.0",
      arch: "arm64",
      chromiumVersion: "138.0.0",
      cliVersion: "1.0.0",
      nodeVersion: "22.0.0",
      os: "darwin",
    },
    ownership: { appPids: [1234], ports: [43210], profileId: "profile" },
    counts: { blocked: 0, fail: 0, invalid: 0, pass: 1, unverified: 0 },
    cases: [{
      durationMs: 10,
      evidence: ["artifacts/case.json"],
      id: "FIXTURE-CASE-001",
      layer: "L1",
      metrics: { observerCount: 0, timerCount: 0 },
      platform: "all",
      reasonCode: null,
      status: "pass",
    }],
    cleanup: { orphans: [], status: "pass" },
  };
}

function messages(value) {
  return validateRegressionSummary(value).map((error) => error.message).join("\n");
}

test("result schema accepts only the complete allowlisted shape", () => {
  assert.deepEqual(validateRegressionSummary(validSummary()), []);
  assert.doesNotThrow(() => assertRegressionSummary(validSummary()));
  const incomplete = validSummary();
  delete incomplete.cleanup;
  assert.match(messages(incomplete), /缺少字段.*cleanup/);
});

test("[TDD-RESULT-NONPASS-021] result schema rejects credentials and private content fields", () => {
  for (const [field, value] of [
    ["token", "secret"],
    ["prompt", "private prompt body"],
    ["sessionBody", "private conversation"],
    ["env", { PATH: "/bin" }],
  ]) {
    const summary = validSummary();
    summary[field] = value;
    assert.match(messages(summary), new RegExp(`未知字段.*${field}`));
  }
});

test("result schema rejects machine-absolute evidence paths", () => {
  const summary = validSummary();
  summary.cases[0].evidence = ["/Users/example/private/result.json"];
  assert.match(messages(summary), /evidence.*相对路径/);
});

test("result schema rejects illegal statuses at summary and case level", () => {
  const summary = validSummary();
  summary.status = "success-ish";
  assert.match(messages(summary), /非法总体状态.*success-ish/);
  summary.status = "pass";
  summary.cases[0].status = "skipped";
  assert.match(messages(summary), /非法 case 状态.*skipped/);
});

test("[TDD-RESULT-SUCCESS-020] writer emits audited JSON, Markdown, metrics, and screenshot index", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-results-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const summary = validSummary();
  await writeRegressionResults({
    directory,
    metrics: { samples: [{ caseId: "FIXTURE-CASE-001", durationMs: 10 }] },
    screenshots: [{ caseId: "FIXTURE-CASE-001", file: "screenshots/fixture.png" }],
    summary,
  });
  const names = (await fs.readdir(directory)).sort();
  assert.deepEqual(names, ["metrics.json", "screenshots.json", "summary.json", "summary.md"]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "summary.json"), "utf8")), summary);
  assert.match(await fs.readFile(path.join(directory, "summary.md"), "utf8"), /总体状态：pass/);
});

test("[TDD-REVISION-CONSISTENCY-024] source or dirty changes invalidate old results", () => {
  const summary = validSummary();
  assert.equal(resultIsCurrent(summary, { dirty: false, revision: "a".repeat(40) }), true);
  assert.equal(resultIsCurrent(summary, { dirty: false, revision: "b".repeat(40) }), false);
  assert.equal(resultIsCurrent(summary, { dirty: true, revision: "a".repeat(40) }), false);
});
