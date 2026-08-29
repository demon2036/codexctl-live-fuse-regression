import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlatformMatrix } from "../regression/platform-matrix.mjs";

const revision = "a".repeat(40);
const pass = { actual: true, dirty: false, revision, status: "pass" };

test("[PLATFORM-MISSING-UNVERIFIED-003] [TDD-PLATFORM-GATE-011] missing actual platform evidence blocks all-platform pass", () => {
  for (const results of [{ macos: pass }, { linux: pass }]) {
    const matrix = evaluatePlatformMatrix({ results, revision });
    assert.equal(matrix.status, "unverified");
    assert.equal(matrix.allPlatformsPass, false);
    const missing = results.macos ? matrix.platforms.linux : matrix.platforms.macos;
    assert.equal(missing.status, "unverified");
    assert.ok(missing.reasonCodes.includes("actual-result-missing"));
  }
});

test("stale platform evidence cannot bind a final revision", () => {
  const matrix = evaluatePlatformMatrix({
    results: { macos: pass, linux: { ...pass, revision: "b".repeat(40) } }, revision,
  });
  assert.equal(matrix.allPlatformsPass, false);
  assert.ok(matrix.platforms.linux.reasonCodes.includes("revision-mismatch"));
});

test("both actual platform results must pass on the same revision", () => {
  const matrix = evaluatePlatformMatrix({ results: { macos: pass, linux: pass }, revision });
  assert.equal(matrix.status, "pass");
  assert.equal(matrix.allPlatformsPass, true);
  assert.equal(matrix.platforms.macos.status, "pass");
  assert.equal(matrix.platforms.linux.status, "pass");
});
