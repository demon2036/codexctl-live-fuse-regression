import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EXTERNAL_CPU_POINTS,
  cpuPercentDelta,
  parseLinuxProcStat,
  sampleCpuSegment,
  systemCpuPercentDelta,
} from "../regression/cpu-sampler.mjs";

test("Linux /proc CPU parser preserves clock-tick precision and parenthesized names", () => {
  const stat = "321 (ChatGPT Renderer (GPU)) S 1 2 3 4 5 6 7 8 9 10 125 25 0 0 0";
  assert.deepEqual(parseLinuxProcStat(stat, 100), { cpuSeconds: 1.5, pid: 321 });
  assert.equal(parseLinuxProcStat("malformed", 100), null);
  assert.equal(parseLinuxProcStat(stat, 0), null);
});

test("CPU delta aggregates main, renderer, other, and total percentages", () => {
  const before = [
    { cpuSeconds: 1, kind: "main", pid: 1 },
    { cpuSeconds: 2, kind: "renderer", pid: 2 },
    { cpuSeconds: 3, kind: "other", pid: 3 },
  ];
  const after = [
    { cpuSeconds: 1.1, kind: "main", pid: 1 },
    { cpuSeconds: 2.2, kind: "renderer", pid: 2 },
    { cpuSeconds: 3.05, kind: "other", pid: 3 },
  ];
  assert.deepEqual(cpuPercentDelta(before, after, 1000), {
    main: 10, other: 5, renderer: 20, total: 35,
  });
});

test("bounded sampler retains raw intervals and returns median/p95", async () => {
  const snapshots = [0, 0.01, 0.03, 0.06].map((cpuSeconds) => [
    { cpuSeconds, kind: "main", pid: 1 },
  ]);
  let now = 0;
  const report = await sampleCpuSegment({
    durationMs: 300,
    intervalMs: 100,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    snapshot: async () => snapshots.shift(),
  });
  assert.equal(report.status, "pass");
  assert.equal(report.raw.length, 3);
  assert.equal(report.summary.total.p50, 20);
  assert.equal(report.summary.total.p95, 30);
});

test("non-monotonic CPU identity and too few samples are invalid", async () => {
  let now = 0;
  const values = [1, 0.5].map((cpuSeconds) => [{ cpuSeconds, kind: "main", pid: 1 }]);
  const report = await sampleCpuSegment({
    durationMs: 100, intervalMs: 100, now: () => now,
    sleep: async (ms) => { now += ms; }, snapshot: async () => values.shift(),
  });
  assert.equal(report.status, "invalid");
});

test("system CPU delta reports total busy percentage points across cores", () => {
  assert.ok(MAX_EXTERNAL_CPU_POINTS >= 75);
  const before = [0, 1].map(() => ({ user: 100, nice: 0, sys: 50, idle: 850, irq: 0 }));
  const after = [0, 1].map(() => ({ user: 130, nice: 0, sys: 70, idle: 900, irq: 0 }));
  assert.equal(systemCpuPercentDelta(before, after), 100);
});

test("bounded sampler invalidates external load without changing product CPU budget", async () => {
  const owned = [0, 0.01, 0.02, 0.03].map((cpuSeconds) => [
    { cpuSeconds, kind: "main", pid: 1 },
  ]);
  const systems = [0, 1, 2, 3].map((step) => [
    { user: step * 90, nice: 0, sys: 0, idle: step * 10, irq: 0 },
  ]);
  let now = 0;
  const report = await sampleCpuSegment({
    durationMs: 300,
    intervalMs: 100,
    maximumExternalCpu: 50,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    snapshot: async () => owned.shift(),
    systemSnapshot: async () => systems.shift(),
  });
  assert.equal(report.status, "invalid");
  assert.equal(report.reasonCode, "high-external-load");
  assert.ok(report.externalP95 > 50);
  assert.equal(report.summary.total.p95, 10);
});
