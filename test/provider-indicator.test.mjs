import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

const THREAD_A = "11111111-2222-4333-8444-555555555555";
const THREAD_B = "22222222-3333-4444-8555-666666666666";

function mountComposer(harness, memoizedProps, updateQueue = null) {
  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  const fiber = { memoizedProps, updateQueue, return: null };
  composer.__reactFiber$providerIndicator = { memoizedProps: {}, return: fiber };
  return { composer, fiber };
}

async function setup(t, memoizedProps, updateQueue = null, payloadOverrides = {}) {
  const fixture = await makePayload(payloadOverrides);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  const mounted = mountComposer(harness, memoizedProps, updateQueue);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  return { fixture, harness, ...mounted };
}

test("Provider indicator follows the current session's composer fiber", async (t) => {
  const { harness, fiber } = await setup(t, {
    conversationId: THREAD_A,
    hasConversation: true,
    modelProvider: "polo",
  });
  let indicators = harness.document.querySelectorAll('[data-codex-provider-indicator="true"]');
  assert.equal(indicators.length, 1);
  assert.match(indicators[0].textContent, /Provider\s*:\s*polo/);
  assert.equal(indicators[0].getAttribute("data-provider"), "polo");
  assert.equal(indicators[0].getAttribute("data-provider-status"), "resolved");
  assert.match(indicators[0].getAttribute("title"), /不单独证明最终上游计费账户/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().currentProvider,
    )),
    {
      id: "polo",
      threadId: THREAD_A,
      status: "resolved",
      source: "composer:modelProvider",
      candidate: null,
    },
  );

  fiber.memoizedProps = {
    conversationId: THREAD_B,
    hasConversation: true,
    threadSettings: { modelProvider: "openai" },
  };
  harness.dispatchWindow("hashchange");
  await harness.flush();
  indicators = harness.document.querySelectorAll('[data-codex-provider-indicator="true"]');
  assert.equal(indicators.length, 1, "session navigation must reuse the indicator");
  assert.match(indicators[0].textContent, /Provider\s*:\s*openai/);
  assert.equal(indicators[0].getAttribute("data-thread-id"), THREAD_B);
});

test("blank new task displays the implicit OpenAI default instead of pending", async (t) => {
  const { harness } = await setup(t, {
    browserConversationId: THREAD_A,
    clientThreadId: "client-new-thread:test",
    hasConversation: false,
    modelProvider: "polo",
  });
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  assert.match(indicator.textContent, /Provider\s*:\s*OpenAI/);
  assert.equal(indicator.getAttribute("data-provider"), "openai");
  const provider = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.currentSessionProvider();
  assert.equal(provider.status, "pending");
  assert.equal(provider.id, "openai");
  assert.equal(provider.source, "implicit-openai-default");
  assert.equal(provider.candidate, "polo");
});

test("thread responses provide a bounded fallback when current fiber omits Provider", async (t) => {
  let calls = 0;
  const requestClient = {
    async sendRequest(method, params) {
      calls += 1;
      return {
        thread: {
          id: params.threadId,
          modelProvider: "polo",
          status: { type: "idle" },
        },
      };
    },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const { harness } = await setup(t, {
    conversationId: THREAD_A,
    hasConversation: true,
  }, { memoCache: { data: [[manager]] } });
  assert.match(
    harness.document.querySelector('[data-codex-provider-indicator="true"]').textContent,
    /Provider\s*:\s*unknown/,
  );
  assert.equal(harness.runNextTimer(), true, "manager discovery must patch the request client");
  await harness.flush();

  await requestClient.sendRequest("thread/read", { threadId: THREAD_A });
  await harness.flush();
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  assert.equal(calls, 1);
  assert.match(indicator.textContent, /Provider\s*:\s*polo/);
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().currentProvider.source,
    "thread/read:result",
  );
});

test("Provider indicator is singular across reinjection and removed by cleanup", async (t) => {
  const { fixture, harness } = await setup(t, {
    conversationId: THREAD_A,
    hasConversation: true,
    modelProvider: "openai",
  });
  harness.execute(fixture.loaded.payload);
  harness.dispatchWindow("popstate");
  await harness.flush();
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-provider-indicator="true"]',
  ).length, 1);

  harness.window.__CODEX_BASE_PROMPT_SWITCHER__.cleanup();
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-provider-indicator="true"]',
  ).length, 0);
});

test("blank task Provider menu reads config and routes the next thread/start", async (t) => {
  const calls = [];
  const requestClient = {
    async sendRequest(method, params) {
      calls.push({ method, params });
      if (method === "config/read") {
        return {
          config: {
            model_provider: "openai",
            model_providers: {
              polo: {
                name: "Polo",
                base_url: "https://poloai.top/v1",
                env_key: "POLO_API_KEY",
                wire_api: "responses",
                requires_openai_auth: false,
              },
            },
          },
        };
      }
      if (method === "thread/start") {
        return {
          thread: {
            id: THREAD_A,
            status: { type: "idle" },
          },
        };
      }
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      return {};
    },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const { harness, fiber } = await setup(t, {
    clientThreadId: "client-new-thread:provider-menu",
    hasConversation: false,
  }, { memoCache: { data: [[manager]] } });

  assert.equal(harness.runNextTimer(), true);
  await harness.flush();
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  indicator.click();
  await harness.flush();
  const labels = harness.document.querySelectorAll(".cbps-provider-menu-item")
    .map((item) => item.querySelector(".cbps-item-label")?.textContent);
  assert.deepEqual(labels, ["OpenAI", "Polo"]);
  assert.equal(calls.filter((call) => call.method === "config/read").length, 1);

  const polo = harness.document.querySelectorAll(".cbps-provider-menu-item").find((item) =>
    item.querySelector(".cbps-item-label")?.textContent === "Polo");
  assert.ok(polo);
  polo.click();
  await harness.flush();
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().pendingProvider.id,
    "polo",
  );

  await requestClient.sendRequest("thread/start", {
    threadSource: "user",
    config: { preserve: "yes" },
  });
  const started = calls.filter((call) => call.method === "thread/start").at(-1);
  assert.equal(started.params.modelProvider, "polo");
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().pendingProvider, null);

  fiber.memoizedProps = { conversationId: THREAD_A, hasConversation: true };
  harness.dispatchWindow("hashchange");
  await harness.flush();
  assert.match(indicator.textContent, /Provider\s*:\s*polo/);
  assert.equal(indicator.getAttribute("data-provider-selectable"), "false");

  await requestClient.sendRequest("thread/resume", { threadId: THREAD_A });
  const resumed = calls.filter((call) => call.method === "thread/resume").at(-1);
  assert.equal(resumed.params.modelProvider, undefined,
    "a pending Provider must never overwrite a historical resume");
});

test("blank task Provider selection also routes the App's prewarmThreadStart", async (t) => {
  const calls = [];
  const requestClient = {
    async sendRequest(method, params) {
      calls.push({ method, params });
      if (method === "config/read") {
        return {
          config: {
            model_provider: "openai",
            model_providers: {
              polo: { name: "Polo", base_url: "http://127.0.0.1:1/v1" },
            },
          },
        };
      }
      return {};
    },
    async prewarmThreadStart(params) {
      calls.push({ method: "thread/prewarm", params });
      return {
        thread: {
          id: params.ephemeral ? THREAD_B : THREAD_A,
          status: { type: "idle" },
        },
      };
    },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const { harness } = await setup(t, {
    clientThreadId: "client-new-thread:provider-prewarm",
    hasConversation: false,
  }, { memoCache: { data: [[manager]] } });

  assert.equal(harness.runNextTimer(), true);
  await harness.flush();
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  indicator.click();
  await harness.flush();
  const polo = harness.document.querySelectorAll(".cbps-provider-menu-item").find((item) =>
    item.querySelector(".cbps-item-label")?.textContent === "Polo");
  assert.ok(polo);
  polo.click();
  await harness.flush();

  await requestClient.prewarmThreadStart({ threadSource: "user", ephemeral: true });
  const ephemeral = calls.filter((call) => call.method === "thread/prewarm").at(-1);
  assert.equal(ephemeral.params.modelProvider, undefined);
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.providerForThread(THREAD_B),
    null,
    "an ephemeral prewarm without an override must not inherit the pending Provider",
  );
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().pendingProvider.id,
    "polo",
    "the pending selection must remain for the next eligible user session",
  );

  const result = await requestClient.prewarmThreadStart({ threadSource: "user" });
  const prewarm = calls.filter((call) => call.method === "thread/prewarm").at(-1);
  assert.equal(prewarm.params.modelProvider, "polo");
  assert.equal(result.thread.modelProvider, undefined,
    "the fixture must cover a successful response that omits Provider metadata");
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().lastRecordedThread.provider,
    "polo",
  );
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().pendingProvider, null);
});

test("Provider selection is restored after a failed new thread without leaking credentials", async (t) => {
  const calls = [];
  const requestClient = {
    async sendRequest(method, params) {
      calls.push({ method, params });
      if (method === "config/read") {
        return { config: { model_providers: { probe: {
          name: "Probe",
          base_url: "http://127.0.0.1:9/v1",
          env_key: "POLO_API_KEY",
        } } } };
      }
      if (method === "thread/start") throw new Error("probe failed");
      return {};
    },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local", requestClient, threadCreation: {},
    getHostId() { return "local"; }, startConversation() {}, clearPrewarmedThreads() {},
  };
  const { harness } = await setup(t, {
    clientThreadId: "client-new-thread:provider-restore", hasConversation: false,
  }, { memoCache: { data: [[manager]] } });
  assert.equal(harness.runNextTimer(), true);
  await harness.flush();
  const indicator = harness.document.querySelector('[data-codex-provider-indicator="true"]');
  indicator.click();
  await harness.flush();
  const probe = harness.document.querySelectorAll(".cbps-provider-menu-item").find((item) =>
    item.querySelector(".cbps-item-label")?.textContent === "Probe");
  assert.ok(probe);
  probe.click();
  await harness.flush();
  await assert.rejects(
    requestClient.sendRequest("thread/start", { threadSource: "user" }),
    /probe failed/,
  );
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().pendingProvider.id,
    "probe",
  );
  assert.equal(JSON.stringify(calls).includes("POLO_API_KEY"), false);
});
