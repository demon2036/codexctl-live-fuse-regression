export function contextBrowserBootstrap(encodedPayload) {
  return `
  const THREAD_A = "11111111-2222-4333-8444-555555555555";
  const THREAD_B = "22222222-3333-4444-8555-666666666666";
  const THREAD_C = "33333333-4444-4555-8666-777777777777";
  const THREAD_D = "44444444-5555-4666-8777-888888888888";
  const THREAD_E = "55555555-6666-4777-8888-999999999999";
  const CREATED_THREADS = [
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  ];
  const OAI = { id: "oai", label: "Legacy OAI 272K", contextWindow: 272000,
    autoCompactTokenLimit: 244800, scope: "total" };
  const LARGE = { id: "450k", label: "450K", contextWindow: 450000,
    autoCompactTokenLimit: 400000, scope: "total" };
  const MEDIUM = { id: "400k", label: "400K", contextWindow: 400000,
    autoCompactTokenLimit: 360000, scope: "total" };
  const XL = { id: "600k", label: "600K", contextWindow: 600000,
    autoCompactTokenLimit: 540000, scope: "total" };
  const NATIVE = { id: "native", label: "Native / Official", native: true };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const makeConversation = (status = "idle") => ({
    latestTokenUsageInfo: { last: { totalTokens: 100000 }, modelContextWindow: 258400 },
    resumeState: "resumed",
    threadRuntimeStatus: { type: status },
  });
  const calls = [];
  let createdThreadIndex = 0;
  const conversations = new Map([[THREAD_A, makeConversation()]]);
  const requestClient = {
    async sendRequest(method, params) {
      calls.push({ method, params: clone(params) });
      const threadId = params && params.threadId ? params.threadId : THREAD_A;
      const conversation = conversations.get(threadId);
      if (method === "thread/read") {
        return { thread: { id: threadId,
          status: clone(conversation
            ? conversation.serverStatus || conversation.threadRuntimeStatus
            : { type: "notLoaded" }) } };
      }
      if (method === "thread/start") {
        const createdId = CREATED_THREADS[createdThreadIndex++] || THREAD_A;
        return { thread: { id: createdId, status: { type: "idle" } } };
      }
      return { thread: { id: threadId, status: { type: "idle" } } };
    },
    async prewarmThreadStart(params) {
      calls.push({ method: "thread/prewarm", params: clone(params) });
      return { thread: { id: THREAD_A, status: { type: "idle" } } };
    },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations,
    getConversation(threadId) { return conversations.get(threadId) || null; },
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  const composer = document.querySelector('[data-codex-composer="true"]');
  const fiber = {
    memoizedProps: { conversationId: THREAD_A, hasConversation: true },
    updateQueue: { memoCache: { data: [[manager]] } },
    return: null,
  };
  composer.__reactFiber$contextRegression = fiber;

  const OriginalMutationObserver = window.MutationObserver;
  const OriginalResizeObserver = window.ResizeObserver;
  const originalSetInterval = window.setInterval;
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  let mutationObserverCount = 0;
  let resizeObserverCount = 0;
  let intervalCount = 0;
  const hotListenerCounts = { beforeinput: 0, input: 0, scroll: 0 };
  window.MutationObserver = class extends OriginalMutationObserver {
    constructor(callback) { super(callback); mutationObserverCount += 1; }
  };
  window.ResizeObserver = class extends OriginalResizeObserver {
    constructor(callback) { super(callback); resizeObserverCount += 1; }
  };
  window.setInterval = (...args) => {
    intervalCount += 1;
    return originalSetInterval(...args);
  };
  EventTarget.prototype.addEventListener = function trackedListener(type, ...args) {
    if (Object.hasOwn(hotListenerCounts, type)
      && (this === window || this === document || this === composer)) {
      hotListenerCounts[type] += 1;
    }
    return originalAddEventListener.call(this, type, ...args);
  };
  const source = new TextDecoder().decode(Uint8Array.from(
    atob(${JSON.stringify(encodedPayload)}), (character) => character.charCodeAt(0),
  ));
  window.eval(source);

  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for "
      + (typeof label === "function" ? label() : label));
  };
  const recordNative = (api, threadId) => api.recordThreadFromResult(
    { thread: { id: threadId } },
    { id: "default", label: "Default" },
    NATIVE,
    "browser/native",
    { prompt: false, context: false },
  );`;
}
