import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "./prompt-renderer-harness.mjs";

export const CONTEXT_USAGE_THREAD_ID = "11111111-2222-4333-8444-555555555555";

export async function setupContextUsageConversation(t, conversation, options = {}) {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const requestClient = {
    async sendRequest() { return {}; },
    async prewarmThreadStart() { return {}; },
  };
  const conversations = new Map([[CONTEXT_USAGE_THREAD_ID, conversation]]);
  const notificationSubscriptions = new Set();
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations,
    getHostId() { return "local"; },
    getConversation(threadId) { return conversations.get(threadId) ?? null; },
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

  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  footer.setBoundingClientRect({ left: 260, top: 620, width: 760, height: 36 });
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.setAttribute("data-composer-navigation-target", "permissions");
  permission.setBoundingClientRect({ left: 420, top: 624, width: 100, height: 28 });
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);
  composer.__reactFiber$codexctl = {
    memoizedProps: options.composerProps
      ?? { conversationId: CONTEXT_USAGE_THREAD_ID, hasConversation: true },
    updateQueue: { memoCache: { data: [[manager]] } },
    return: null,
  };

  harness.dispatchDocument("readystatechange");
  await harness.flush();
  if (!harness.runNextTimer()) throw new Error("manager discovery should run");
  await harness.flush();
  return { fixture, harness, manager, conversation, composer };
}
