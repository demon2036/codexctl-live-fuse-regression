import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as appCpu from "../regression/app-cpu-performance.mjs";
import { cpuSummaryMetrics } from "../regression/electron-app-adapter.mjs";
import {
  RENDERER_INPUT_PROFILE,
  RENDERER_STREAM_PROFILE,
} from "../regression/renderer-segment-workload.mjs";

function run(mode, base) {
  const cpu = Object.fromEntries(appCpu.CPU_PHASES.map((phase) => [phase, {
    actionResult: phase === "idle" ? null : {
      layoutDurationMs: base + 1, longTaskCount: 0, scriptDurationMs: base + 2,
      styleDurationMs: base + 3, taskDurationMs: base + 4,
    },
    raw: [{ main: base / 4, other: base / 4, renderer: base / 2, total: base },
      { main: base / 4, other: base / 4, renderer: base / 2, total: base + 0.5 }],
    status: "pass",
  }]));
  return {
    cpu,
    mode,
    result: {
      cleanup: { status: "pass" }, metrics: { observerCount: 0, timerCount: 0, workerCount: 0 },
      processTree: { controllerCount: 0 }, status: "pass",
    },
  };
}

const valid = () => appCpu.CPU_AB_ORDER.map((mode) => run(mode, mode === "official" ? 1 : 2));

test("CPU A/B balances forward and reverse groups", () => {
  assert.deepEqual(appCpu.CPU_AB_ORDER, [
    "official", "injected", "injected", "official",
    "injected", "official", "official", "injected",
  ]);
});

test("idle/input/scroll/stream CPU A/B passes +2/+5 point budgets", () => {
  const result = appCpu.evaluateAppCpuPerformance(valid());
  assert.equal(result.status, "pass");
  assert.deepEqual(Object.values(result.budgets).map(({ status }) => status),
    ["pass", "pass", "pass", "pass"]);
});

test("CPU regression, long task, controller, and residual resource fail", () => {
  for (const mutate of [
    (runs) => { for (const run of runs.filter(({ mode }) => mode === "injected")) {
      run.cpu.idle.raw = [20, 21].map((renderer) => ({
        main: 0, other: 0, renderer, total: renderer,
      }));
    } },
    (runs) => { runs[1].cpu.input.actionResult.longTaskCount = 1; },
    (runs) => { runs[1].result.processTree.controllerCount = 1; },
    (runs) => { runs[1].result.metrics.timerCount = 1; },
  ]) {
    const runs = valid();
    mutate(runs);
    assert.equal(appCpu.evaluateAppCpuPerformance(runs).status, "fail");
  }
});

test("high external load makes CPU evidence invalid instead of blaming the product", () => {
  const runs = valid();
  runs[2].cpu.stream = { raw: [], reasonCode: "high-external-load", status: "invalid" };
  const result = appCpu.evaluateAppCpuPerformance(runs);
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.failures, ["cpu-stream-2"]);
  assert.deepEqual(cpuSummaryMetrics({ idle: { status: "invalid" } }), {
    cpuMedian: 0, cpuP95: 0,
  });
});

test("stream CPU workload has a fixed sample window and a bounded live DOM", () => {
  assert.ok(RENDERER_STREAM_PROFILE.durationMs >= 10_000);
  assert.ok(RENDERER_STREAM_PROFILE.durationMs < 15_000);
  assert.ok(RENDERER_STREAM_PROFILE.maxNodes >= 400);
  assert.ok(RENDERER_STREAM_PROFILE.maxNodes <= 1200);
  assert.ok(RENDERER_STREAM_PROFILE.nodesPerBatch >= 1);
  assert.ok(RENDERER_STREAM_PROFILE.nodesPerBatch <= 4);
});

test("stream CPU workload targets both the fixture and real App thread surface", async () => {
  const source = await fs.readFile(new URL(
    "../regression/renderer-segment-workload.mjs", import.meta.url,
  ), "utf8");
  assert.match(source, /getElementById\("messages"\)/);
  assert.match(source, /querySelector\("\.thread-scroll-container"\)/);
  assert.match(source, /if \(!surface\) return false/);
});

test("input CPU workload yields enough 500ms intervals for p95 to differ from max", () => {
  const characterCount = "codexctl-segment-0123456789".length * RENDERER_INPUT_PROFILE.repeats;
  const scheduledMs = characterCount * RENDERER_INPUT_PROFILE.intervalMs;
  assert.ok(scheduledMs >= 10_000);
  assert.ok(scheduledMs < 15_000);
});

test("full CPU runner gives the owned fixture enough time for every bounded phase", async () => {
  const source = await fs.readFile(new URL(
    "../regression/app-cpu-performance.mjs", import.meta.url,
  ), "utf8");
  assert.match(source, /fixtureDeadlineMs:\s*120_000/);
  const worstCaseMs = 30_000 + 15_000 * 3;
  assert.ok(120_000 >= worstCaseMs + 30_000);
});

test("CPU median compares complete O-I-I-O segment means instead of temporal ramp phase", () => {
  const runs = valid();
  for (const run of runs) {
    const values = run.mode === "official" ? [0, 100, 100, 0] : [40, 60, 60, 40];
    for (const phase of appCpu.CPU_PHASES) run.cpu[phase].raw = values.map((total) => ({
      main: 0, other: 0, renderer: total, total,
    }));
  }
  const result = appCpu.evaluateAppCpuPerformance(runs);
  assert.equal(result.status, "pass");
  assert.equal(result.summary.stream.official.p50, 50);
  assert.equal(result.summary.stream.injected.p50, 50);
  assert.deepEqual(result.summary.stream.official.rawValues[0], [0, 100, 100, 0]);
});

test("CPU median averages the two central run means instead of selecting the lower run", () => {
  const runs = valid();
  for (const [index, run] of runs.entries()) {
    const total = [2, 4, 8, 6, 10, 12, 16, 14][index];
    for (const phase of appCpu.CPU_PHASES) run.cpu[phase].raw = [
      { main: 0, other: 0, renderer: total, total },
      { main: 0, other: 0, renderer: total, total },
    ];
  }
  const result = appCpu.evaluateAppCpuPerformance(runs);
  assert.equal(result.summary.stream.official.p50, 9);
  assert.equal(result.summary.stream.injected.p50, 9);
});

test("focused CPU diagnostics select bounded phases and retain renderer work", () => {
  assert.equal(typeof appCpu.normalizeCpuPhases, "function");
  assert.deepEqual(appCpu.normalizeCpuPhases(["stream"]), ["stream"]);
  assert.throws(() => appCpu.normalizeCpuPhases([]), /CPU phases/);
  assert.throws(() => appCpu.normalizeCpuPhases(["stream", "stream"]), /CPU phases/);
  const result = appCpu.evaluateAppCpuPerformance(valid(), { phases: ["stream"] });
  assert.equal(result.status, "pass");
  assert.deepEqual(Object.keys(result.summary), ["stream"]);
  assert.equal(result.summary.stream.injected.work.taskDurationMs.p50, 6);
});

test("CPU group conclusion flips invalidate evidence before aggregate budgets decide", () => {
  const runs = valid();
  for (const index of [1, 2]) {
    for (const sample of runs[index].cpu.stream.raw) {
      sample.renderer = 3;
      sample.total = 3;
    }
  }
  const result = appCpu.evaluateAppCpuPerformance(runs, { phases: ["stream"] });
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.failures, ["cpu-stability-stream-renderer"]);
  assert.equal(result.summary.stream.stability.status, "mixed");
  assert.deepEqual(result.summary.stream.stability.kinds.renderer.statuses, ["fail", "pass"]);
});

test("CPU gate follows the spec's main and renderer boundary", () => {
  const runs = valid();
  for (const run of runs.filter(({ mode }) => mode === "injected")) {
    for (const sample of run.cpu.stream.raw) {
      sample.other = 30;
      sample.total = sample.main + sample.renderer + sample.other;
    }
  }
  const result = appCpu.evaluateAppCpuPerformance(runs, { phases: ["stream"] });
  assert.equal(result.status, "pass");
  assert.deepEqual(Object.keys(result.budgets.stream.kinds), ["main", "renderer"]);
});

test("CPU invalid resampling is bounded and never retries a product failure", async () => {
  assert.equal(typeof appCpu.runBoundedCpuAttempts, "function");
  let calls = 0;
  const recovered = await appCpu.runBoundedCpuAttempts(async () => {
    calls += 1;
    return { status: calls === 1 ? "invalid" : "pass" };
  });
  assert.equal(recovered.result.status, "pass");
  assert.deepEqual(recovered.statuses, ["invalid", "pass"]);
  const failed = await appCpu.runBoundedCpuAttempts(async () => ({ status: "fail" }));
  assert.deepEqual(failed.statuses, ["fail"]);
});
