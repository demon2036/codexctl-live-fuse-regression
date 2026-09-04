import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "./prompt-renderer-harness.mjs";

export const THREAD_ID = "11111111-2222-4333-8444-555555555555";
export const SECOND_THREAD_ID = "22222222-3333-4444-8555-666666666666";
export const NEW_THREAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const OAI_CONTEXT = {
  id: "oai", label: "Legacy OAI 272K", contextWindow: 272000,
  autoCompactTokenLimit: 244800, scope: "total",
};
export const LARGE_CONTEXT = {
  id: "450k", label: "450K", contextWindow: 450000,
  autoCompactTokenLimit: 400000, scope: "total",
};
export const MEDIUM_CONTEXT = {
  id: "400k", label: "400K", contextWindow: 400000,
  autoCompactTokenLimit: 360000, scope: "total",
};
export const XL_CONTEXT = {
  id: "600k", label: "600K", contextWindow: 600000,
  autoCompactTokenLimit: 540000, scope: "total",
};
export const NATIVE_CONTEXT = {
  id: "native", label: "Native / Official", native: true,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function setupContextRuntime(t, runtimeWindow = 258400) {
  const fixture = await makePayload({
    features: { prompt: false, context: true },
    contexts: [NATIVE_CONTEXT, OAI_CONTEXT, MEDIUM_CONTEXT, LARGE_CONTEXT, XL_CONTEXT],
    defaultContextId: "450k",
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const calls = [];
  const conversation = {
    latestTokenUsageInfo: { last: { totalTokens: 100000 }, modelContextWindow: runtimeWindow },
    resumeState: "resumed",
    threadRuntimeStatus: { type: "idle" },
  };
  const requestClient = {
    async sendRequest(method, params) {
      calls.push({ method, params: clone(params) });
      if (method === "thread/read") {
        return { thread: { id: params.threadId,
          status: { ...(conversation.serverStatus ?? conversation.threadRuntimeStatus) } } };
      }
      if (method === "thread/start") {
        return { thread: { id: NEW_THREAD_ID, status: { type: "idle" } } };
      }
      return { thread: { id: params.threadId ?? THREAD_ID, status: { type: "idle" } } };
    },
    async prewarmThreadStart(params) {
      calls.push({ method: "thread/prewarm", params: clone(params) });
      return { thread: { id: NEW_THREAD_ID, status: { type: "idle" } } };
    },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations: new Map([[THREAD_ID, conversation]]),
    getConversation(threadId) { return this.conversations.get(threadId) ?? null; },
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.appendChild(composer);
  footer.appendChild(permission);
  harness.document.body.appendChild(footer);
  composer.__reactFiber$codexctl = {
    memoizedProps: { conversationId: THREAD_ID, hasConversation: true },
    updateQueue: { memoCache: { data: [[manager]] } },
    return: null,
  };

  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true, "manager probe must be scheduled once");
  await harness.flush();
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  assert.equal(api.diagnostics().managerStatus, "ready");
  return { api, calls, conversation, harness, manager, requestClient };
}

export function setRuntimeUsage(conversation, totalTokens, modelContextWindow) {
  conversation.latestTokenUsageInfo = { last: { totalTokens }, modelContextWindow };
}
