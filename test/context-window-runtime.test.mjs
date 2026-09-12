import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload } from "../test-support/prompt-renderer-harness.mjs";
import {
  LARGE_CONTEXT,
  MEDIUM_CONTEXT,
  NATIVE_CONTEXT,
  NEW_THREAD_ID,
  OAI_CONTEXT,
  SECOND_THREAD_ID,
  THREAD_ID,
  XL_CONTEXT,
  setRuntimeUsage as setUsage,
  setupContextRuntime as setup,
} from "../test-support/context-window-runtime-harness.mjs";

test("runtime inference maps exact 95% windows back to configured presets", async (t) => {
  const { api, conversation } = await setup(t);
  assert.equal(api.contextForThread(THREAD_ID).id, "oai");

  setUsage(conversation, 100001, 427500);
  assert.equal(api.contextForThread(THREAD_ID).id, "450k");

  setUsage(conversation, 100002, 450000);
  assert.equal(api.contextForThread(THREAD_ID).id, "450k", "raw-reporting providers stay compatible");
});

test("new task and recorded resume both send the configured 450K values", async (t) => {
  const { api, calls, requestClient } = await setup(t);
  await requestClient.sendRequest("thread/start", {
    threadSource: "user",
    config: { preserve: "yes" },
  });
  const started = calls.find((call) => call.method === "thread/start");
  assert.deepEqual(started.params.config, {
    preserve: "yes",
    model_context_window: 450000,
    model_auto_compact_token_limit: 400000,
    model_auto_compact_token_limit_scope: "total",
  });
  assert.equal(api.contextForThread(NEW_THREAD_ID).id, "450k");

  await requestClient.sendRequest("thread/resume", { threadId: NEW_THREAD_ID, excludeTurns: true });
  const resumed = calls.filter((call) => call.method === "thread/resume").at(-1);
  assert.equal(resumed.params.config.model_context_window, 450000);
  assert.equal(resumed.params.config.model_auto_compact_token_limit, 400000);
});

test("clicking the 450K menu item sends a current-task resume override", async (t) => {
  const { api, calls, harness } = await setup(t);
  const contextButton = harness.document.querySelector(
    '[data-codex-context-window-trigger="true"]',
  );
  contextButton.click();
  const largeItem = harness.document.querySelectorAll(".cbps-menu-item").find((item) =>
    item.querySelector(".cbps-item-label")?.textContent === "450K");
  assert.ok(largeItem, "450K must be present in the interactive Context menu");
  largeItem.click();
  for (let pass = 0; pass < 8 && !calls.some((call) => call.method === "thread/resume"); pass += 1) {
    await harness.flush();
  }

  const resume = calls.filter((call) => call.method === "thread/resume").at(-1);
  assert.equal(resume.params.config.model_context_window, 450000);
  assert.equal(resume.params.config.model_auto_compact_token_limit, 400000);
  assert.equal(api.diagnostics().currentContext.id, "450k");
  assert.equal(api.diagnostics().lastContextSwitch.verificationPending, true);
});

test("450K hot switch waits for fresh usage then accepts 427.5K effective", async (t) => {
  const { api, calls, conversation, harness } = await setup(t);
  const switched = await api.hotSwitchContext(THREAD_ID, LARGE_CONTEXT);
  assert.equal(switched.changed, true);
  assert.equal(switched.verificationPending, true);
  const resume = calls.filter((call) => call.method === "thread/resume").at(-1);
  assert.equal(resume.params.config.model_context_window, 450000);
  assert.equal(resume.params.config.model_auto_compact_token_limit, 400000);

  let diagnostics = api.diagnostics();
  assert.equal(diagnostics.currentContext.id, "450k");
  assert.equal(diagnostics.contextRuntimeMatches, null, "stale pre-switch usage must not reject 450K");
  assert.equal(diagnostics.lastContextSwitch.verificationPending, true);

  setUsage(conversation, 100001, 427500);
  diagnostics = api.diagnostics();
  assert.equal(diagnostics.currentContext.id, "450k");
  assert.equal(diagnostics.contextRuntimeMatches, true);
  assert.equal(diagnostics.lastContextSwitch.ok, true);
  assert.equal(diagnostics.lastContextSwitch.verificationPending, false);
  assert.equal(diagnostics.lastContextSwitch.effectiveContextWindow, 427500);

  await harness.flush();
  const buttons = harness.document.querySelectorAll('[data-codex-context-window-trigger="true"]');
  assert.equal(buttons.length, 1, "UI reconciliation must keep one Context button");
  assert.match(buttons[0].textContent, /Context\s*:\s*450K/);
  assert.equal(buttons[0].getAttribute("data-runtime-mismatch"), "false");
  assert.match(buttons[0].getAttribute("title"), /427\.5K.*配置 450K/);
  buttons[0].click();
  const subtitle = harness.document.querySelector(".cbps-menu-subtitle");
  assert.match(subtitle.textContent, /runtime effective 427\.5K · configured 450K/);
});

test("450K hot switch rejects a fresh 258.4K runtime without false matching", async (t) => {
  const { api, conversation } = await setup(t);
  await api.hotSwitchContext(THREAD_ID, LARGE_CONTEXT);
  setUsage(conversation, 100001, 258400);

  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.lastContextSwitch.ok, false);
  assert.equal(diagnostics.lastContextSwitch.observedContextWindow, 258400);
  assert.match(diagnostics.lastContextSwitch.error, /258\.4K/);
  assert.match(diagnostics.lastContextSwitch.error, /427\.5K/);
  assert.equal(diagnostics.currentContext.id, "oai");
  assert.equal(diagnostics.contextRuntimeMatches, true);
});

test("fresh Context verification is isolated per thread", async (t) => {
  const { api, conversation, manager } = await setup(t);
  const secondConversation = {
    latestTokenUsageInfo: { last: { totalTokens: 200000 }, modelContextWindow: 258400 },
    resumeState: "resumed",
    threadRuntimeStatus: { type: "idle" },
  };
  manager.conversations.set(SECOND_THREAD_ID, secondConversation);

  await api.hotSwitchContext(THREAD_ID, LARGE_CONTEXT);
  await api.hotSwitchContext(SECOND_THREAD_ID, LARGE_CONTEXT);
  setUsage(conversation, 100001, 258400);

  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.currentContext.id, "oai",
    "thread A must roll back even when thread B switched more recently");
  assert.equal(diagnostics.currentContextSwitch.threadId, THREAD_ID);
  assert.equal(diagnostics.currentContextSwitch.ok, false);
  assert.equal(api.contextForThread(SECOND_THREAD_ID).id, "450k");
});

test("a smaller legal Context resumes the current thread and marks compaction eligibility", async (t) => {
  const { api, calls, conversation } = await setup(t, 427500);
  setUsage(conversation, 260000, 427500);
  await api.hotSwitchContext(THREAD_ID, OAI_CONTEXT);
  assert.deepEqual(calls.map((call) => call.method), ["thread/read", "thread/unsubscribe", "thread/resume"]);
  assert.equal(calls.at(-1).params.config.model_context_window, 272000);
  assert.equal(api.diagnostics().currentContext.id, "oai");
  assert.equal(api.diagnostics().currentContextSwitch.requiresCompaction, true);
});

test("Native with an equal known official capacity resumes the current task without overrides", async (t) => {
  const { api, calls, conversation } = await setup(t);
  api.recordThreadFromResult(
    { thread: { id: THREAD_ID } },
    { id: "default", label: "Default" },
    NATIVE_CONTEXT,
    "fixture/native",
    { prompt: false, context: false },
  );
  assert.equal(api.contextForThread(THREAD_ID).id, "native");

  await api.hotSwitchContext(THREAD_ID, OAI_CONTEXT);
  setUsage(conversation, 100001, 258400);
  api.diagnostics();
  const beforeNative = calls.length;

  const switched = await api.hotSwitchContext(THREAD_ID, NATIVE_CONTEXT);
  assert.equal(switched.changed, true);
  const nativeCalls = calls.slice(beforeNative);
  const resume = nativeCalls.find((call) => call.method === "thread/resume");
  assert.ok(resume, "Native must resume the current thread");
  assert.equal(resume.params.config?.model_context_window, undefined);
  assert.equal(resume.params.config?.model_auto_compact_token_limit, undefined);
  assert.equal(api.contextForThread(THREAD_ID).id, "native");

  setUsage(conversation, 100002, 258400);
  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.lastContextSwitch.ok, true);
  assert.equal(diagnostics.lastContextSwitch.verificationPending, false);
  assert.equal(diagnostics.currentContext.id, "native");
});

test("Native without a trusted official capacity fails without next-task-only wording", async (t) => {
  const { api, calls } = await setup(t);
  api.recordThreadFromResult(
    { thread: { id: THREAD_ID } },
    { id: "default", label: "Default" },
    OAI_CONTEXT,
    "fixture/explicit",
    { prompt: false, context: true },
  );
  await assert.rejects(api.hotSwitchContext(THREAD_ID, NATIVE_CONTEXT), (error) => {
    assert.match(error.message, /Native.*容量|官方.*容量/);
    assert.doesNotMatch(error.message, /只对下一个/);
    return true;
  });
  assert.deepEqual(calls, []);
});

test("idle 400K task switches to 600K immediately despite stale local active status", async (t) => {
  const { api, calls, conversation } = await setup(t, 380000);
  api.recordThreadFromResult(
    { thread: { id: THREAD_ID } },
    { id: "default", label: "Default" },
    MEDIUM_CONTEXT,
    "fixture/400k",
    { prompt: false, context: true },
  );
  conversation.threadRuntimeStatus = { type: "active" };
  conversation.serverStatus = { type: "idle" };

  const switched = await api.hotSwitchContext(THREAD_ID, XL_CONTEXT);

  assert.equal(switched.changed, true);
  assert.equal(switched.queued, undefined, "stale renderer state must not defer an idle task");
  assert.deepEqual(calls.map((call) => call.method), [
    "thread/read",
    "thread/unsubscribe",
    "thread/resume",
  ]);
  assert.equal(calls.at(-1).params.config.model_context_window, 600000);
  assert.equal(api.diagnostics().queuedContextSwitch, null);
  assert.equal(api.diagnostics().currentContext.id, "600k");
});

test("active task queues and coalesces Context, then applies it before the next turn", async (t) => {
  const { api, calls, conversation, requestClient } = await setup(t);
  conversation.threadRuntimeStatus = { type: "active" };
  conversation.serverStatus = { type: "active" };
  const queuedLarge = await api.hotSwitchContext(THREAD_ID, LARGE_CONTEXT);
  assert.equal(queuedLarge.queued, true);
  const queuedLatest = await api.hotSwitchContext(THREAD_ID, {
    id: "400k",
    label: "400K",
    contextWindow: 400000,
    autoCompactTokenLimit: 360000,
    scope: "total",
  });
  assert.equal(queuedLatest.queued, true);
  assert.deepEqual(calls.map((call) => call.method), ["thread/read", "thread/read"],
    "queueing may confirm status but must not unsubscribe or resume an active turn");
  assert.equal(api.diagnostics().queuedContextSwitch.context.id, "400k");

  conversation.serverStatus = { type: "idle" };
  conversation.threadRuntimeStatus = { type: "idle" };
  calls.length = 0;
  await requestClient.sendRequest("turn/start", { threadId: THREAD_ID, input: [] });
  assert.deepEqual(calls.map((call) => call.method), [
    "thread/read",
    "thread/unsubscribe",
    "thread/resume",
    "turn/start",
  ]);
  const resume = calls.find((call) => call.method === "thread/resume");
  assert.equal(resume.params.config.model_context_window, 400000);
  assert.equal(api.diagnostics().queuedContextSwitch, null);
});

test("Context UI never describes Native as next-task-only", async (t) => {
  const fixture = await makePayload({
    features: { prompt: true, context: true },
    contexts: [NATIVE_CONTEXT, OAI_CONTEXT, LARGE_CONTEXT],
    defaultContextId: "native",
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  assert.doesNotMatch(fixture.loaded.payload, /Native[^\n]{0,80}只对下一个/);
  assert.doesNotMatch(fixture.loaded.payload, /Native 仅适用于下一个/);
});
