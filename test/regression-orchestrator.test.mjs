import test from "node:test";
import assert from "node:assert/strict";
import { aggregateRun, runSelectedCases } from "../regression/orchestrator.mjs";

function result(id, status = "pass", reasonCode = null) {
  return { id, status, reasonCode };
}

test("orchestrator reports pass only when every selected case and cleanup pass", () => {
  assert.deepEqual(
    aggregateRun({ caseResults: [result("A-001"), result("B-001")], cleanup: { status: "pass" } }),
    {
      counts: { blocked: 0, fail: 0, invalid: 0, pass: 2, unverified: 0 },
      exitCode: 0,
      status: "pass",
    },
  );
});

for (const [status, exitCode] of [
  ["fail", 1],
  ["unverified", 2],
  ["blocked", 3],
  ["invalid", 4],
]) {
  test(`orchestrator cannot hide ${status} behind passing cases`, () => {
    const actual = aggregateRun({
      caseResults: [result("A-001"), result("B-001", status, `${status}-fixture`)],
      cleanup: { status: "pass" },
    });
    assert.equal(actual.status, status);
    assert.equal(actual.exitCode, exitCode);
    assert.equal(actual.counts[status], 1);
  });
}

test("cleanup failure always makes the run fail", () => {
  assert.deepEqual(
    aggregateRun({ caseResults: [result("A-001")], cleanup: { status: "fail" } }),
    {
      counts: { blocked: 0, fail: 0, invalid: 0, pass: 1, unverified: 0 },
      exitCode: 1,
      status: "fail",
    },
  );
});

test("invalid is reported only after its bounded attempts are exhausted", () => {
  assert.equal(aggregateRun({
    caseResults: [{ ...result("A-001", "invalid", "noisy-baseline"), attempts: 1, maxAttempts: 2 }],
    cleanup: { status: "pass" },
  }).status, "blocked");
  assert.equal(aggregateRun({
    caseResults: [{ ...result("A-001", "invalid", "noisy-baseline"), attempts: 2, maxAttempts: 2 }],
    cleanup: { status: "pass" },
  }).status, "invalid");
});

test("runner selects cases, dispatches declared layers once, and preserves catalog order", async () => {
  const calls = [];
  const cases = [
    { id: "A-001", layers: ["L1", "L3"] },
    { id: "B-001", layers: ["L2"] },
    { id: "C-001", layers: ["L1"] },
  ];
  const run = await runSelectedCases({
    cases,
    cleanup: async () => ({ status: "pass" }),
    executors: {
      L1: async (entry) => { calls.push(`${entry.id}:L1`); return result(entry.id); },
      L2: async (entry) => { calls.push(`${entry.id}:L2`); return result(entry.id); },
      L3: async (entry) => { calls.push(`${entry.id}:L3`); return result(entry.id); },
    },
    selectedIds: new Set(["A-001", "C-001"]),
  });
  assert.deepEqual(calls, ["A-001:L1", "A-001:L3", "C-001:L1"]);
  assert.deepEqual(run.caseResults.map(({ id }) => id), ["A-001", "C-001"]);
  assert.equal(run.status, "pass");
});

test("missing executor and thrown executor become explicit fail results", async () => {
  const run = await runSelectedCases({
    cases: [
      { id: "A-001", layers: ["L1"] },
      { id: "B-001", layers: ["L2"] },
    ],
    cleanup: async () => ({ status: "pass" }),
    executors: { L1: async () => { throw new Error("fixture boom"); } },
  });
  assert.deepEqual(run.caseResults.map(({ reasonCode }) => reasonCode), [
    "executor-threw",
    "missing-executor",
  ]);
  assert.equal(run.status, "fail");
});
