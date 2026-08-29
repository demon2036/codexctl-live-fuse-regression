import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBudget, PERFORMANCE_BUDGETS } from "../regression/budgets.mjs";

function status(key, sample) {
  return evaluateBudget(key, sample).status;
}

test("[TDD-BUDGET-INDEPENDENT-005] the immutable budget registry exactly matches the approved spec", () => {
  assert.deepEqual(PERFORMANCE_BUDGETS, {
    "baseline-validity": { kind: "baseline" },
    cpu: { kind: "cpu", medianPoints: 2, p95Points: 5 },
    input: { kind: "interaction", maxDeltaMs: 16, p95AbsoluteMs: 2, p95Ratio: 1.15 },
    scroll: { kind: "interaction", maxDeltaMs: 16, p95AbsoluteMs: 2, p95Ratio: 1.15 },
    startup: { kind: "startup", medianDeltaMs: 750, visibleP95Ms: 750 },
    "startup-visible": { kind: "visible", p95Ms: 750 },
  });
  assert.ok(Object.isFrozen(PERFORMANCE_BUDGETS));
  assert.ok(Object.values(PERFORMANCE_BUDGETS).every(Object.isFrozen));
});

test("[PERFORMANCE-STARTUP-001] startup accepts the 750ms boundary and rejects an overrun", () => {
  const boundary = { baselineValid: true, injectedMedianMs: 1_750, officialMedianMs: 1_000,
    visibleP95Ms: 750 };
  assert.equal(status("startup", boundary), "pass");
  assert.equal(status("startup", { ...boundary, injectedMedianMs: 1_751 }), "fail");
  assert.equal(status("startup", { ...boundary, visibleP95Ms: 751 }), "fail");
});

test("[PERFORMANCE-INPUT-002] p95 uses the stricter relative or absolute noise allowance", () => {
  const small = { baselineValid: true, injectedMaxMs: 66, injectedP95Ms: 12,
    officialMaxMs: 50, officialP95Ms: 10 };
  assert.equal(status("input", small), "pass");
  assert.equal(status("input", { ...small, injectedP95Ms: 12.01 }), "fail");
  const large = { ...small, officialP95Ms: 100, injectedP95Ms: 115 };
  assert.equal(status("input", large), "pass");
  assert.equal(status("input", { ...large, injectedP95Ms: 115.01 }), "fail");
});

test("[PERFORMANCE-SCROLL-003] interaction max allows exactly 16ms", () => {
  const sample = { baselineValid: true, injectedMaxMs: 66, injectedP95Ms: 10,
    officialMaxMs: 50, officialP95Ms: 10 };
  assert.equal(status("scroll", sample), "pass");
  assert.equal(status("scroll", { ...sample, injectedMaxMs: 66.01 }), "fail");
});

test("[PERFORMANCE-CPU-004] CPU allows +2 median and +5 p95 percentage points", () => {
  const sample = { baselineValid: true, injectedMedian: 12, injectedP95: 25,
    officialMedian: 10, officialP95: 20 };
  assert.equal(status("cpu", sample), "pass");
  assert.equal(status("cpu", { ...sample, injectedMedian: 12.01 }), "fail");
  assert.equal(status("cpu", { ...sample, injectedP95: 25.01 }), "fail");
});

test("[PERFORMANCE-INVALID-BASELINE-005] invalid and non-finite baselines never pass", () => {
  assert.equal(status("startup", { baselineValid: false }), "invalid");
  assert.equal(status("input", { baselineValid: true, officialP95Ms: Number.NaN }), "invalid");
  assert.equal(status("baseline-validity", { baselineValid: false }), "invalid");
  assert.equal(status("baseline-validity", { baselineValid: true }), "pass");
});
