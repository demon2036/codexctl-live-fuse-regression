import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMacPlatformPerformance,
  evaluateMacPlatformSequence,
} from "../regression/macos-platform-sequence.mjs";

function run(pid, overrides = {}) {
  const cpuSegment = (value = 1) => ({
    raw: [{ total: value }, { total: value }],
    status: "pass",
    summary: { total: { p95: value } },
  });
  return {
    appServerCount: 1,
    appVersion: "26.820.60940",
    cleanup: { status: "pass" },
    cliVersion: "codex-cli 0.150.0",
    functionalArguments: [],
    launchMs: 1000,
    visibleMs: 200,
    native: {
      composer: { latenciesMs: Array(20).fill(4) },
      sessions: { latenciesMs: Array(20).fill(5) },
    },
    cpu: {
      idle: cpuSegment(), input: cpuSegment(), scroll: cpuSegment(), stream: cpuSegment(),
    },
    processId: pid,
    reasonCodes: [],
    remote: "connected",
    remoteDebugging: false,
    status: "pass",
    ...overrides,
  };
}

test("macOS platform sequence requires official, injected, and clean recovery process boundaries", () => {
  const result = evaluateMacPlatformSequence({
    official: run(101), injected: run(202), recovery: run(303),
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.performance.status, "pass");
  assert.equal(result.status, "pass");
});

test("macOS L5 performance applies startup, input, and scroll budgets to native samples", () => {
  const result = evaluateMacPlatformPerformance({
    official: run(101),
    injected: run(202, {
      launchMs: 1800,
      native: {
        composer: { latenciesMs: Array(20).fill(7) },
        sessions: { latenciesMs: Array(20).fill(5) },
      },
    }),
    recovery: run(303),
  });
  assert.equal(result.status, "fail");
  assert.ok(result.reasonCodes.includes("budget-startup"));
  assert.ok(result.reasonCodes.includes("budget-input"));
});

test("macOS L5 cannot pass when a declared native performance sample is absent", () => {
  const result = evaluateMacPlatformSequence({
    official: run(101), injected: run(202, { native: {} }), recovery: run(303),
  });
  assert.equal(result.status, "fail");
  assert.ok(result.reasonCodes.includes("performance-performance-evidence-incomplete"));
});

test("macOS L5 preserves high external load as unverified instead of a false CPU pass", () => {
  const injected = run(202);
  injected.cpu.stream = { reasonCode: "high-external-load", status: "invalid" };
  const result = evaluateMacPlatformSequence({
    official: run(101), injected, recovery: run(303),
  });
  assert.equal(result.status, "unverified");
  assert.ok(result.reasonCodes.includes("performance-run-1-stream-high-external-load"));
});

test("macOS sequence propagates unverified permissions without faking a pass", () => {
  const result = evaluateMacPlatformSequence({
    official: run(101),
    injected: run(202, { reasonCodes: ["permission-accessibility"], status: "unverified" }),
    recovery: run(303),
  });
  assert.equal(result.status, "unverified");
  assert.ok(result.reasonCodes.includes("injected-permission-accessibility"));
});

test("macOS sequence fails duplicate PID, Remote, cleanup, and version drift", () => {
  const result = evaluateMacPlatformSequence({
    official: run(101),
    injected: run(101, { remote: "disconnected" }),
    recovery: run(303, { appVersion: "different", cleanup: { status: "fail" } }),
  });
  assert.equal(result.status, "fail");
  for (const reason of [
    "app-version-mismatch", "injected-remote", "recovery-cleanup", "recovery-process-boundary",
  ]) assert.ok(result.reasonCodes.includes(reason));
});
