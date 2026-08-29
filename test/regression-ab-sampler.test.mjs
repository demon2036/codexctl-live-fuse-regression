import test from "node:test";
import assert from "node:assert/strict";
import { percentile, runABSampler } from "../regression/ab-sampler.mjs";

function sample(value, overrides = {}) {
  return {
    environment: {
      appVersion: "1", profileId: "fixture", remoteConnected: true, systemLoad: 0.2,
      ...overrides.environment,
    },
    metrics: { latencyMs: value },
  };
}

test("percentiles use sorted nearest-rank values", () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
});

test("sampler discards warmup and balances O-I-I-O / I-O-O-I", async () => {
  const calls = [];
  const report = await runABSampler({
    fields: ["latencyMs"], groups: 2, warmups: 1,
    async measure(context) {
      calls.push(`${context.phase}:${context.mode}`);
      return sample(context.mode === "official" ? calls.length : calls.length + 2);
    },
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(calls.slice(0, 2), ["warmup:official", "warmup:injected"]);
  assert.deepEqual(calls.slice(2), [
    "sample:official", "sample:injected", "sample:injected", "sample:official",
    "sample:injected", "sample:official", "sample:official", "sample:injected",
  ]);
  assert.equal(report.rawSamples.length, 10);
  assert.equal(report.rawSamples.filter(({ included }) => included).length, 8);
  assert.equal(report.summary.official.latencyMs.values.length, 4);
  assert.equal(report.summary.injected.latencyMs.values.length, 4);
});

test("[TDD-INVALID-SAMPLE-019] high load and outliers are invalid and only finitely resampled", async () => {
  let calls = 0;
  const report = await runABSampler({
    fields: ["latencyMs"], groups: 1, maxGroupAttempts: 2, warmups: 0,
    async measure({ groupAttempt, sampleIndex }) {
      calls += 1;
      if (groupAttempt === 1 && sampleIndex === 0) {
        return sample(10, { environment: { systemLoad: 0.95 } });
      }
      return sample(10 + sampleIndex);
    },
  });
  assert.equal(report.status, "pass");
  assert.equal(calls, 8);
  assert.equal(report.rawSamples.filter(({ reasonCode }) => reasonCode === "system-high-load").length, 1);

  const exhausted = await runABSampler({
    fields: ["latencyMs"], groups: 1, maxGroupAttempts: 2, warmups: 0,
    measure: async () => sample(10, { environment: { remoteConnected: false } }),
  });
  assert.equal(exhausted.status, "invalid");
  assert.equal(exhausted.attempts, 2);
});

test("non-finite metrics, version/profile skew, and extreme outliers invalidate a group", async () => {
  for (const values of [
    [10, Number.NaN, 11, 10],
    [10, 10, 10, 1000],
  ]) {
    let index = 0;
    const report = await runABSampler({
      fields: ["latencyMs"], groups: 1, maxGroupAttempts: 1, warmups: 0,
      measure: async () => sample(values[index++]),
    });
    assert.equal(report.status, "invalid");
  }
  let index = 0;
  const skew = await runABSampler({
    fields: ["latencyMs"], groups: 1, maxGroupAttempts: 1, warmups: 0,
    measure: async () => sample(10, {
      environment: { appVersion: index++ === 0 ? "1" : "2" },
    }),
  });
  assert.equal(skew.status, "invalid");
});
