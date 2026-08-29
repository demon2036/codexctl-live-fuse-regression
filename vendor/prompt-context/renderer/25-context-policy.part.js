  const contextsEqual = (left, right) => Boolean(left && right
    && left.native === right.native
    && left.contextWindow === right.contextWindow
    && left.autoCompactTokenLimit === right.autoCompactTokenLimit
    && left.scope === right.scope);

  const tokenUsageForThread = (threadId) => {
    let conversation = null;
    try { conversation = state.manager?.getConversation?.(threadId) ?? null; } catch {}
    const usage = conversation?.latestTokenUsageInfo ?? null;
    const totalValue = usage?.last?.totalTokens;
    const windowValue = usage?.modelContextWindow;
    return {
      totalTokens: totalValue != null && Number.isFinite(Number(totalValue))
        ? Number(totalValue) : null,
      modelContextWindow: windowValue != null && Number.isFinite(Number(windowValue))
        ? Number(windowValue) : null,
      resumeState: conversation?.resumeState ?? null,
      runtimeStatus: conversation?.threadRuntimeStatus?.type ?? null,
    };
  };

  const configuredWindowForRuntime = (runtimeWindow) => {
    if (!Number.isInteger(runtimeWindow)) return null;
    const exact = CONTEXT_PRESETS.find((context) =>
      Number.isInteger(context.contextWindow) && context.contextWindow === runtimeWindow);
    if (exact) return exact.contextWindow;
    const effective = CONTEXT_PRESETS.find((context) =>
      Number.isInteger(context.contextWindow)
      && runtimeReportedContextWindow(context.contextWindow) === runtimeWindow);
    return effective?.contextWindow ?? null;
  };

  const rememberNativeContextWindow = (threadId, contextWindow) => {
    if (!hasThreadRecord(threadId) || !Number.isInteger(contextWindow)) return false;
    const entry = state.threadMap[threadId];
    if (entry.nativeContextWindow === contextWindow) return true;
    state.threadMap[threadId] = {
      ...entry,
      nativeContextWindow: contextWindow,
      nativeContextObservedAt: Date.now(),
    };
    persist(localStorage, THREAD_MAP_KEY, state.threadMap);
    return true;
  };

  const nativeContextWindowForThread = (threadId) => {
    const entry = state.threadMap[threadId];
    if (!entry) return null;
    if (Number.isInteger(entry.nativeContextWindow)) return entry.nativeContextWindow;
    const recorded = normalizeContext(entry.context, "recorded");
    if (entry.applied?.context === true || recorded?.native !== true) return null;
    const contextWindow = configuredWindowForRuntime(
      tokenUsageForThread(threadId).modelContextWindow,
    );
    if (Number.isInteger(contextWindow)) rememberNativeContextWindow(threadId, contextWindow);
    return contextWindow;
  };

  const rejectedContextSwitch = (code, currentWindow, targetWindow, message) => ({
    action: "reject",
    code,
    currentWindow,
    targetWindow,
    message,
  });

  const contextSwitchForThread = (threadId) =>
    state.contextSwitchByThread.get(threadId) ?? null;

  const rememberContextSwitch = (record) => {
    if (record?.threadId) {
      state.contextSwitchByThread.delete(record.threadId);
      state.contextSwitchByThread.set(record.threadId, record);
      while (state.contextSwitchByThread.size > 256) {
        state.contextSwitchByThread.delete(state.contextSwitchByThread.keys().next().value);
      }
    }
    state.lastContextSwitch = record;
    return record;
  };

  const contextSwitchDecision = ({
    current,
    target,
    nativeContextWindow = null,
    totalTokens = null,
  } = {}) => {
    const normalizedCurrent = normalizeContext(current, current?.source ?? "current");
    const normalizedTarget = normalizeContext(target, target?.source ?? "selected");
    if (!normalizedCurrent || !normalizedTarget) {
      return rejectedContextSwitch("invalid-context", null, null, "上下文配置无效");
    }
    if (contextsEqual(normalizedCurrent, normalizedTarget)) {
      return { action: "noop", code: "already-applied" };
    }
    const currentWindow = normalizedCurrent.native
      ? nativeContextWindow : normalizedCurrent.contextWindow;
    const targetWindow = normalizedTarget.native
      ? nativeContextWindow : normalizedTarget.contextWindow;
    if (!Number.isInteger(currentWindow) || !Number.isInteger(targetWindow)) {
      const nativeInvolved = normalizedCurrent.native || normalizedTarget.native;
      return rejectedContextSwitch(
        nativeInvolved ? "native-capacity-unknown" : "current-capacity-unknown",
        currentWindow,
        targetWindow,
        nativeInvolved
          ? "无法确认当前 App、model 与 provider 的 Native 官方容量；当前 task 保持不变"
          : "无法确认当前 task 的 Context 容量；当前 task 保持不变",
      );
    }
    if (targetWindow < currentWindow) {
      return rejectedContextSwitch(
        "context-window-decrease",
        currentWindow,
        targetWindow,
        `目标 Context ${formatTokenCount(targetWindow)} 小于当前 ${formatTokenCount(currentWindow)}；当前 task 不缩容`,
      );
    }
    const currentCompact = normalizedCurrent.autoCompactTokenLimit;
    const targetCompact = normalizedTarget.autoCompactTokenLimit;
    if (Number.isInteger(currentCompact) && Number.isInteger(targetCompact)
      && targetCompact < currentCompact) {
      return rejectedContextSwitch(
        "compact-limit-decrease",
        currentWindow,
        targetWindow,
        `目标 compact ${formatTokenCount(targetCompact)} 小于当前 ${formatTokenCount(currentCompact)}；当前 task 不提前 compact`,
      );
    }
    if (Number.isInteger(targetCompact) && Number.isFinite(totalTokens)
      && totalTokens >= targetCompact) {
      return rejectedContextSwitch(
        "token-limit-exceeded",
        currentWindow,
        targetWindow,
        `当前 ${formatTokenCount(totalTokens)}，目标 compact 阈值 ${formatTokenCount(targetCompact)}；请先 compact`,
      );
    }
    return { action: "apply", code: "eligible", currentWindow, targetWindow };
  };

  const reconcilePendingContextVerification = (threadId) => {
    const pending = contextSwitchForThread(threadId);
    if (!threadId || pending?.ok !== true
      || pending?.verificationPending !== true) return pending;
    const usage = tokenUsageForThread(threadId);
    const hasFreshUsage = Number.isInteger(usage.modelContextWindow)
      && (pending.totalTokens == null
        ? usage.totalTokens != null
        : usage.totalTokens != null && usage.totalTokens !== pending.totalTokens);
    if (!hasFreshUsage) return pending;
    const matched = runtimeWindowMatchesContext(
      usage.modelContextWindow,
      pending.requestedContextWindow,
    );
    if (matched) {
      if (pending.to?.native === true) {
        rememberNativeContextWindow(threadId, pending.requestedContextWindow);
      }
      rememberContextSwitch({
        ...pending,
        verifiedAt: Date.now(),
        verificationPending: false,
        effectiveContextWindow: usage.modelContextWindow,
      });
    } else {
      const expectedWindow = runtimeReportedContextWindow(pending.requestedContextWindow);
      updateThreadContext(threadId, pending.from, "context/hot-switch:runtime-rejected");
      rememberContextSwitch({
        ...pending,
        ok: false,
        verifiedAt: Date.now(),
        verificationPending: false,
        observedContextWindow: usage.modelContextWindow,
        error: `下一轮 runtime 有效窗口为 ${formatTokenCount(usage.modelContextWindow)}，未采用配置 ${formatTokenCount(pending.requestedContextWindow)}（预期 ${formatTokenCount(expectedWindow)}）`,
      });
    }
    scheduleEnsure();
    return contextSwitchForThread(threadId);
  };

  const originalRequestForContextSwitch = () => {
    const client = state.manager?.requestClient;
    const patch = client?.[PATCH_KEY];
    if (!client || !patch || typeof patch.originalSendRequest !== "function") {
      throw new Error("Context 控制器尚未连接，请稍后重试");
    }
    return (method, params, options) => patch.originalSendRequest.call(client, method, params, options);
  };

  const resumeParamsForContext = (threadId, profile, context) => transformThreadStart({
    threadId,
    excludeTurns: true,
  }, profile, context);

  const resumeParamsPreservingRollout = (threadId) => ({ threadId, excludeTurns: true });

  const activeConversationCount = () => {
    const conversations = state.manager?.conversations;
    if (!(conversations instanceof Map)) return null;
    let active = 0;
    for (const conversation of conversations.values()) {
      if (conversation?.threadRuntimeStatus?.type === "active") active += 1;
    }
    return active;
  };

  const queueContextSwitch = (threadId, previous, context, decision, usage) => {
    const queued = {
      threadId,
      context: cloneContext(context),
      from: cloneContext(previous),
      requestedContextWindow: decision.targetWindow,
      totalTokens: usage.totalTokens,
      queuedAt: Date.now(),
    };
    state.queuedContextSwitches.set(threadId, queued);
    rememberContextSwitch({
      at: queued.queuedAt,
      ok: true,
      queued: true,
      verificationPending: false,
      ...queued,
      to: cloneContext(context),
    });
    showToast(`本轮完成后应用到当前 task：Context ${context.label}`);
    scheduleEnsure();
    return { changed: true, queued: true, context: cloneContext(context) };
  };

  const queuedContextForRequest = (method, params) => {
    if (!["turn/start", "thread/compact/start", "review/start"].includes(method)) return null;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    return threadId ? state.queuedContextSwitches.get(threadId) ?? null : null;
  };

  const applyQueuedContextBeforeRequest = async (method, params) => {
    const queued = queuedContextForRequest(method, params);
    if (!queued) return null;
    try {
      return await hotSwitchContext(queued.threadId, queued.context, { fromQueue: true });
    } finally {
      if (state.queuedContextSwitches.get(queued.threadId) === queued) {
        state.queuedContextSwitches.delete(queued.threadId);
      }
      scheduleEnsure();
    }
  };
