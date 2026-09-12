  const buttonVisualState = (button) => {
    if (!button) return { visible: false };
    let style = null;
    let rect = null;
    try { style = window.getComputedStyle(button); } catch {}
    try { rect = button.getBoundingClientRect(); } catch {}
    const opacity = Number(style?.opacity ?? 1);
    const visible = button.isConnected !== false
      && style?.display !== "none"
      && style?.visibility !== "hidden"
      && style?.pointerEvents !== "none"
      && Number.isFinite(opacity) && opacity > 0.05
      && Number(rect?.width) > 1 && Number(rect?.height) > 1
      && button.disabled !== true
      && button.getAttribute?.("aria-disabled") !== "true";
    return {
      visible,
      width: Number(rect?.width) || 0,
      height: Number(rect?.height) || 0,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: Number.isFinite(opacity) ? opacity : null,
      pointerEvents: style?.pointerEvents ?? null,
    };
  };

  const diagnostics = () => {
    const conversationContext = currentConversationContext();
    const threadId = conversationContext.threadId;
    const promptButtons = [...document.querySelectorAll('[data-codex-base-prompt-trigger="true"]')]
      .map(buttonVisualState);
    const contextButtons = [...document.querySelectorAll('[data-codex-context-window-trigger="true"]')]
      .map(buttonVisualState);
    const usageButtons = [...document.querySelectorAll('[data-codex-context-usage-trigger="true"]')]
      .map(buttonVisualState);
    const providerIndicators = [...document.querySelectorAll('[data-codex-provider-indicator="true"]')]
      .map(buttonVisualState);
    const liveButtons = [...document.querySelectorAll('[data-codex-live-control-trigger="true"]')]
      .map(buttonVisualState);
    const provider = currentSessionProvider();
    if (threadId) reconcilePendingContextVerification(threadId);
    return {
      version: state.config.version ?? null,
      revision: state.config.revision ?? null,
      appRoutesReady: state.appRoutesReady,
      managerStatus: state.managerStatus,
      managerError: state.managerError,
      managerProbe: {
        ...state.managerScanMetrics,
        inProgress: Boolean(state.managerSearchPromise),
      },
      activeTimers: {
        managerProbe: state.managerProbeTimer == null ? 0 : 1,
        navigation: state.navigationTimers.size,
        toast: state.toastTimers.size,
        bridge: state.bridgeRequests.size,
      },
      uiMetrics: { ...state.uiMetrics },
      controlAnchorAttached: Boolean(
        state.controlAnchor?.isConnected,
      ),
      controlContextAvailable: Boolean(controlContext()),
      controlLayout: state.controlAnchorRect ?? null,
      controlHostHidden: state.controlHost?.hidden !== false,
      controlSettlingFrames: state.controlOwnerSettling?.frames ?? null,
      controlObservers: {
        mutation: state.controlOwnerObserverRoot ? 1 : 0,
        resize: state.controlResizeTargets.length ? 1 : 0,
        resizeTargets: state.controlResizeTargets.length,
      },
      hostId: (() => { try { return state.manager?.getHostId?.() ?? null; } catch { return null; } })(),
      pendingProfile: cloneProfile(resolvePendingProfile()),
      pendingContext: cloneContext(resolvePendingContext()),
      pendingProvider: pendingProviderDetails(),
      providerCatalog: providerCatalog(),
      providerCatalogStatus: state.providerCatalogStatus,
      providerCatalogError: state.providerCatalogError,
      providerDefaultId: providerDefaultId(),
      providerLaunchId: launchProviderId(),
      currentConversationContext: conversationContext,
      currentConversationId: threadId,
      currentProvider: provider,
      providerCacheSize: state.providerByThread.size,
      lastProviderObservation: state.lastProviderObservation,
      currentThreadRecorded: hasThreadRecord(threadId),
      currentProfile: cloneProfile(profileForThread(threadId)),
      currentContext: cloneContext(contextForThread(threadId)),
      currentTokenUsage: tokenUsageForThread(threadId),
      contextRuntimeMatches: (() => {
        const context = contextForThread(threadId);
        const usage = tokenUsageForThread(threadId);
        const runtimeWindow = usage.modelContextWindow;
        const lastSwitch = contextSwitchForThread(threadId);
        if (lastSwitch?.ok === true
          && lastSwitch.threadId === threadId
          && lastSwitch.verificationPending
          && lastSwitch.totalTokens != null
          && usage.totalTokens === lastSwitch.totalTokens) return null;
        return !threadId || !Number.isInteger(runtimeWindow) || !Number.isInteger(context.contextWindow)
          ? null : runtimeWindowMatchesContext(runtimeWindow, context.contextWindow);
      })(),
      activeConversationCount: activeConversationCount(),
      nativeRestartAvailable: typeof window.electronBridge?.sendMessageFromView === "function",
      features: {
        prompt: featureEnabled("prompt"),
        context: featureEnabled("context"),
        provider: featureEnabled("provider"), live: featureEnabled("live"),
      },
      contextSwitching: Boolean(threadId && state.contextSwitches.has(threadId)),
      queuedContextSwitch: (() => {
        const queued = threadId ? state.queuedContextSwitches.get(threadId) : null;
        return queued ? {
          threadId: queued.threadId,
          context: cloneContext(queued.context),
          from: cloneContext(queued.from),
          requestedContextWindow: queued.requestedContextWindow,
          totalTokens: queued.totalTokens,
          queuedAt: queued.queuedAt,
        } : null;
      })(),
      configuredProfiles: allProfiles().map(cloneProfile),
      buttonCount: promptButtons.length,
      contextButtonCount: contextButtons.length,
      usageButtonCount: usageButtons.length,
      providerIndicatorCount: providerIndicators.length,
      liveControlCount: liveButtons.length,
      promptButtons,
      contextButtons,
      usageButtons,
      providerIndicators,
      liveButtons,
      menuOpen: Boolean(state.menu),
      currentContextSwitch: threadId ? contextSwitchForThread(threadId) : null,
      lastTransform: state.lastTransform,
      lastRecordedThread: state.lastRecordedThread,
      lastContextSwitch: state.lastContextSwitch,
    };
  };
