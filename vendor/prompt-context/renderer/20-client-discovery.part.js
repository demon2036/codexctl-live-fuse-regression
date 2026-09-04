  const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
  const isObject = (value) => value !== null
    && (typeof value === "object" || typeof value === "function");
  const isDomNode = (value) => typeof Node === "function" && value instanceof Node;
  const isManagerCandidate = (value) => {
    if (!isObject(value) || isDomNode(value)) return false;
    try {
      return Object.prototype.hasOwnProperty.call(value, "hostId") && value.hostId === "local"
        && Object.prototype.hasOwnProperty.call(value, "requestClient")
        && Object.prototype.hasOwnProperty.call(value, "threadCreation")
        && typeof value.requestClient?.sendRequest === "function"
        && typeof value.requestClient?.prewarmThreadStart === "function"
        && typeof value.getHostId === "function"
        && typeof value.startConversation === "function"
        && typeof value.clearPrewarmedThreads === "function";
    } catch {
      return false;
    }
  };
  const managerFiberSeeds = () => {
    const nodes = new Set([document.documentElement, document.body].filter(Boolean));
    for (const selector of [
      '[data-codex-composer="true"]',
      "[data-composer-footer-responsive]",
      "[data-app-shell-main-surface]",
      "main",
    ]) {
      try {
        for (const node of document.querySelectorAll(selector)) {
          nodes.add(node);
          if (nodes.size >= 48) break;
        }
      } catch {}
    }
    const fibers = new Set();
    for (const start of nodes) {
      let node = start;
      for (let ancestor = 0; node && ancestor < 24 && fibers.size < 96; ancestor += 1) {
        let keys = [];
        try { keys = Object.keys(node); } catch {}
        for (const key of keys) {
          if (!key.startsWith("__reactFiber$")) continue;
          let fiber = node[key];
          for (let depth = 0; fiber && depth < 64 && fibers.size < 96; depth += 1) {
            if (fibers.has(fiber)) break;
            fibers.add(fiber);
            fiber = fiber.return;
          }
        }
        node = node.parentElement;
      }
      if (fibers.size >= 96) break;
    }
    return [...fibers];
  };

  const managerFromFiberMemoCache = (fibers) => {
    let visited = 0;
    const ownValue = (value, key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && "value" in descriptor ? descriptor.value : null;
      } catch {
        return null;
      }
    };
    for (const fiber of fibers) {
      const updateQueue = ownValue(fiber, "updateQueue");
      const memoCache = isObject(updateQueue) ? ownValue(updateQueue, "memoCache") : null;
      const data = isObject(memoCache) ? ownValue(memoCache, "data") : null;
      if (!Array.isArray(data)) continue;
      const queue = [data];
      const seen = new WeakSet();
      for (let cursor = 0; cursor < queue.length && visited < 512; cursor += 1) {
        const value = queue[cursor];
        if (!isObject(value) || seen.has(value)) continue;
        seen.add(value);
        visited += 1;
        if (isManagerCandidate(value)) return { manager: value, visited };
        if (!Array.isArray(value)) continue;
        for (let index = 0; index < Math.min(value.length, 64); index += 1) {
          if (isObject(value[index])) queue.push(value[index]);
        }
      }
    }
    return { manager: null, visited };
  };

  const yieldManagerScan = () => new Promise((resolve) => {
    let idle = null;
    let timer = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (state.managerSearchWake === wake) state.managerSearchWake = null;
      resolve();
    };
    const wake = () => {
      if (idle !== null) globalThis.cancelIdleCallback?.(idle);
      if (timer !== null) clearTimeout(timer);
      finish();
    };
    state.managerSearchWake = wake;
    if (typeof globalThis.requestIdleCallback === "function") {
      idle = globalThis.requestIdleCallback(finish, { timeout: 80 });
    } else timer = setTimeout(finish, 0);
  });

  const findManager = async (token, thorough = false) => {
    const seeds = managerFiberSeeds();
    if (seeds.length === 0) throw new Error("Manager probe is waiting for a mounted React shell");
    const startedAt = monotonicNow();
    const cached = managerFromFiberMemoCache(seeds);
    if (cached.manager) {
      const elapsed = monotonicNow() - startedAt;
      state.managerScanMetrics.totalVisited += cached.visited;
      state.managerScanMetrics.lastVisited = cached.visited;
      state.managerScanMetrics.lastDurationMs = Number(elapsed.toFixed(3));
      state.managerScanMetrics.lastResult = "found";
      state.managerScanMetrics.lastStrategy = "fiber-memo-cache";
      return cached.manager;
    }
    if (!thorough) {
      const elapsed = monotonicNow() - startedAt;
      state.managerScanMetrics.totalVisited += cached.visited;
      state.managerScanMetrics.lastVisited = cached.visited;
      state.managerScanMetrics.lastDurationMs = Number(elapsed.toFixed(3));
      state.managerScanMetrics.lastResult = "waiting";
      state.managerScanMetrics.lastStrategy = "fiber-memo-cache";
      throw new Error("Manager probe is waiting for the local memo cache");
    }
    await yieldManagerScan();
    if (token !== state.managerSearchToken) throw new Error("Manager probe cancelled");
    const queue = seeds.map((value) => ({ value, depth: 0, fiber: true }));
    const seen = new WeakSet();
    const priorityKeys = [
      "manager", "appServerManager", "memoizedState", "memoizedValue", "baseState",
      "firstContext", "next", "value", "current", "state", "store", "scope",
      "requestClient", "dependencies", "updateQueue", "pendingProps", "memoizedProps",
    ];
    const fiberKeys = [
      "memoizedState", "memoizedProps", "pendingProps", "dependencies", "updateQueue",
      "stateNode", "return",
    ];
    let cursor = 0;
    let visited = cached.visited;
    let maxSliceMs = 0;

    const enqueue = (value, depth, fiber = false) => {
      if (!isObject(value) || value === window || value === document || isDomNode(value)
        || depth > MANAGER_SCAN_MAX_DEPTH) return;
      queue.push({ value, depth, fiber });
    };
    const enqueueDescriptor = (value, key, depth, fiber = false) => {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { return; }
      if (descriptor && "value" in descriptor) enqueue(descriptor.value, depth, fiber);
    };

    while (cursor < queue.length && visited < MANAGER_SCAN_MAX_OBJECTS) {
      if (token !== state.managerSearchToken) throw new Error("Manager probe cancelled");
      const sliceStartedAt = monotonicNow();
      let sliceObjects = 0;
      while (cursor < queue.length && visited < MANAGER_SCAN_MAX_OBJECTS
        && sliceObjects < MANAGER_SCAN_SLICE_OBJECTS
        && monotonicNow() - sliceStartedAt < MANAGER_SCAN_SLICE_MS) {
        const entry = queue[cursor++];
        const value = entry.value;
        if (seen.has(value)) continue;
        seen.add(value);
        visited += 1;
        sliceObjects += 1;
        if (isManagerCandidate(value)) {
          const elapsed = monotonicNow() - startedAt;
          state.managerScanMetrics.totalVisited += visited;
          state.managerScanMetrics.lastVisited = visited;
          state.managerScanMetrics.lastDurationMs = Number(elapsed.toFixed(3));
          state.managerScanMetrics.maxSliceMs = Number(Math.max(
            state.managerScanMetrics.maxSliceMs,
            maxSliceMs,
            monotonicNow() - sliceStartedAt,
          ).toFixed(3));
          state.managerScanMetrics.lastResult = "found";
          state.managerScanMetrics.lastStrategy = "bounded-graph";
          return value;
        }
        if (entry.depth >= MANAGER_SCAN_MAX_DEPTH) continue;
        if (entry.fiber) {
          for (const key of fiberKeys) {
            enqueueDescriptor(value, key, entry.depth + 1, key === "return");
          }
          continue;
        }
        if (Array.isArray(value)) {
          for (let index = 0; index < Math.min(value.length, 80); index += 1) {
            enqueue(value[index], entry.depth + 1);
          }
          continue;
        }
        if (value instanceof Map) {
          let count = 0;
          for (const [key, child] of value) {
            enqueue(key, entry.depth + 1);
            enqueue(child, entry.depth + 1);
            if (++count >= 80) break;
          }
          continue;
        }
        if (value instanceof Set) {
          let count = 0;
          for (const child of value) {
            enqueue(child, entry.depth + 1);
            if (++count >= 80) break;
          }
          continue;
        }
        if (value instanceof WeakMap || value instanceof WeakSet
          || value instanceof Date || value instanceof RegExp
          || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;

        const scheduledKeys = new Set();
        for (const key of priorityKeys) {
          scheduledKeys.add(key);
          enqueueDescriptor(value, key, entry.depth + 1);
        }
        let keys = [];
        try { keys = Reflect.ownKeys(value); } catch {}
        let ordinaryKeys = 0;
        for (const key of keys) {
          if (typeof key !== "string" || scheduledKeys.has(key)) continue;
          enqueueDescriptor(value, key, entry.depth + 1);
          ordinaryKeys += 1;
          if (ordinaryKeys >= 64) break;
        }
      }
      maxSliceMs = Math.max(maxSliceMs, monotonicNow() - sliceStartedAt);
      state.managerScanMetrics.lastVisited = visited;
      state.managerScanMetrics.maxSliceMs = Number(Math.max(
        state.managerScanMetrics.maxSliceMs,
        maxSliceMs,
      ).toFixed(3));
      if (cursor < queue.length && visited < MANAGER_SCAN_MAX_OBJECTS) await yieldManagerScan();
    }
    const elapsed = monotonicNow() - startedAt;
    state.managerScanMetrics.totalVisited += visited;
    state.managerScanMetrics.lastVisited = visited;
    state.managerScanMetrics.lastDurationMs = Number(elapsed.toFixed(3));
    state.managerScanMetrics.lastResult = "not-found";
    state.managerScanMetrics.lastStrategy = "bounded-graph";
    throw new Error(`Manager probe found no local candidate after ${visited} bounded objects`);
  };
