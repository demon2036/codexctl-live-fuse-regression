  const recordThreadFromResult = (
    result,
    profile,
    context,
    source,
    applied = null,
    requestedProvider = null,
  ) => {
    const threadId = result?.thread?.id ?? result?.threadId ?? null;
    const resultProvider = providerFromResult(result);
    const provider = resultProvider ?? normalizeProviderId(requestedProvider);
    if (!resultProvider && provider) rememberProvider(
      threadId,
      provider,
      source === "thread/fork" ? "thread/fork:parent" : `${source}:request`,
    );
    if (typeof threadId === "string") {
      recordThread(threadId, profile, context, source, applied, provider);
    }
  };

  const updateConfig = (nextConfig) => {
    const previousProviderRevision = String(state.config?.providerSelectionRevision ?? 0);
    if (nextConfig && typeof nextConfig === "object") state.config = nextConfig;
    if (String(state.config?.providerSelectionRevision ?? 0) !== previousProviderRevision) {
      state.pendingProvider = null;
      state.providerCatalog = [];
      state.providerCatalogStatus = "idle";
      state.providerCatalogError = null;
      state.providerCatalogFetchedAt = 0;
      persist(sessionStorage, PENDING_PROVIDER_KEY, null);
    }
    updateConfiguredProfiles();
    installStyle();
    scheduleEnsure();
    if (businessFeaturesEnabled()) probeManager();
    else detachManagerPatch();
    return diagnostics();
  };

  const repairUiAfterRequest = (method) => {
    if (["thread/start", "thread/fork", "thread/prewarm", "turn/start", "turn/interrupt"]
      .includes(method)) {
      // These requests can finish before React replaces the composer. Reuse the
      // bounded navigation repair window so the body-level controls reattach
      // after that replacement, without observing or modifying the composer.
      state.navigationHandler?.();
      return;
    }
    if (method !== "thread/read" && method !== "thread/resume" && method !== "thread/turns/list") return;
    const context = controlContext();
    const promptMissing = featureEnabled("prompt")
      && !document.querySelector('[data-codex-base-prompt-trigger="true"]');
    const contextMissing = featureEnabled("context")
      && !document.querySelector('[data-codex-context-window-trigger="true"]');
    const usageMissing = featureEnabled("context") && currentConversationId(context?.composer)
      && !document.querySelector('[data-codex-context-usage-trigger="true"]');
    const providerMissing = featureEnabled("provider")
      && !document.querySelector('[data-codex-provider-indicator="true"]');
    if (!context || promptMissing || contextMissing || usageMissing || providerMissing) state.navigationHandler?.();
    invalidateUsageAnalysis(currentConversationId());
    refreshOpenUsageMenu();
  };

  const repairUiAfterNotification = (notification) => {
    if (!["turn/started", "turn/completed", "thread/status/changed",
      "thread/tokenUsage/updated", "thread/compacted"]
      .includes(notification?.method)) return;
    const notifiedThreadId = notification?.params?.threadId;
    const visibleThreadId = currentConversationId();
    if (typeof notifiedThreadId === "string" && typeof visibleThreadId === "string"
      && notifiedThreadId !== visibleThreadId) return;
    if (["turn/completed", "thread/compacted"].includes(notification.method)) {
      invalidateUsageAnalysis(visibleThreadId);
    }
    state.navigationHandler?.();
    if (["turn/completed", "thread/tokenUsage/updated", "thread/compacted"]
      .includes(notification.method)) refreshOpenUsageMenu();
  };

  const cleanup = () => {
    state.stopped = true;
    state.managerSearchToken += 1;
    state.managerSearchWake?.();
    state.managerSearchWake = null;
    clearTimeout(state.managerProbeTimer);
    state.managerProbeTimer = null;
    if (state.domReadyHandler) {
      document.removeEventListener("readystatechange", state.domReadyHandler);
      document.removeEventListener("DOMContentLoaded", state.domReadyHandler);
      state.domReadyHandler = null;
    }
    if (state.appRoutesReadyHandler) {
      window.removeEventListener(CODEX_VIEW_MESSAGE_EVENT, state.appRoutesReadyHandler);
      state.appRoutesReadyHandler = null;
    }
    resetControlLayoutState();
    clearTimerSet(state.navigationTimers);
    clearTimerSet(state.toastTimers);
    state.contextSwitchByThread.clear();
    state.queuedContextSwitches.clear();
    state.providerByThread.clear();
    state.lastProviderObservation = null;
    state.providerCatalog = [];
    state.providerCatalogStatus = "idle";
    state.providerCatalogError = null;
    state.providerCatalogPromise = null;
    state.providerCatalogFetchedAt = 0;
    closeMenu();
    state.toast?.remove();
    for (const request of state.bridgeRequests.values()) {
      clearTimeout(request.timeout);
      try { request.reject(new Error("Prompt controller stopped")); } catch {}
    }
    state.bridgeRequests.clear();
    document.getElementById(STYLE_ID)?.remove();
    state.controlHost?.remove();
    state.controlHost = null;
    state.controlComposer = null;
    state.menuFallbackButton = null;
    for (const overlay of document.querySelectorAll('[data-codex-control-overlay="true"]')) {
      overlay.remove();
    }
    for (const button of document.querySelectorAll('[data-codex-base-prompt-trigger="true"]')) button.remove();
    for (const button of document.querySelectorAll('[data-codex-context-window-trigger="true"]')) button.remove();
    for (const button of document.querySelectorAll('[data-codex-context-usage-trigger="true"]')) button.remove();
    for (const indicator of document.querySelectorAll('[data-codex-provider-indicator="true"]')) indicator.remove();
    for (const button of document.querySelectorAll('[data-codex-live-control-trigger="true"]')) button.remove();
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    window.removeEventListener("resize", onWindowResize);
    if (state.navigationHandler) {
      window.navigation?.removeEventListener?.("navigate", state.navigationHandler);
      window.removeEventListener("popstate", state.navigationHandler);
      window.removeEventListener("hashchange", state.navigationHandler);
      state.navigationHandler = null;
    }
    detachManagerPatch("stopped");
    if (window[STATE_KEY] === api) delete window[STATE_KEY];
  };

  const api = {
    runtimeRevision: bootstrapConfig?.revision ?? null,
    updateConfig,
    diagnostics,
    cleanup,
    setLiveStatus: setLiveControlStatus,
    resolveBridge,
    currentConversationContext,
    currentConversationId,
    currentSessionProvider,
    providerForThread,
    recordProviderFromResult,
    providerCatalog,
    loadProviderCatalog,
    providerDefaultId,
    pendingProviderDetails,
    selectedProviderForRequest,
    selectProvider,
    claimPendingProviderForTask,
    restorePendingProviderClaim,
    hasThreadRecord,
    appliedForThread,
    profileForThread,
    contextForThread,
    tokenUsageForThread,
    usageMetricsForThread,
    selectedProfileForRequest,
    claimPendingProfileForTask,
    restorePendingProfileClaim,
    selectedContextForRequest,
    transformThreadStart,
    appliedOverrides,
    recordThreadFromResult,
    previewTransform(params = {}) {
      const profile = selectedProfileForRequest();
      const context = selectedContextForRequest();
      const provider = selectedProviderForRequest();
      return {
        profile: cloneProfile(profile),
        context: cloneContext(context),
        provider: cloneProvider(providerById(provider)
          ?? normalizeProviderEntry(provider, { name: provider }, "pending")),
        params: transformThreadStart(params, profile, context, provider),
      };
    },
    clearDiagnostics() {
      state.lastTransform = null;
      state.lastRecordedThread = null;
      return diagnostics();
    },
    selectProfile(profile) { return selectProfile(profile, { validate: Boolean(profile?.path) }); },
    selectContext,
    hotSwitchContext,
    contextSwitchDecision,
    queuedContextForRequest,
    applyQueuedContextBeforeRequest,
    repairUiAfterRequest,
    repairUiAfterNotification,
  };

  window[STATE_KEY] = api;
  updateConfiguredProfiles();
  loadStorage();
  const startDomIntegration = () => {
    const root = document.documentElement;
    if (!root) {
      if (!state.domReadyHandler) {
        state.domReadyHandler = () => startDomIntegration();
        document.addEventListener("readystatechange", state.domReadyHandler);
        document.addEventListener("DOMContentLoaded", state.domReadyHandler);
      }
      return;
    }
    if (state.domReadyHandler) {
      document.removeEventListener("readystatechange", state.domReadyHandler);
      document.removeEventListener("DOMContentLoaded", state.domReadyHandler);
      state.domReadyHandler = null;
    }
    if (state.domIntegrated) return;
    state.domIntegrated = true;
    installStyle();
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    // The host stays outside React. One owner-scoped observer only repairs
    // native footer replacement; composer typing mutations are filtered out.
    // There is no document-wide observer or polling loop.
    window.addEventListener("resize", onWindowResize, { passive: true });
    state.navigationHandler = (event) => {
      state.uiMetrics.navigationRepairs += 1;
      if (["navigate", "popstate", "hashchange"].includes(event?.type)) closeMenu();
      clearTimerSet(state.navigationTimers);
      scheduleEnsure();
      for (const delay of [80, 240, 700]) {
        const timer = setTimeout(() => {
          state.navigationTimers.delete(timer);
          scheduleEnsure();
        }, delay);
        state.navigationTimers.add(timer);
      }
      if (businessFeaturesEnabled()
        && state.managerStatus !== "ready" && !state.managerSearchPromise) {
        state.managerProbeAttempts = 0;
        probeManager();
      }
    };
    if (!state.appRoutesReady && !state.appRoutesReadyHandler) {
      state.appRoutesReadyHandler = (event) => {
        if (event?.detail?.type !== "ready") return;
        state.appRoutesReady = true;
        window.removeEventListener(CODEX_VIEW_MESSAGE_EVENT, state.appRoutesReadyHandler);
        state.appRoutesReadyHandler = null;
        state.navigationHandler?.();
      };
      window.addEventListener(CODEX_VIEW_MESSAGE_EVENT, state.appRoutesReadyHandler);
    }
    if (window.navigation?.addEventListener) {
      window.navigation.addEventListener("navigate", state.navigationHandler);
    } else {
      window.addEventListener("popstate", state.navigationHandler);
      window.addEventListener("hashchange", state.navigationHandler);
    }
    state.navigationHandler();
  };
  startDomIntegration();
  return diagnostics();
})(__CODEX_BASE_PROMPT_CONFIG_JSON__)
