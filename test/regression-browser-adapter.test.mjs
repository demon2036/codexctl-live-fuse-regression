import test from "node:test";
import assert from "node:assert/strict";
import { browserReportToCaseResults } from "../regression/browser-adapter.mjs";
import { validateRegressionSummary } from "../regression/result-schema.mjs";

function report(status = "pass") {
  return {
    schema: "codexctl-browser-regression/1",
    browser: "Chrome",
    status,
    cases: [{ id: "WALLPAPER-BOTTOM-COVERAGE-002", status }],
    cleanup: { profileRemoved: true, processExited: true },
    metrics: { wallpaperStress: {
      layoutReads: 0, mutationRecords: 0, observers: 0, reconciles: 0, timers: 0,
    } },
  };
}

function summary(cases, status) {
  const counts = { blocked: 0, fail: 0, invalid: 0, pass: 0, unverified: 0 };
  for (const entry of cases) counts[entry.status] += 1;
  return {
    schema: "codexctl-regression-summary/1",
    runId: "11111111-2222-4333-8444-555555555555",
    revision: "a".repeat(40),
    dirty: false,
    status,
    startedAt: "2026-08-27T00:00:00.000Z",
    completedAt: "2026-08-27T00:00:01.000Z",
    environment: {
      appVersion: "fixture", arch: "arm64", chromiumVersion: "fixture",
      cliVersion: "fixture", nodeVersion: "22", os: "darwin",
    },
    ownership: { appPids: [], ports: [], profileId: "browser-fixture" },
    counts,
    cases,
    cleanup: { orphans: [], status: "pass" },
  };
}

test("browser adapter maps a real L3 catalog case into the audited result schema", () => {
  const cases = browserReportToCaseResults(report());
  assert.deepEqual(validateRegressionSummary(summary(cases, "pass")), []);
  assert.equal(cases[0].id, "WALLPAPER-BOTTOM-COVERAGE-002");
  assert.equal(cases[0].metrics.observerCount, 0);
});

test("browser adapter preserves Red status and rejects unknown or unclean reports", () => {
  const failed = browserReportToCaseResults(report("fail"));
  assert.equal(failed[0].status, "fail");
  assert.equal(failed[0].reasonCode, "browser-assertion-failed");
  const unknown = report();
  unknown.cases[0].id = "UNKNOWN-BROWSER-999";
  assert.throws(() => browserReportToCaseResults(unknown), /未知 L3 case/);
  const dirty = report();
  dirty.cleanup.processExited = false;
  assert.throws(() => browserReportToCaseResults(dirty), /cleanup/);
});
