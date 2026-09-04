import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMacPlatformEvidence,
  redactMacAppArguments,
} from "../regression/macos-platform-evidence.mjs";

const native = (overrides = {}) => ({
  composer: { found: true },
  reasonCodes: [],
  status: "pass",
  ...overrides,
});

test("macOS L5 passes only when native interaction and injected controls are both verified", () => {
  assert.deepEqual(evaluateMacPlatformEvidence({
    injection: { controlContextAvailable: true }, mode: "injected", native: native(),
  }), { failures: [], reasonCodes: [], status: "pass" });
});

test("missing OS permission or isolated login is explicitly unverified", () => {
  assert.deepEqual(evaluateMacPlatformEvidence({
    injection: null,
    mode: "official",
    native: native({ reasonCodes: ["permission-accessibility"], status: "unverified" }),
  }), {
    failures: [], reasonCodes: ["permission-accessibility"], status: "unverified",
  });
  assert.equal(evaluateMacPlatformEvidence({
    injection: { controlContextAvailable: false },
    mode: "injected",
    native: native({ composer: { found: false }, reasonCodes: ["composer-not-found"], status: "fail" }),
  }).status, "unverified");
});

test("an interactive App with missing injected controls is a real failure", () => {
  const result = evaluateMacPlatformEvidence({
    injection: { controlContextAvailable: false }, mode: "injected", native: native(),
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.failures, ["injected-controls-missing"]);
});

test("macOS evidence redacts the isolated profile path without hiding functional arguments", () => {
  assert.deepEqual(redactMacAppArguments([
    "--user-data-dir=/private/tmp/secret/profile", "--ozone-platform=x11",
  ]), ["--user-data-dir=<isolated-profile>", "--ozone-platform=x11"]);
});
