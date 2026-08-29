  const clearTimerSet = (timers) => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const mountControlOverlay = (element) => {
    const host = state.controlHost;
    if (!host?.isConnected || !element) return false;
    host.appendChild(element);
    return true;
  };
  const showToast = (message, kind = "info") => {
    clearTimerSet(state.toastTimers);
    state.toast?.remove();
    state.toast = null;
    const toast = document.createElement("div");
    toast.className = "cbps-toast";
    toast.dataset.kind = kind;
    toast.textContent = String(message);
    if (!mountControlOverlay(toast)) return false;
    state.toast = toast;
    requestAnimationFrame(() => { toast.dataset.visible = "true"; });
    const hideTimer = setTimeout(() => {
      state.toastTimers.delete(hideTimer);
      if (state.toast === toast) state.toast = null;
      toast.dataset.visible = "false";
      const removeTimer = setTimeout(() => {
        state.toastTimers.delete(removeTimer);
        toast.remove();
      }, 180);
      state.toastTimers.add(removeTimer);
    }, kind === "error" ? 5200 : 2600);
    state.toastTimers.add(hideTimer);
    return true;
  };
  const closeMenu = () => {
    state.menu?.remove();
    state.menu = null;
    if (state.menuButton) {
      state.menuButton.setAttribute("aria-expanded", "false");
      state.menuButton.removeAttribute("aria-controls");
    }
    state.menuButton = null;
  };

  const selectProfile = async (profile, { validate = false } = {}) => {
    let selected = normalizeProfile(profile, profile?.source ?? "selected");
    if (!selected) throw new Error("Invalid prompt profile");
    if (validate && selected.path) {
      const response = await requestBridge("validatePath", { path: selected.path });
      selected = normalizeProfile({
        ...selected,
        label: response.label || selected.label,
        hash: response.hash || selected.hash,
      }, selected.source) ?? selected;
    }
    if (selected.path) rememberRecent(selected);
    selectPendingProfile(selected);
    try { state.manager?.clearPrewarmedThreads?.(); } catch {}
    closeMenu();
    scheduleEnsure();
    showToast(selected.path ? `下一个新 task：${selected.label}` : "下一个新 task：Default");
  };

  const hotSwitchContext = async (threadId, context, { fromQueue = false } = {}) => {
    const selected = normalizeContext(context, context?.source ?? "selected");
    if (!selected) throw new Error("上下文配置无效");
    if (!threadId || !UUID_PATTERN.test(threadId)) throw new Error("当前 task 尚未建立会话");
    if (state.contextSwitches.has(threadId)) throw new Error("此 task 正在切换 Context，请稍候");

    const wasRecorded = hasThreadRecord(threadId);
    const previous = contextForThread(threadId);
    const observedUsage = tokenUsageForThread(threadId);
    const nativeContextWindow = nativeContextWindowForThread(threadId);
    const decision = contextSwitchDecision({
      current: previous,
      target: selected,
      nativeContextWindow,
      totalTokens: observedUsage.totalTokens,
    });
    if (decision.action === "noop") {
      const cancelledQueued = state.queuedContextSwitches.delete(threadId);
      showToast(`当前 task 已是 Context ${selected.label}`);
      scheduleEnsure();
      return { changed: false, cancelledQueued, context: cloneContext(previous) };
    }
    if (decision.action === "reject") throw new Error(decision.message);
    const rawRequest = originalRequestForContextSwitch();
    const requestOptions = { timeoutMs: 120000 };
    state.contextSwitches.add(threadId);
    scheduleEnsure();

    let restoreNeeded = false;
    let targetResumeCompleted = false;
    let targetVerified = false;
    let usage = observedUsage;
    try {
      usage = tokenUsageForThread(threadId);
      if (usage.resumeState && usage.resumeState !== "resumed") {
        throw new Error("当前 task 正在恢复，请完成后再切换 Context");
      }
      const readResult = await rawRequest("thread/read", {
        threadId,
        includeTurns: false,
      }, requestOptions);
      const serverStatus = readResult?.thread?.status?.type ?? null;
      if (serverStatus !== "idle" && serverStatus !== "notLoaded") {
        if (serverStatus === "active" && !fromQueue) {
          return queueContextSwitch(threadId, previous, selected, decision, usage);
        }
        if (serverStatus === "active") throw new Error("当前回复尚未结束，无法应用已排队的 Context");
        throw new Error(`当前 task 状态为 ${serverStatus || "unknown"}，暂不能切换 Context`);
      }

      usage = tokenUsageForThread(threadId);
      const current = contextForThread(threadId);
      const latestDecision = contextSwitchDecision({
        current,
        target: selected,
        nativeContextWindow: nativeContextWindowForThread(threadId),
        totalTokens: usage.totalTokens,
      });
      if (latestDecision.action === "reject") throw new Error(latestDecision.message);
      if (latestDecision.action === "noop") {
        return { changed: false, context: cloneContext(current) };
      }
      // The renderer's local runtime status can lag behind thread/read. Only the
      // authoritative server status above decides whether a switch must queue.

      const profile = profileForThread(threadId);
      showToast(`正在将当前 task 切换到 Context ${selected.label}…`);

      if (serverStatus === "idle") {
        restoreNeeded = true;
        await rawRequest("thread/unsubscribe", { threadId }, requestOptions);
      } else {
        // A notLoaded task has no subscription, but a failed target resume still
        // needs an old-config resume so the visible task remains usable.
        restoreNeeded = true;
      }

      const result = await rawRequest(
        "thread/resume",
        resumeParamsForContext(threadId, profile, selected),
        requestOptions,
      );
      restoreNeeded = false;
      targetResumeCompleted = true;
      const resumedThreadId = result?.thread?.id ?? threadId;
      if (resumedThreadId !== threadId) throw new Error("恢复结果返回了不同的 thread ID");
      if (result?.thread?.status?.type === "active") {
        throw new Error("切换瞬间开始了新一轮，Context 未确认修改；请在本轮结束后重试");
      }
      const effectiveWindow = latestDecision.targetWindow;
      const verificationPending = true;

      targetVerified = true;
      if (!saveHotSwitchedContext(threadId, selected)) {
        throw new Error("无法保存当前 task 的 Context 记录");
      }

      rememberContextSwitch({
        at: Date.now(),
        ok: true,
        queued: false,
        threadId,
        from: cloneContext(previous),
        to: cloneContext(selected),
        totalTokens: usage.totalTokens,
        requestedContextWindow: effectiveWindow,
        effectiveContextWindow: verificationPending ? null : effectiveWindow,
        verificationPending,
        appServerRestarted: false,
        adoptedHistoricalTask: !wasRecorded,
      });
      showToast(`已请求 ${selected.label}；下一轮 token usage 后确认实际窗口`);
      return {
        changed: true,
        context: cloneContext(selected),
        totalTokens: usage.totalTokens,
        verificationPending: true,
      };
    } catch (error) {
      let recoveryError = null;
      const mustRestorePrevious = !targetVerified
        && (restoreNeeded || targetResumeCompleted);
      if (mustRestorePrevious) {
        try {
          reprobeManager();
          const recoveryRequest = originalRequestForContextSwitch();
          const recoveryParams = wasRecorded
            ? resumeParamsForContext(threadId, profileForThread(threadId), previous)
            : resumeParamsPreservingRollout(threadId);
          const recoveryRead = await recoveryRequest("thread/read", {
            threadId,
            includeTurns: false,
          }, requestOptions);
          const recoveryStatus = recoveryRead?.thread?.status?.type ?? null;
          if (recoveryStatus === "active") {
            throw new Error("task 已开始新一轮，未覆盖其运行配置");
          }
          if (recoveryStatus === "idle") {
            await recoveryRequest("thread/unsubscribe", { threadId }, requestOptions);
          } else if (recoveryStatus !== "notLoaded") {
            throw new Error(`task 状态为 ${recoveryStatus || "unknown"}`);
          }
          await recoveryRequest(
            "thread/resume",
            recoveryParams,
            requestOptions,
          );
        } catch (restoreFailure) {
          recoveryError = restoreFailure;
        }
      }
      rememberContextSwitch({
        at: Date.now(),
        ok: false,
        threadId,
        from: cloneContext(previous),
        to: cloneContext(selected),
        totalTokens: usage?.totalTokens ?? null,
        observedContextWindow: tokenUsageForThread(threadId).modelContextWindow,
        appServerRestarted: false,
        error: error instanceof Error ? error.message : String(error),
        recoveryError: recoveryError instanceof Error ? recoveryError.message
          : recoveryError ? String(recoveryError) : null,
      });
      if (recoveryError) {
        throw new Error(
          `Context 切换失败且无法恢复 task 订阅，请重新打开此 task：${recoveryError.message || recoveryError}`,
        );
      }
      throw error;
    } finally {
      state.contextSwitches.delete(threadId);
      scheduleEnsure();
    }
  };

  const selectContext = async (context, { threadId = null } = {}) => {
    const selected = normalizeContext(context, context?.source ?? "selected");
    if (!selected) throw new Error("上下文配置无效");
    closeMenu();
    if (threadId) return hotSwitchContext(threadId, selected);

    persistPendingContext(selected);
    try { state.manager?.clearPrewarmedThreads?.(); } catch {}
    scheduleEnsure();
    showToast(selected.native
      ? "下一个新 task：使用模型 / Provider 官方 Context 与 compact 默认值"
      : `下一个新 task：Context ${selected.label} · compact ${formatTokenCount(selected.autoCompactTokenLimit)}`);
    return { changed: true, context: cloneContext(selected) };
  };
