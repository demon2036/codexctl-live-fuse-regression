function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs 必须是有限正整数");
  }
}

export function createCleanupStack() {
  const actions = [];
  let completed = false;
  let running = null;
  return {
    defer(action) {
      if (completed || running) throw new Error("cleanup 已经开始，不能再登记资源");
      if (typeof action !== "function") throw new TypeError("cleanup action 必须是函数");
      actions.push(action);
    },
    async run() {
      if (completed) return;
      if (running) return running;
      running = (async () => {
        const failures = [];
        for (const action of actions.reverse()) {
          try {
            await action();
          } catch (error) {
            failures.push(error);
          }
        }
        completed = true;
        if (failures.length > 0) {
          throw codedError("CLEANUP_FAILED", `有 ${failures.length} 项资源清理失败`, { failures });
        }
      })();
      try {
        await running;
      } finally {
        running = null;
      }
    },
  };
}

export function waitForEvent(source, eventName, { signal, timeoutMs } = {}) {
  assertTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      source.off(eventName, onEvent);
      source.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (settle, value) => {
      cleanup();
      settle(value);
    };
    const onEvent = (value) => finish(resolve, value);
    const onError = (cause) => finish(reject, codedError(
      "EVENT_SOURCE_FAILED",
      `等待 ${eventName} 时事件源失败`,
      { cause },
    ));
    const onAbort = () => finish(reject, codedError("RUN_ABORTED", `等待 ${eventName} 已中止`));
    source.on(eventName, onEvent);
    source.on("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(reject, codedError(
      "DEADLINE_EXCEEDED",
      `等待 ${eventName} 超过 ${timeoutMs}ms`,
    )), timeoutMs);
    if (signal?.aborted) onAbort();
  });
}

export async function runBounded(action, {
  cleanup = async () => {},
  signals = process,
  timeoutMs,
} = {}) {
  assertTimeout(timeoutMs);
  if (typeof action !== "function" || typeof cleanup !== "function") {
    throw new TypeError("action 和 cleanup 必须是函数");
  }
  const controller = new AbortController();
  const childReleases = new Set();
  let fatalError = null;
  let rejectFatal;
  const fatal = new Promise((resolve, reject) => { rejectFatal = reject; });
  const abortWith = (error) => {
    if (fatalError) return;
    fatalError = error;
    rejectFatal(error);
    controller.abort(error.code);
  };
  const signalHandlers = new Map(["SIGINT", "SIGTERM"].map((signalName) => [
    signalName,
    () => abortWith(codedError("RUN_SIGNALLED", `收到 ${signalName}，回归已中止`, { signalName })),
  ]));
  for (const [name, handler] of signalHandlers) signals.on(name, handler);
  const deadline = setTimeout(() => abortWith(codedError(
    "DEADLINE_EXCEEDED",
    `回归超过 ${timeoutMs}ms deadline`,
  )), timeoutMs);

  const watchChild = (child) => {
    if (!child || typeof child.on !== "function" || typeof child.off !== "function") {
      throw new TypeError("child 必须是 EventEmitter");
    }
    const onError = (cause) => abortWith(codedError("CHILD_FAILED", "子进程异常", { cause }));
    const onExit = (code, exitSignal) => {
      if (code !== 0 && code !== null) {
        abortWith(codedError("CHILD_FAILED", `子进程异常退出：${code}`, { exitSignal }));
      }
    };
    child.on("error", onError);
    child.on("exit", onExit);
    const release = () => {
      child.off("error", onError);
      child.off("exit", onExit);
      childReleases.delete(release);
    };
    childReleases.add(release);
    return release;
  };

  let value;
  let primaryError;
  try {
    const work = Promise.resolve(action({ signal: controller.signal, watchChild }));
    value = await Promise.race([work, fatal]);
    if (fatalError) throw fatalError;
  } catch (error) {
    primaryError = fatalError ?? error;
  } finally {
    clearTimeout(deadline);
    for (const [name, handler] of signalHandlers) signals.off(name, handler);
    for (const release of [...childReleases]) release();
    controller.abort("run-complete");
    try {
      await cleanup();
    } catch (error) {
      if (!primaryError) primaryError = error;
      else primaryError.cleanupError = error;
    }
  }
  if (primaryError) throw primaryError;
  return value;
}
