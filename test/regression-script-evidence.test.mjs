import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeScriptFailureEvidence } from "../regression/script-evidence.mjs";

test("early runner failure always publishes allowlisted evidence", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexctl-failure-evidence-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = await writeScriptFailureEvidence({
    directory,
    dirty: false,
    reasonCode: "fixture-readiness-failed",
    revision: "a".repeat(40),
    runId: "12345678-1234-4123-8123-123456789abc",
    schema: "codexctl-app-regression/1",
    stage: "app-sequence",
  });
  assert.deepEqual(result.failure, {
    reasonCode: "fixture-readiness-failed", stage: "app-sequence",
  });
  const serialized = await fs.readFile(path.join(directory, "summary.json"), "utf8");
  assert.doesNotMatch(serialized, /Users|runner\/work|token|prompt|session/i);
});

test("failure evidence rejects free-form reasons and non-revision source state", async () => {
  await assert.rejects(writeScriptFailureEvidence({
    directory: path.resolve("regression-results", "invalid-fixture"),
    dirty: false,
    reasonCode: "failure at /Users/private with token=secret",
    revision: "dirty",
    runId: "12345678-1234-4123-8123-123456789abc",
    schema: "codexctl-app-regression/1",
    stage: "app-sequence",
  }), /Invalid/);
});
