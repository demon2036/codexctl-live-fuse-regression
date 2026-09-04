import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_CPU_PHASES,
  evaluatePlatformPerformance,
  samplePlatformCpuSegment,
} from "../regression/platform-performance.mjs";

function segment(total) {
  const sample = (value) => ({ main: value / 4, other: value / 4,
    renderer: value / 2, total: value });
  return {
    actionResult: { longTaskCount: 0 },
    raw: [sample(total), sample(total + 0.5), sample(total)],
    status: "pass",
    summary: {
      main: { p95: (total + 0.5) / 4 },
      renderer: { p95: (total + 0.5) / 2 },
      total: { p95: total + 0.5 },
    },
  };
}

function run(base, overrides = {}) {
  return {
    benchmark: {
      input: { maxMs: base + 3, p95Ms: base + 1 },
      longTasks: { samples: 0 },
      restored: true,
      scroll: { maxMs: base + 4, p95Ms: base + 2 },
    },
    cpu: Object.fromEntries(PLATFORM_CPU_PHASES.map((phase) => [phase, segment(base)])),
    launchMs: 1000 + base,
    reasonCodes: [],
    status: "pass",
    visibleMs: base,
    ...overrides,
  };
}

test("actual platform official/injected/recovery evidence passes every shared budget", () => {
  const result = evaluatePlatformPerformance({
    official: run(5), injected: run(6), recovery: run(7),
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(Object.keys(result.budgets).sort(), [
    "cpu-idle-main", "cpu-idle-renderer", "cpu-input-main", "cpu-input-renderer",
    "cpu-scroll-main", "cpu-scroll-renderer", "cpu-stream-main", "cpu-stream-renderer",
    "input", "scroll", "startup",
  ]);
  assert.ok(Object.values(result.budgets).every((status) => status === "pass"));
});

test("platform CPU budgets ignore diagnostic helper totals and constrain main/renderer", () => {
  const injected = run(6);
  for (const segmentValue of Object.values(injected.cpu)) {
    segmentValue.raw = segmentValue.raw.map((sample) => ({
      ...sample, other: 200, total: sample.main + sample.renderer + 200,
    }));
    segmentValue.summary.total.p95 = 220;
  }
  assert.equal(evaluatePlatformPerformance({
    official: run(5), injected, recovery: run(7),
  }).status, "pass");
});

test("platform long-task gate only rejects tasks added above the official baseline", () => {
  const official = run(5);
  const injected = run(6);
  const recovery = run(7);
  for (const candidate of [official, injected, recovery]) {
    candidate.benchmark.longTasks.samples = 2;
    candidate.cpu.input.actionResult.longTaskCount = 1;
  }
  assert.equal(evaluatePlatformPerformance({ official, injected, recovery }).status, "pass");

  injected.benchmark.longTasks.samples = 3;
  injected.cpu.input.actionResult.longTaskCount = 2;
  const result = evaluatePlatformPerformance({ official, injected, recovery });
  assert.ok(result.failures.includes("run-1-long-task"));
  assert.ok(result.failures.includes("run-1-input-long-task"));
});

test("platform CPU retries one invalid sample and preserves its reason", async () => {
  const values = [
    { reasonCode: "invalid-sample", status: "invalid" },
    { raw: [{ main: 1 }], status: "pass", summary: {} },
  ];
  const result = await samplePlatformCpuSegment(async () => values.shift());
  assert.equal(result.status, "pass");
  assert.equal(result.attemptCount, 2);
  assert.deepEqual(result.attemptReasonCodes, ["invalid-sample"]);
  assert.deepEqual(result.attempts.map(({ status }) => status), ["invalid", "pass"]);
});

test("actual platform performance preserves unavailable interactive shell as unverified", () => {
  const result = evaluatePlatformPerformance({
    official: run(5),
    injected: run(6, { reasonCodes: ["interactive-shell-unavailable"], status: "unverified" }),
    recovery: run(7),
  });
  assert.equal(result.status, "unverified");
  assert.deepEqual(result.reasonCodes, ["run-1-interactive-shell-unavailable"]);
  const noisy = run(6);
  noisy.cpu.stream = { reasonCode: "high-external-load", status: "invalid" };
  assert.deepEqual(evaluatePlatformPerformance({
    official: run(5), injected: noisy, recovery: run(7),
  }).reasonCodes, ["run-1-stream-high-external-load"]);
});

test("actual platform performance rejects budget, missing evidence, and long-task failures", () => {
  const slow = run(40);
  slow.benchmark.longTasks.samples = 1;
  slow.cpu.stream.actionResult.longTaskCount = 1;
  const result = evaluatePlatformPerformance({
    official: run(5), injected: slow, recovery: run(5),
  });
  assert.equal(result.status, "fail");
  for (const code of ["budget-input", "budget-scroll", "budget-cpu-idle-main",
    "run-1-long-task", "run-1-stream-long-task"]) {
    assert.ok(result.failures.includes(code), code);
  }
  assert.deepEqual(evaluatePlatformPerformance({
    official: run(5), injected: run(6), recovery: null,
  }).failures, ["performance-evidence-incomplete"]);
});
