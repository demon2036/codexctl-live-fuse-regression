import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAppPerformance,
  evaluatePerformanceRepeatability,
} from "../regression/app-performance.mjs";

function latencies(p95, max) {
  return [...Array(18).fill(Math.max(0, p95 - 1)), p95, max];
}

function interactionRecord(mode, inputP95, inputMax, scrollP95, scrollMax) {
  return {
    included: true,
    interactions: {
      inputLatencyMs: latencies(inputP95, inputMax),
      scrollLatencyMs: latencies(scrollP95, scrollMax),
    },
    mode,
  };
}

function sampler(overrides = {}) {
  const metric = (p50, p95, max = p95) => ({ p50, p95, max, values: [p50, p95] });
  return {
    rawSamples: [
      interactionRecord("official", 6, 10, 8, 12),
      interactionRecord("injected", 7, 12, 9, 14),
      interactionRecord("injected", 7, 12, 9, 14),
      interactionRecord("official", 6, 10, 8, 12),
    ],
    status: "pass",
    summary: {
      official: {
        launchMs: metric(1000, 1100), inputP95Ms: metric(5, 6), inputMaxMs: metric(8, 10),
        scrollP95Ms: metric(7, 8), scrollMaxMs: metric(10, 12), visibleMs: metric(0, 0),
      },
      injected: {
        launchMs: metric(1200, 1250), inputP95Ms: metric(6, 7), inputMaxMs: metric(10, 12),
        scrollP95Ms: metric(8, 9), scrollMaxMs: metric(12, 14), visibleMs: metric(120, 180),
      },
    },
    ...overrides,
  };
}

test("valid startup, input, and scroll A/B metrics pass centralized budgets", () => {
  const result = evaluateAppPerformance(sampler());
  assert.equal(result.status, "pass");
  assert.deepEqual(Object.fromEntries(Object.entries(result.budgets)
    .map(([key, value]) => [key, value.status])), {
    input: "pass", scroll: "pass", startup: "pass",
  });
});

test("invalid baseline and each exceeded budget cannot pass", () => {
  assert.equal(evaluateAppPerformance(sampler({ status: "invalid" })).status, "invalid");
  for (const mutate of [
    (value) => { value.summary.injected.launchMs.p50 = 1751; },
    (value) => { value.summary.injected.visibleMs.p95 = 751; },
    (value) => {
      value.summary.injected.inputP95Ms.p95 = 20;
      value.rawSamples.filter(({ mode }) => mode === "injected")
        .forEach((entry) => { entry.interactions.inputLatencyMs = latencies(20, 20); });
    },
    (value) => {
      value.summary.injected.scrollMaxMs.max = 40;
      const samples = value.rawSamples.find(({ mode }) => mode === "injected")
        .interactions.scrollLatencyMs;
      samples[samples.length - 1] = 40;
    },
  ]) {
    const value = sampler();
    mutate(value);
    assert.equal(evaluateAppPerformance(value).status, "fail");
  }
});

test("interaction p95 pools renderer events instead of taking the maximum run p95", () => {
  const value = sampler();
  value.summary.injected.inputP95Ms.p95 = 12;
  value.summary.official.inputP95Ms.p95 = 9.7;
  assert.equal(evaluateAppPerformance(value).budgets.input.status, "pass");
});

test("missing, short, or non-finite interaction distributions are invalid", () => {
  for (const invalid of [undefined, [1, 2, 3, 4], [1, 2, 3, 4, Number.NaN]]) {
    const value = sampler();
    value.rawSamples[0].interactions.inputLatencyMs = invalid;
    assert.equal(evaluateAppPerformance(value).budgets.input.status, "invalid");
  }
});

test("two complete runs must retain the same passing conclusion", () => {
  const first = { ...evaluateAppPerformance(sampler()), sampler: { status: "pass" } };
  const second = structuredClone(first);
  assert.deepEqual(evaluatePerformanceRepeatability([first, second]), {
    failures: [], status: "pass",
  });
  second.budgets.input.status = "fail";
  second.status = "fail";
  assert.deepEqual(evaluatePerformanceRepeatability([first, second]).failures,
    ["repeat-non-pass", "repeat-conclusion-flip"]);
});

test("interaction load uses the measured CPU interval instead of stale host load average", async () => {
  const { normalizedSystemCpuLoad } = await import("../regression/app-performance.mjs");
  assert.equal(typeof normalizedSystemCpuLoad, "function");
  const before = [0, 1].map(() => ({ user: 100, nice: 0, sys: 50, idle: 850, irq: 0 }));
  const after = [0, 1].map(() => ({ user: 130, nice: 0, sys: 70, idle: 900, irq: 0 }));
  assert.equal(normalizedSystemCpuLoad(before, after), 0.5);
  assert.equal(Number.isNaN(normalizedSystemCpuLoad(before, before.slice(1))), true);
});
