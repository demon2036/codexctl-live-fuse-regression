import test from "node:test";
import assert from "node:assert/strict";
import { APP_FAULTS } from "../regression/app-faults.mjs";
import {
  evaluateCoreFaultInjection,
  evaluateProviderProtection,
} from "../regression/core-fault-gates.mjs";

function appFaultResults() {
  return APP_FAULTS.map(({ fault, reason }) => ({ fault, reasonCodes: [reason], status: "fail" }));
}

test("provider mutation gate detects byte changes and injected provider text", () => {
  const before = Buffer.from("model = 'official'\n");
  assert.deepEqual(evaluateProviderProtection({
    after: Buffer.from(before), before, launchDescription: "official embedded CLI",
  }), { failures: [], status: "pass" });
  const fault = evaluateProviderProtection({
    after: Buffer.from("model_provider='crs'\n"), before,
    launchDescription: "model_provider=crs",
  });
  assert.equal(fault.status, "fail");
  assert.deepEqual(fault.failures, ["config-bytes-changed", "provider-injected"]);
});

test("[TDD-GREEN-MINIMAL-004] every core temporary fault makes its owning gate Red", () => {
  const result = evaluateCoreFaultInjection({
    appFaultResults: appFaultResults(),
    budgetSample: {
      baselineValid: true,
      injectedMaxMs: 30,
      injectedP95Ms: 14,
      officialMaxMs: 10,
      officialP95Ms: 10,
    },
    provider: {
      after: Buffer.from("model_provider='crs'\n"),
      before: Buffer.from("model='official'\n"),
      launchDescription: "model_provider=crs",
    },
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.failures, []);
  assert.equal(result.gates.budget.status, "fail");
  assert.equal(result.gates.provider.status, "fail");
});

test("fault gate detects a false Green for bottom, anchor, Remote, budget, or cleanup", () => {
  for (const fault of ["bottom-black", "anchor", "remote", "cleanup"]) {
    const results = appFaultResults().map((entry) => (
      entry.fault === fault ? { ...entry, reasonCodes: [], status: "pass" } : entry
    ));
    const evaluation = evaluateCoreFaultInjection({
      appFaultResults: results,
      budgetSample: {
        baselineValid: true, injectedMaxMs: 30, injectedP95Ms: 14,
        officialMaxMs: 10, officialP95Ms: 10,
      },
      provider: {
        after: Buffer.from("changed"), before: Buffer.from("before"),
        launchDescription: "model_provider=crs",
      },
    });
    assert.equal(evaluation.status, "fail");
    assert.ok(evaluation.failures.some((code) => code.includes(fault.split("-")[0])));
  }
});
