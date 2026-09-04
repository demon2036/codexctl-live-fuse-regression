import test from "node:test";
import assert from "node:assert/strict";
import * as evidence from "../regression/performance-evidence.mjs";

const { compactCpuEvidence } = evidence;

test("CPU artifact keeps diagnostic aggregates without raw samples", () => {
  const result = compactCpuEvidence({
    budgets: { input: {
      kinds: {
        main: { failures: [], status: "pass" },
        renderer: { failures: ["CPU p95 exceeded budget"], status: "fail" },
      },
      status: "fail",
    } },
    failures: ["cpu-budget-input"],
    status: "fail",
    summary: {
      input: {
        injected: {
          max: 17, p50: 12, p95: 16, rawValues: [[10, 17]], values: [12],
          kinds: { main: { max: 3, p50: 2, p95: 3 }, renderer: { max: 14, p50: 10, p95: 13 } },
          work: { taskDurationMs: { max: 22, p50: 20, p95: 21, values: [20, 21] } },
        },
        official: {
          max: 14, p50: 9, p95: 11, rawValues: [[8, 14]], values: [9],
          kinds: { main: { max: 2, p50: 1, p95: 2 }, renderer: { max: 12, p50: 8, p95: 9 } },
        },
      },
    },
  });
  assert.deepEqual(result, {
    attemptCount: null,
    attemptStatuses: [],
    budgets: { input: {
      kinds: { main: "pass", renderer: "fail" }, status: "fail",
    } },
    failures: ["cpu-budget-input"],
    invalidReasonCodes: [],
    measurements: {
      input: {
        injected: {
          max: 17, p50: 12, p95: 16,
          kinds: {
            main: { max: 3, p50: 2, p95: 3 },
            renderer: { max: 14, p50: 10, p95: 13 },
          },
          work: { taskDurationMs: { max: 22, p50: 20, p95: 21 } },
        },
        official: {
          max: 14, p50: 9, p95: 11,
          kinds: {
            main: { max: 2, p50: 1, p95: 2 },
            renderer: { max: 12, p50: 8, p95: 9 },
          },
        },
      },
    },
    status: "fail",
  });
  assert.doesNotMatch(JSON.stringify(result), /rawValues|values/);
});

test("missing CPU evidence is invalid rather than a false pass", () => {
  assert.deepEqual(compactCpuEvidence(null), {
    attemptCount: null, attemptStatuses: [], budgets: {},
    failures: ["cpu-result-missing"], invalidReasonCodes: [], measurements: {}, status: "invalid",
  });
});

test("CPU artifact reports bounded invalid-attempt reasons without raw samples", () => {
  const result = compactCpuEvidence({
    attemptCount: 2,
    attempts: [
      { failures: ["cpu-stability-stream-renderer"], status: "invalid" },
      { failures: [], status: "pass" },
    ],
    attemptStatuses: ["invalid", "pass"],
    budgets: {}, failures: [], status: "pass", summary: {},
  });
  assert.deepEqual(result.invalidReasonCodes, ["cpu-stability-stream-renderer"]);
  assert.doesNotMatch(JSON.stringify(result), /raw/);
});

test("interaction evidence exposes only stable invalid reason codes", () => {
  assert.equal(typeof evidence.compactInteractionEvidence, "function");
  const result = evidence.compactInteractionEvidence({
    budgets: {}, status: "invalid",
    sampler: {
      attempts: 2, completedGroups: 1,
      rawSamples: [
        { phase: "warmup", reasonCode: "warmup" },
        { phase: "sample", reasonCode: "system-high-load" },
        { phase: "sample", reasonCode: "group-system-high-load" },
        { phase: "sample", reasonCode: "/Users/private" },
      ],
    },
  }, 0);
  assert.deepEqual(result, {
    attempts: 2, budgets: {}, completedGroups: 1, index: 0,
    invalidReasonCodes: ["system-high-load"], status: "invalid",
  });
});
