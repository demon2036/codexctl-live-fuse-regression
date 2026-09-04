import test from "node:test";
import assert from "node:assert/strict";
import { APP_FAULTS, evaluateAppFaultChecks } from "../regression/app-faults.mjs";

const results = () => APP_FAULTS.map(({ fault, reason }) => ({
  fault, reasonCodes: [reason], status: "fail",
}));

test("every App fault must produce its own stable Red reason", () => {
  assert.deepEqual(evaluateAppFaultChecks(results()), { failures: [], status: "pass" });
  const falseGreen = results();
  falseGreen[0].status = "pass";
  assert.match(evaluateAppFaultChecks(falseGreen).failures.join(","), /false-green-bottom-black/);
  assert.match(evaluateAppFaultChecks(falseGreen.slice(1)).failures.join(","), /missing-bottom-black/);
});
