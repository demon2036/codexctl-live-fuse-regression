import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

const THREADS = [
  "11111111-2222-4333-8444-555555555555",
  "22222222-3333-4444-8555-666666666666",
  "33333333-4444-4555-8666-777777777777",
];

async function setup(t, payloadOverrides, sendRequest) {
  const fixture = await makePayload(payloadOverrides);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  const requestClient = { sendRequest, async prewarmThreadStart() { return {}; } };
  const manager = {
    hostId: "local", requestClient, threadCreation: {},
    getHostId() { return "local"; }, startConversation() {}, clearPrewarmedThreads() {},
  };
  const fiber = {
    memoizedProps: { clientThreadId: "client-new-thread:provider-default", hasConversation: false },
    updateQueue: { memoCache: { data: [[manager]] } },
    return: null,
  };
  composer.__reactFiber$providerDefault = { memoizedProps: {}, return: fiber };
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true);
  await harness.flush();
  return { harness, requestClient };
}

test("implicit OpenAI display does not force modelProvider into thread/start", async (t) => {
  const calls = [];
  const { harness, requestClient } = await setup(t, {}, async (method, params) => {
    calls.push({ method, params });
    return method === "thread/start"
      ? { thread: { id: THREADS[0], modelProvider: "openai" } } : {};
  });
  await requestClient.sendRequest("thread/start", { threadSource: "user" });
  assert.equal(calls.find(({ method }) => method === "thread/start").params.modelProvider, undefined);
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().providerDefaultId, "openai");
});

test("explicit launch Provider is injected for every new session", async (t) => {
  const calls = [];
  let sequence = 0;
  const { harness, requestClient } = await setup(t, {
    defaultProviderId: "polo",
    launchProviderId: "polo",
    providerSelectionRevision: "launch:polo",
  }, async (method, params) => {
    calls.push({ method, params });
    if (method !== "thread/start") return {};
    const id = THREADS[sequence++];
    return { thread: { id } };
  });
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  assert.match(indicator.textContent, /Provider\s*:\s*polo/);
  assert.equal(indicator.getAttribute("data-provider"), "polo");
  await requestClient.sendRequest("thread/start", { threadSource: "user" });
  await requestClient.sendRequest("thread/start", { threadSource: "user" });
  await requestClient.sendRequest("thread/start", { threadSource: "system" });
  assert.deepEqual(
    calls.filter(({ method }) => method === "thread/start")
      .map(({ params }) => params.modelProvider),
    ["polo", "polo", undefined],
  );
  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.pendingProvider, null);
  assert.equal(diagnostics.providerDefaultId, "polo");
  assert.equal(diagnostics.providerLaunchId, "polo");
  assert.equal(diagnostics.lastRecordedThread.provider, null,
    "a system thread that received no Provider override must remain unknown");
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.providerForThread(THREADS[2]),
    null,
  );
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.providerForThread(THREADS[1]),
    "polo",
    "an eligible request claim must survive a response that omits Provider metadata",
  );
});
