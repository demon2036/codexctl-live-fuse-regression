import test from "node:test";
import assert from "node:assert/strict";
import { assertTddEvidence, validateTddEvidence } from "../regression/tdd-evidence.mjs";

const parent = "a".repeat(40);
const final = "b".repeat(40);

function defect(overrides = {}) {
  return {
    behaviorChanged: true,
    caseId: "WALLPAPER-BOTTOM-COVERAGE-002",
    kind: "defect",
    parentRevision: parent,
    red: {
      command: "node --test fixture.test.mjs",
      expectedFailure: "bottom-opaque-black",
      failureKind: "behavior",
      observedFailure: "assertion failed: bottom-opaque-black",
      revision: parent,
      status: "fail",
    },
    green: { command: "node --test fixture.test.mjs", revision: final, status: "pass" },
    ...overrides,
  };
}

test("[TDD-RED-EVIDENCE-001] valid defect evidence binds expected Red and final Green", () => {
  assert.doesNotThrow(() => assertTddEvidence(defect(), final));
});

test("defect evidence rejects a missing parent revision", () => {
  assert.match(
    validateTddEvidence(defect({ parentRevision: null }), final).map((item) => item.message).join("\n"),
    /parent revision/,
  );
});

test("defect evidence rejects syntax, fixture, or unrelated Red failures", () => {
  for (const failureKind of ["syntax", "fixture", "unrelated"]) {
    const record = defect({ red: { ...defect().red, failureKind } });
    assert.ok(validateTddEvidence(record, final).some(({ code }) => code === "wrong-red-reason"));
  }
  const wrongAssertion = defect({
    red: { ...defect().red, observedFailure: "some unrelated assertion" },
  });
  assert.ok(validateTddEvidence(wrongAssertion, final)
    .some(({ code }) => code === "wrong-red-assertion"));
});

test("Green evidence must bind the exact final revision", () => {
  const record = defect({ green: { ...defect().green, revision: "c".repeat(40) } });
  assert.ok(validateTddEvidence(record, final)
    .some(({ code }) => code === "green-revision-mismatch"));
});

test("[TDD-CHARACTERIZATION-003] pure refactor cannot forge a failing Red", () => {
  const characterization = defect({
    behaviorChanged: false,
    kind: "characterization",
    red: { command: "node --test stable.test.mjs", revision: parent, status: "pass" },
  });
  assert.deepEqual(validateTddEvidence(characterization, final), []);
  const forged = {
    ...characterization,
    red: { ...characterization.red, failureKind: "behavior", status: "fail" },
  };
  assert.ok(validateTddEvidence(forged, final)
    .some(({ code }) => code === "forged-refactor-red"));
});
