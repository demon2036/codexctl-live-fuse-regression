"use strict";

(() => {
  const THREAD = "11111111-2222-4333-8444-555555555555";
  const calls = [];
  let createdThread = 0;
  let resumeFailure = false;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const conversation = {
    latestTokenUsageInfo: {
      last: {
        inputTokens: 204944,
        cachedInputTokens: 200192,
        outputTokens: 1298,
        reasoningOutputTokens: 719,
        totalTokens: 206242,
      },
      total: {
        inputTokens: 4233166,
        cachedInputTokens: 4024832,
        outputTokens: 20944,
        reasoningOutputTokens: 9129,
        totalTokens: 4254110,
      },
      modelContextWindow: 258400,
      contextBreakdown: {
        tool_calls: 62000,
        developer: 46000,
        messages: 42000,
        tools: 26000,
        reasoning: 16000,
        system_prompt: 8000,
      },
    },
    turns: [
      { items: [{ type: "contextCompaction", status: "completed" }] },
      { items: [
        { type: "systemMessage", role: "system", content: "Fixture system rules" },
        { type: "developerMessage", role: "developer", content: "Fixture developer rules" },
        { type: "userMessage", role: "user", content: "Inspect the fixture" },
        { type: "agentMessage", role: "assistant", content: "Fixture response" },
        { type: "functionCall", role: "assistant", name: "shell", arguments: { cmd: "pwd" } },
        { type: "functionCallOutput", role: "tool", output: "/isolated/fixture" },
        { type: "reasoning", role: "assistant", summary: "Inspect fixture state first" },
      ] },
    ],
    resumeState: "resumed",
    threadRuntimeStatus: { type: "idle" },
  };
  const conversations = new Map([[THREAD, conversation]]);
  const notificationSubscriptions = new Set();
  const requestClient = {
    async sendRequest(method, params = {}) {
      calls.push({ method, params: clone(params) });
      if (method === "thread/read") {
        const active = conversations.get(params.threadId || THREAD) || conversation;
        return { thread: { id: params.threadId || THREAD,
          status: clone(active.threadRuntimeStatus) } };
      }
      if (method === "thread/start") {
        createdThread += 1;
        const id = `${String(createdThread).padStart(8, "0")}-3333-4444-8555-666666666666`;
        conversations.set(id, {
          latestTokenUsageInfo: { last: { totalTokens: 0 }, modelContextWindow: 258400 },
          resumeState: "resumed", threadRuntimeStatus: { type: "idle" },
        });
        return { thread: { id, status: { type: "idle" } } };
      }
      if (method === "thread/resume" && resumeFailure) {
        resumeFailure = false;
        throw new Error("fixture-resume-failure");
      }
      return { thread: { id: params.threadId || THREAD, status: { type: "idle" } } };
    },
    async prewarmThreadStart(params = {}) {
      calls.push({ method: "thread/prewarm", params: clone(params) });
      return { thread: { id: THREAD, status: { type: "idle" } } };
    },
  };
  const manager = {
    hostId: "local", requestClient, threadCreation: {}, conversations,
    getConversation(id) { return conversations.get(id) || null; },
    getHostId() { return "local"; },
    startConversation() {}, clearPrewarmedThreads() {},
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
  let currentThreadId = THREAD;
  let composer = document.getElementById("composer");
  const footerTemplate = document.getElementById("composer-footer").cloneNode(true);
  const nativeEvents = { contextHover: 0, sendClick: 0 };
  const attachComposer = (node) => {
    composer = node;
    composer.__reactFiber$regression = {
      memoizedProps: { conversationId: currentThreadId, hasConversation: true },
      updateQueue: { memoCache: { data: [[manager]] } },
      return: null,
    };
    document.getElementById("native-context")?.addEventListener("pointerover", () => {
      nativeEvents.contextHover += 1;
    });
    document.getElementById("native-send")?.addEventListener("click", () => {
      nativeEvents.sendClick += 1;
    });
  };
  attachComposer(composer);

  const sidebar = document.getElementById("sidebar");
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 120; index += 1) {
    const row = document.createElement("div");
    row.className = "session";
    row.textContent = `Session ${index + 1}`;
    fragment.append(row);
  }
  sidebar.append(fragment);

  const counters = {
    intervals: 0, mutationObservers: 0, resizeObservers: 0, workers: 0,
    hotListeners: { beforeinput: 0, input: 0, scroll: 0 },
  };
  const OriginalMutationObserver = window.MutationObserver;
  const OriginalResizeObserver = window.ResizeObserver;
  const OriginalWorker = window.Worker;
  const originalSetInterval = window.setInterval;
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  window.MutationObserver = class extends OriginalMutationObserver {
    constructor(callback) { super(callback); counters.mutationObservers += 1; }
  };
  window.ResizeObserver = class extends OriginalResizeObserver {
    constructor(callback) { super(callback); counters.resizeObservers += 1; }
  };
  if (OriginalWorker) {
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); counters.workers += 1; }
    };
  }
  window.setInterval = (...args) => {
    counters.intervals += 1;
    return originalSetInterval(...args);
  };
  EventTarget.prototype.addEventListener = function tracked(type, ...args) {
    if (Object.hasOwn(counters.hotListeners, type)
      && (this === window || this === document || this === composer || this === sidebar)) {
      counters.hotListeners[type] += 1;
    }
    return originalAddEventListener.call(this, type, ...args);
  };

  window.__CODEXCTL_REGRESSION_APP__ = {
    schema: "codexctl-electron-fixture/1",
    loadedAtMs: performance.now(),
    remote: { errors: [], status: "connected" },
    threadId: THREAD,
    calls,
    counters,
    manager,
    conversation,
    nativeEvents,
    showSkillMenu(open = true) {
      const menu = document.getElementById("native-skill-menu");
      if (menu) menu.setAttribute("data-open", open ? "true" : "false");
      return menu;
    },
    showStaleComposer(open = true) {
      const footer = document.getElementById("stale-composer-footer");
      if (footer) footer.style.display = open ? "flex" : "none";
      return footer;
    },
    unmountComposer() {
      document.getElementById("composer-footer")?.remove();
    },
    mountComposer() {
      const footer = footerTemplate.cloneNode(true);
      document.getElementById("bottom-surface").appendChild(footer);
      attachComposer(footer.querySelector('[data-codex-composer="true"]'));
      return footer;
    },
    setBlankNewConversation(clientThreadId = "client-new-thread:cold-start") {
      currentThreadId = null;
      composer.__reactFiber$regression.memoizedProps = {
        clientThreadId,
        hasConversation: false,
      };
      return clientThreadId;
    },
    setCurrentThread(id, status = "idle") {
      if (!conversations.has(id)) conversations.set(id, {
        latestTokenUsageInfo: { last: { totalTokens: 100000 }, modelContextWindow: 258400 },
        resumeState: "resumed", threadRuntimeStatus: { type: status },
      });
      currentThreadId = id;
      composer.__reactFiber$regression.memoizedProps = {
        conversationId: id,
        hasConversation: true,
      };
      return id;
    },
    setThreadStatus(status) {
      const id = composer.__reactFiber$regression.memoizedProps.conversationId;
      conversations.get(id).threadRuntimeStatus = { type: status };
    },
    setUsage(modelContextWindow, totalTokens = 100000) {
      const id = composer.__reactFiber$regression.memoizedProps.conversationId;
      const current = conversations.get(id).latestTokenUsageInfo ?? {};
      conversations.get(id).latestTokenUsageInfo = {
        ...current,
        last: { ...(current.last ?? {}), totalTokens },
        modelContextWindow,
      };
      manager.emitNotification({ method: "thread/tokenUsage/updated", params: { threadId: id } });
    },
    failNextResume() { resumeFailure = true; },
    resetCalls() { calls.length = 0; },
  };
})();
