import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

async function setup(t, harnessOptions = {}) {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload, harnessOptions);
  t.after(() => harness.cleanup());
  harness.createDom();
  return { fixture, harness };
}

test("startup manager probing stays on the lightweight memo-cache path", async (t) => {
  const { fixture, harness } = await setup(t);
  const composer = harness.document.createElement("section");
  harness.document.body.appendChild(composer);
  composer.__reactFiber$codexctl = {
    updateQueue: { memoCache: { data: [[{ unrelated: true }]] } },
    return: null,
  };
  harness.document.querySelectorAll = (selector) =>
    selector === '[data-codex-composer="true"]' ? [composer] : [];

  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true);
  await harness.flush();

  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.managerProbe.attempts, 1);
  assert.equal(diagnostics.managerProbe.lastStrategy, "fiber-memo-cache");
  assert.equal(diagnostics.managerProbe.maxSliceMs, 0);
  assert.equal(diagnostics.activeTimers.managerProbe, 1);
  assert.match(fixture.loaded.payload, /MANAGER_MAX_PROBES = 16/);
  assert.match(fixture.loaded.payload, /MANAGER_GRAPH_PROBE_ATTEMPT = 4/);
});

test("an incompatible startup performs one idle graph scan and then stops", async (t) => {
  const { harness } = await setup(t);
  const composer = harness.document.createElement("section");
  harness.document.body.appendChild(composer);
  composer.__reactFiber$codexctl = {
    updateQueue: { memoCache: { data: [[{ unrelated: true }]] } },
    return: null,
  };
  harness.document.querySelectorAll = (selector) =>
    selector === '[data-codex-composer="true"]' ? [composer] : [];
  harness.dispatchDocument("readystatechange");
  await harness.flush();

  for (let step = 0; step < 40; step += 1) {
    const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
    if (diagnostics.managerStatus === "incompatible") break;
    assert.equal(harness.runNextTimer(), true, `probe sequence stalled at step ${step}`);
    await harness.flush();
  }

  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.managerStatus, "incompatible");
  assert.equal(diagnostics.managerProbe.attempts, 16);
  assert.equal(diagnostics.managerProbe.graphAttempts, 1);
  assert.equal(harness.idleCallbacks.scheduled, 1, "the graph scan must begin in browser idle time");
  assert.equal(diagnostics.activeTimers.managerProbe, 0);
  assert.equal(harness.timers.size, 0);
});

test("startup probe mounts controls when the composer appears after DOM ready", async (t) => {
  const { harness } = await setup(t);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-context-window-trigger="true"]',
  ).length, 0);

  const footer = harness.document.createElement("section");
  footer.setAttribute("data-composer-footer-responsive", "true");
  const composer = harness.document.createElement("div");
  composer.setAttribute("data-codex-composer", "true");
  const permissionRow = harness.document.createElement("div");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  footer.append(composer, permissionRow);
  permissionRow.appendChild(permission);
  harness.document.body.appendChild(footer);

  assert.equal(harness.runNextTimer(), true, "the bounded startup probe should run");
  await harness.flush();
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-context-window-trigger="true"]',
  ).length, 1);
  assert.equal(harness.document.querySelectorAll(
    '[data-codex-base-prompt-trigger="true"]',
  ).length, 1);
});

test("rapid Sessions navigation coalesces repair work to three timers", async (t) => {
  const { harness } = await setup(t);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  const before = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  const target = {
    closest(selector) { return selector === "aside.app-shell-left-panel" ? {} : null; },
  };

  for (let index = 0; index < 100; index += 1) {
    harness.dispatchDocument("pointerdown", { target });
  }
  await harness.flush();

  const after = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(after.uiMetrics.navigationRepairs - before.uiMetrics.navigationRepairs, 100);
  assert.equal(after.uiMetrics.ensureSchedules, before.uiMetrics.ensureSchedules + 1);
  assert.equal(after.activeTimers.navigation, 3);
  assert.equal(harness.timers.size, 4, "one manager timer plus three coalesced repairs");
});

test("[INJECTION-LIFECYCLE-STARTUP-NAVIGATION-001] completed Session data repairs a composer mounted after click timers", async (t) => {
  const { harness } = await setup(t);
  const requestClient = {
    async sendRequest() { return {}; },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations: new Map(),
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const mountComposer = () => {
    const footer = harness.document.createElement("footer");
    footer.setAttribute("data-composer-footer-responsive", "true");
    const composer = harness.document.createElement("section");
    composer.setAttribute("data-codex-composer", "true");
    const permission = harness.document.createElement("button");
    permission.setAttribute("data-composer-navigation-target", "permissions");
    footer.append(composer, permission);
    harness.document.body.appendChild(footer);
    composer.__reactFiber$codexctl = {
      updateQueue: { memoCache: { data: [[manager]] } },
      return: null,
    };
    return footer;
  };

  const oldFooter = mountComposer();
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true, "manager discovery should patch the request client");
  await harness.flush();
  oldFooter.remove();
  const sidebarTarget = {
    closest(selector) { return selector === "aside.app-shell-left-panel" ? {} : null; },
  };
  harness.dispatchDocument("pointerdown", { target: sidebarTarget });
  await harness.flush();
  while (harness.runNextTimer()) await harness.flush();
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount, 1);
  assert.equal(harness.document.getElementById("codex-prompt-context-control-host").hidden, true);

  await requestClient.sendRequest("thread/read", { threadId: "11111111-2222-4333-8444-555555555555" });
  mountComposer();
  assert.equal(harness.runNextTimer(), true, "request completion should schedule a bounded repair");
  await harness.flush();

  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.buttonCount, 1);
  assert.equal(diagnostics.contextButtonCount, 1);
  assert.ok(diagnostics.activeTimers.navigation <= 3);
});

test("turn completion repairs controls after the request repair window expires", async (t) => {
  const { harness } = await setup(t);
  const notificationSubscriptions = new Set();
  const requestClient = {
    async sendRequest() { return {}; },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations: new Map(),
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
    addNotificationCallback(methods, callback) {
      const subscription = {
        callback,
        methods: new Set(Array.isArray(methods) ? methods : [methods]),
      };
      notificationSubscriptions.add(subscription);
      return () => notificationSubscriptions.delete(subscription);
    },
    emitNotification(notification) {
      for (const subscription of notificationSubscriptions) {
        if (subscription.methods.has(notification.method)) subscription.callback(notification);
      }
    },
  };
  const mountComposer = () => {
    const footer = harness.document.createElement("footer");
    footer.setAttribute("data-composer-footer-responsive", "true");
    const composer = harness.document.createElement("section");
    composer.setAttribute("data-codex-composer", "true");
    const permission = harness.document.createElement("button");
    permission.setAttribute("data-composer-navigation-target", "permissions");
    footer.append(composer, permission);
    harness.document.body.appendChild(footer);
    composer.__reactFiber$codexctl = {
      updateQueue: { memoCache: { data: [[manager]] } },
      return: null,
    };
    return footer;
  };

  const oldFooter = mountComposer();
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true, "manager discovery should patch the request client");
  await harness.flush();
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount, 1);

  await requestClient.sendRequest("turn/start", {
    threadId: "11111111-2222-4333-8444-555555555555",
    input: [{ type: "text", text: "long turn" }],
  });
  oldFooter.remove();
  await harness.flush();
  while (harness.runNextTimer()) await harness.flush();
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount,
    1,
    "the exhausted repair window must preserve the existing control",
  );
  assert.equal(harness.document.getElementById("codex-prompt-context-control-host").hidden, true);

  mountComposer();
  await harness.flush();
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount,
    1,
    "a late composer keeps the existing control until the completion repair",
  );

  manager.emitNotification({
    method: "turn/completed",
    params: {
      threadId: "11111111-2222-4333-8444-555555555555",
      turn: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", status: "completed" },
    },
  });
  await harness.flush();

  const repaired = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(repaired.buttonCount, 1);
  assert.equal(repaired.contextButtonCount, 1);
  assert.equal(repaired.providerIndicatorCount, 1);
});

test("final Codex app routes ready repairs controls replaced after the early startup receipt", async (t) => {
  const { harness } = await setup(t, {
    windowOverrides: { electronBridge: { sendMessageFromView() {} } },
  });
  const requestClient = {
    async sendRequest() { return {}; },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations: new Map(),
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const mountComposer = () => {
    const footer = harness.document.createElement("footer");
    footer.setAttribute("data-composer-footer-responsive", "true");
    const composer = harness.document.createElement("section");
    composer.setAttribute("data-codex-composer", "true");
    const permission = harness.document.createElement("button");
    permission.setAttribute("data-composer-navigation-target", "permissions");
    footer.append(composer, permission);
    harness.document.body.appendChild(footer);
    composer.__reactFiber$codexctl = {
      updateQueue: { memoCache: { data: [[manager]] } },
      return: null,
    };
    return footer;
  };

  const earlyFooter = mountComposer();
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  assert.equal(harness.runNextTimer(), true, "manager discovery should mount early controls");
  await harness.flush();
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount, 1);

  earlyFooter.remove();
  harness.dispatchWindow("popstate");
  await harness.flush();
  while (harness.runNextTimer()) await harness.flush();
  mountComposer();
  await harness.flush();
  assert.equal(
    harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().buttonCount,
    1,
    "the final React routes must reuse the retained control after early repairs expire",
  );
  assert.equal(harness.document.getElementById("codex-prompt-context-control-host").hidden, true);

  harness.dispatchWindow("codex-message-from-view", { detail: { type: "ready" } });
  await harness.flush();

  const repaired = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(repaired.appRoutesReady, true);
  assert.equal(repaired.buttonCount, 1);
  assert.equal(repaired.contextButtonCount, 1);
  assert.equal(repaired.providerIndicatorCount, 1);
  assert.equal(harness.listenerCount("window", "codex-message-from-view"), 0);
});

test("typing events schedule no Prompt/Context reconciliation", async (t) => {
  const { harness } = await setup(t);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  const before = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  const timerCount = harness.timers.size;

  for (let index = 0; index < 1000; index += 1) {
    harness.dispatchDocument("beforeinput", { data: "a" });
    harness.dispatchDocument("input", { data: "a" });
    harness.dispatchDocument("keydown", { key: "a" });
  }
  await harness.flush();

  const after = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(after.uiMetrics.ensureSchedules, before.uiMetrics.ensureSchedules);
  assert.equal(after.uiMetrics.positionPasses, before.uiMetrics.positionPasses);
  assert.equal(harness.timers.size, timerCount);
});

test("cleanup drains manager, navigation, toast timers and global listeners", async (t) => {
  const { harness } = await setup(t);
  harness.dispatchDocument("readystatechange");
  await harness.flush();
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  const target = { closest() { return {}; } };
  harness.dispatchDocument("pointerdown", { target });
  await api.selectProfile({ id: "default", label: "Default", path: null });
  await harness.flush();
  assert.ok(harness.timers.size >= 5);

  api.cleanup();
  const diagnostics = api.diagnostics();
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.activeTimers)), {
    managerProbe: 0,
    navigation: 0,
    toast: 0,
    bridge: 0,
  });
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listenerCount("document", "pointerdown"), 0);
  assert.equal(harness.listenerCount("document", "keydown"), 0);
  assert.equal(harness.listenerCount("window", "resize"), 0);
  assert.equal(harness.listenerCount("window", "popstate"), 0);
  assert.equal(harness.listenerCount("window", "hashchange"), 0);
});
