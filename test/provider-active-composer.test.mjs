import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

const STALE_THREAD = "11111111-2222-4333-8444-555555555555";
const LIVE_THREAD = "22222222-3333-4444-8555-666666666666";
const FORK_THREAD = "33333333-4444-4555-8666-777777777777";
const FORK_OVERRIDE_THREAD = "44444444-5555-4666-8777-888888888888";

function mount(harness, props, suffix, manager = null) {
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  const fiber = {
    memoizedProps: props,
    updateQueue: manager ? { memoCache: { data: [[manager]] } } : null,
    return: null,
  };
  composer[`__reactFiber$${suffix}`] = { memoizedProps: {}, return: fiber };
  return { composer, footer, permission };
}

test("default session helpers and thread/fork use the focused live composer", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  let forkCount = 0;
  const requestClient = {
    async sendRequest(method) {
      if (method !== "thread/fork") return {};
      forkCount += 1;
      return forkCount === 1
        ? { thread: { id: FORK_THREAD } }
        : { thread: { id: FORK_OVERRIDE_THREAD, modelProvider: "polo" } };
    },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local", requestClient, threadCreation: {},
    getHostId() { return "local"; }, startConversation() {}, clearPrewarmedThreads() {},
  };
  const stale = mount(harness, {
    conversationId: STALE_THREAD, hasConversation: true, modelProvider: "stale-provider",
  }, "stale", manager);
  const live = mount(harness, {
    conversationId: LIVE_THREAD, hasConversation: true, modelProvider: "openai",
  }, "live", manager);
  stale.composer.setBoundingClientRect({ left: 20, top: 120, width: 520, height: 42 });
  stale.permission.setBoundingClientRect({ left: 550, top: 120, width: 100, height: 32 });
  live.composer.setBoundingClientRect({ left: 20, top: 620, width: 520, height: 42 });
  live.permission.setBoundingClientRect({ left: 550, top: 620, width: 100, height: 32 });
  harness.document.activeElement = live.composer;
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true);
  await harness.flush();

  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  assert.equal(api.currentConversationContext().threadId, LIVE_THREAD);
  assert.equal(api.currentConversationId(), LIVE_THREAD);
  assert.deepEqual(JSON.parse(JSON.stringify(api.currentSessionProvider())), {
    id: "openai", threadId: LIVE_THREAD, status: "resolved",
    source: "composer:modelProvider", candidate: null,
  });
  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.currentConversationId, LIVE_THREAD);
  assert.equal(diagnostics.currentProvider.threadId, LIVE_THREAD);

  api.recordThreadFromResult(
    { thread: { id: STALE_THREAD, modelProvider: "stale-provider" } },
    { id: "stale", label: "Stale", path: "/tmp/stale.md" },
    { id: "200k", label: "200K", contextWindow: 200000,
      autoCompactTokenLimit: 180000, scope: "total" },
    "test/stale", { prompt: true, context: true },
  );
  api.recordThreadFromResult(
    { thread: { id: LIVE_THREAD, modelProvider: "openai" } },
    { id: "live", label: "Live", path: "/tmp/live.md" },
    { id: "400k", label: "400K", contextWindow: 400000,
      autoCompactTokenLimit: 360000, scope: "total" },
    "test/live", { prompt: true, context: true },
  );
  await requestClient.sendRequest("thread/fork", {});
  assert.equal(api.profileForThread(FORK_THREAD).id, "live");
  assert.equal(api.contextForThread(FORK_THREAD).id, "400k");
  assert.equal(api.providerForThread(FORK_THREAD), "openai",
    "an omitted fork response must inherit the focused live parent's Provider");
  await requestClient.sendRequest("thread/fork", {});
  assert.equal(api.providerForThread(FORK_OVERRIDE_THREAD), "polo",
    "an explicit fork response must take priority over inherited Provider state");
});
