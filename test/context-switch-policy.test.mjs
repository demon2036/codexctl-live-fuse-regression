import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

const OAI_CONTEXT = {
  id: "oai",
  label: "Legacy OAI 272K",
  contextWindow: 272000,
  autoCompactTokenLimit: 244800,
  scope: "total",
};
const LARGE_CONTEXT = {
  id: "450k",
  label: "450K",
  contextWindow: 450000,
  autoCompactTokenLimit: 400000,
  scope: "total",
};
const NATIVE_CONTEXT = { id: "native", label: "Native / Official", native: true };

async function policyApi(t) {
  const fixture = await makePayload({
    features: { prompt: false, context: true },
    contexts: [NATIVE_CONTEXT, OAI_CONTEXT, LARGE_CONTEXT],
    defaultContextId: "native",
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  const decide = harness.window.__CODEX_BASE_PROMPT_SWITCHER__?.contextSwitchDecision;
  assert.equal(typeof decide, "function", "renderer must expose the pure Context switch policy");
  return decide;
}

test("Context policy allows equal/larger targets and treats exact repeats as idempotent", async (t) => {
  const decide = await policyApi(t);
  assert.equal(decide({ current: OAI_CONTEXT, target: OAI_CONTEXT }).action, "noop");
  const larger = JSON.parse(JSON.stringify(decide({
    current: OAI_CONTEXT,
    target: LARGE_CONTEXT,
  })));
  assert.deepEqual(larger, {
    action: "apply",
    code: "eligible",
    currentWindow: 272000,
    targetWindow: 450000,
  });
});

test("Context policy rejects window and compact regressions before runtime work", async (t) => {
  const decide = await policyApi(t);
  assert.equal(decide({ current: LARGE_CONTEXT, target: OAI_CONTEXT }).code,
    "context-window-decrease");
  assert.equal(decide({
    current: LARGE_CONTEXT,
    target: { ...LARGE_CONTEXT, id: "early", autoCompactTokenLimit: 390000 },
  }).code, "compact-limit-decrease");
  assert.equal(decide({
    current: OAI_CONTEXT,
    target: LARGE_CONTEXT,
    totalTokens: 400000,
  }).code, "token-limit-exceeded");
});

test("Native uses a resolved official capacity instead of next-task-only semantics", async (t) => {
  const decide = await policyApi(t);
  assert.equal(decide({
    current: OAI_CONTEXT,
    target: NATIVE_CONTEXT,
    nativeContextWindow: 272000,
  }).action, "apply");
  assert.equal(decide({
    current: LARGE_CONTEXT,
    target: NATIVE_CONTEXT,
    nativeContextWindow: 272000,
  }).code, "context-window-decrease");
  assert.equal(decide({ current: OAI_CONTEXT, target: NATIVE_CONTEXT }).code,
    "native-capacity-unknown");
});
