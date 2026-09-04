import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeliveryGate } from "../regression/delivery-gate.mjs";

const layers = { L1: "pass", L2: "pass", L3: "pass", L4: "pass", L5: "pass" };

test("[TDD-REAL-BOUNDARY-006] [TDD-APP-AB-GATE-010] [TDD-APP-UNVERIFIED-022] L1-L3 cannot substitute for App A/B", () => {
  const result = evaluateDeliveryGate({
    automatedStatus: "pass", cleanupStatus: "pass", revisionCurrent: true,
    layers: { ...layers, L4: "unverified", L5: "unverified" },
  });
  assert.equal(result.readyForUserAcceptance, false);
  assert.deepEqual(result.reasonCodes, ["l4-not-pass", "l5-not-pass"]);
});

test("[TDD-USER-ACCEPTANCE-023] user confirmation is requested only after all developer gates", () => {
  const ready = evaluateDeliveryGate({
    automatedStatus: "pass", cleanupStatus: "pass", layers, revisionCurrent: true,
  });
  assert.equal(ready.readyForUserAcceptance, true);
  assert.equal(ready.accepted, false, "developer self-test does not forge user acceptance");
  const accepted = evaluateDeliveryGate({
    automatedStatus: "pass", cleanupStatus: "pass", layers,
    revisionCurrent: true, userConfirmed: true,
  });
  assert.equal(accepted.accepted, true);
});
