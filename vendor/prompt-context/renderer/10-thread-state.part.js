  const appliedOverrides = (profile, context, params = {}, provider = null) => {
    const normalizedContext = normalizeContext(context, context?.source ?? "selected")
      ?? { ...NATIVE_CONTEXT };
    const eligible = isEligibleThreadStart(params);
    const normalizedProvider = normalizeProviderId(provider);
    return {
      prompt: eligible && featureEnabled("prompt") && Boolean(profile?.path),
      context: eligible && featureEnabled("context")
        && Number.isInteger(normalizedContext.contextWindow),
      provider: eligible && Boolean(normalizedProvider),
    };
  };
  const recordThread = (threadId, profile, context, source, applied = null, provider = null) => {
    if (typeof threadId !== "string" || !UUID_PATTERN.test(threadId)) return;
    const normalized = normalizeProfile(profile, profile?.source ?? "recorded") ?? { ...DEFAULT_PROFILE };
    const normalizedContext = normalizeContext(context, context?.source ?? "recorded")
      ?? { ...DEFAULT_CONTEXT };
    const previous = state.threadMap[threadId];
    const normalizedProvider = normalizeProviderId(provider)
      ?? normalizeProviderId(previous?.provider)
      ?? normalizeProviderId(state.providerByThread.get(threadId)?.id);
    const effectiveApplied = applied && typeof applied === "object"
      ? { prompt: applied.prompt === true, context: applied.context === true }
      : { prompt: false, context: false };
    const nativeContextWindow = Number.isInteger(previous?.nativeContextWindow)
      ? previous.nativeContextWindow
      : normalizedContext.native && effectiveApplied.context !== true
        ? configuredWindowForRuntime(tokenUsageForThread(threadId).modelContextWindow)
        : null;
    state.threadMap[threadId] = {
      prompt: cloneProfile(normalized),
      context: cloneContext(normalizedContext),
      ...(normalizedProvider ? { provider: normalizedProvider } : {}),
      applied: effectiveApplied,
      nativeContextWindow,
      nativeContextObservedAt: Number.isInteger(nativeContextWindow) ? Date.now() : null,
      source: String(source || "thread/start").slice(0, 80),
      createdAt: Number(previous?.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    trimThreadMap();
    persist(localStorage, THREAD_MAP_KEY, state.threadMap);
    state.lastRecordedThread = {
      threadId,
      profile: cloneProfile(normalized),
      context: cloneContext(normalizedContext),
      provider: normalizedProvider,
      applied: { ...effectiveApplied },
      source,
    };
    scheduleEnsure();
  };

  const hasThreadRecord = (threadId) => Boolean(threadId
    && Object.prototype.hasOwnProperty.call(state.threadMap, threadId));

  const appliedForThread = (threadId) => {
    const applied = state.threadMap[threadId]?.applied;
    return {
      prompt: applied?.prompt === true,
      context: applied?.context === true,
    };
  };

  const updateThreadContext = (threadId, context, source = "context/hot-switch") => {
    if (!hasThreadRecord(threadId)) return false;
    const normalizedContext = normalizeContext(context, context?.source ?? "recorded");
    if (!normalizedContext) return false;
    const previous = state.threadMap[threadId];
    state.threadMap[threadId] = {
      ...previous,
      context: cloneContext(normalizedContext),
      applied: {
        prompt: previous?.applied?.prompt === true,
        context: Number.isInteger(normalizedContext.contextWindow),
      },
      source: String(source).slice(0, 80),
      createdAt: Number(previous?.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    trimThreadMap();
    persist(localStorage, THREAD_MAP_KEY, state.threadMap);
    state.lastRecordedThread = {
      threadId,
      profile: cloneProfile(profileForThread(threadId)),
      context: cloneContext(normalizedContext),
      provider: normalizeProviderId(previous?.provider)
        ?? normalizeProviderId(state.providerByThread.get(threadId)?.id),
      applied: { ...state.threadMap[threadId].applied },
      source,
    };
    scheduleEnsure();
    return true;
  };

  const profileForThread = (threadId) => {
    if (!threadId) return resolvePendingProfile();
    const entry = state.threadMap[threadId];
    if (!entry) return { ...ORIGINAL_PROFILE };
    if (entry?.applied?.prompt !== true) return { ...ORIGINAL_PROFILE };
    const recorded = normalizeProfile(entry?.prompt ?? entry, "recorded");
    return recorded ?? { ...ORIGINAL_PROFILE };
  };

  const inferredContextForThread = (threadId) => {
    const runtimeWindow = tokenUsageForThread(threadId).modelContextWindow;
    if (!Number.isInteger(runtimeWindow) || runtimeWindow < 32000 || runtimeWindow > 4096000) {
      return null;
    }
    const preset = CONTEXT_PRESETS.find((item) =>
      runtimeWindowMatchesContext(runtimeWindow, item.contextWindow));
    if (preset) return { ...cloneContext(preset), source: "runtime-inferred" };
    const autoCompactTokenLimit = recommendedCompactLimit(runtimeWindow);
    if (!autoCompactTokenLimit) return null;
    return {
      id: `runtime:${runtimeWindow}`,
      label: formatTokenCount(runtimeWindow),
      contextWindow: runtimeWindow,
      autoCompactTokenLimit,
      scope: "total",
      source: "runtime-inferred",
    };
  };

  const contextForThread = (threadId) => {
    if (!threadId) return resolvePendingContext();
    const entry = state.threadMap[threadId];
    if (entry?.applied?.context !== true) {
      const recorded = normalizeContext(entry?.context, "recorded");
      if (recorded?.native === true) return recorded;
      return inferredContextForThread(threadId) ?? { ...NATIVE_CONTEXT };
    }
    const recorded = normalizeContext(entry?.context, "recorded");
    return recorded ?? inferredContextForThread(threadId) ?? { ...NATIVE_CONTEXT };
  };

  const saveHotSwitchedContext = (threadId, context) => {
    if (hasThreadRecord(threadId)) return updateThreadContext(threadId, context);
    recordThread(
      threadId,
      ORIGINAL_PROFILE,
      context,
      "context/hot-switch:adopted-rollout",
      { prompt: false, context: Number.isInteger(context?.contextWindow) },
    );
    return hasThreadRecord(threadId);
  };

  const isEligibleThreadStart = (params) => {
    if (!params || typeof params !== "object" || Array.isArray(params)) return false;
    if (params.threadSource != null && params.threadSource !== "user") return false;
    if (params.ephemeral === true) return false;
    return true;
  };

  const transformThreadStart = (params, profile, context, provider = null) => {
    if (!isEligibleThreadStart(params)) return params;
    const normalizedContext = normalizeContext(context, context?.source ?? "selected")
      ?? { ...NATIVE_CONTEXT };
    const normalizedProvider = normalizeProviderId(provider);
    const applied = appliedOverrides(profile, normalizedContext, params, normalizedProvider);
    const usePromptOverride = applied.prompt;
    const useContextOverride = applied.context;
    const useProviderOverride = applied.provider;
    if (!usePromptOverride && !useContextOverride && !useProviderOverride) return params;
    const nextConfig = {
      ...(params.config && typeof params.config === "object" ? params.config : {}),
    };
    if (usePromptOverride) nextConfig.model_instructions_file = profile.path;
    if (useContextOverride) {
      nextConfig.model_context_window = normalizedContext.contextWindow;
      nextConfig.model_auto_compact_token_limit = normalizedContext.autoCompactTokenLimit;
      nextConfig.model_auto_compact_token_limit_scope = normalizedContext.scope;
    }
    const transformed = {
      ...params,
      ...(usePromptOverride ? { baseInstructions: null } : {}),
      ...(useProviderOverride ? { modelProvider: normalizedProvider } : {}),
      ...((usePromptOverride || useContextOverride) ? { config: nextConfig } : {}),
    };
    state.lastTransform = {
      at: Date.now(),
      profile: cloneProfile(profile),
      context: cloneContext(normalizedContext),
      baseInstructions: transformed.baseInstructions ?? null,
      modelInstructionsFile: transformed.config?.model_instructions_file ?? null,
      modelContextWindow: transformed.config?.model_context_window ?? null,
      modelAutoCompactTokenLimit: transformed.config?.model_auto_compact_token_limit ?? null,
      modelAutoCompactTokenLimitScope:
        transformed.config?.model_auto_compact_token_limit_scope ?? null,
      modelProvider: transformed.modelProvider ?? null,
      threadSource: transformed.threadSource ?? null,
      applied,
    };
    return transformed;
  };

  const findComposerReactRoot = (composer) => {
    for (let node = composer; node; node = node.parentElement) {
      const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
      if (key) return node[key];
    }
    return null;
  };

  const CLIENT_NEW_THREAD_PREFIX = "client-new-thread:";

  const activeConversationComposer = () => {
    const candidates = [];
    for (const candidate of document.querySelectorAll('[data-codex-composer="true"]')) {
      const root = findComposerReactRoot(candidate);
      if (!root || candidate.isConnected === false
        || candidate.closest?.('[aria-hidden="true"]')) continue;
      const footer = candidate.closest?.('[data-composer-footer-responsive]');
      let style = null;
      let footerStyle = null;
      try {
        style = window.getComputedStyle(candidate);
        footerStyle = footer ? window.getComputedStyle(footer) : null;
      } catch {}
      const opacity = Number(style?.opacity ?? 1);
      const footerOpacity = Number(footerStyle?.opacity ?? 1);
      if (style?.display === "none" || style?.visibility === "hidden"
        || footerStyle?.display === "none" || footerStyle?.visibility === "hidden"
        || !Number.isFinite(opacity) || opacity <= 0.05
        || !Number.isFinite(footerOpacity) || footerOpacity <= 0.05) continue;
      const rect = candidate.getBoundingClientRect();
      if (Number(rect.width) <= 1 || Number(rect.height) <= 1
        || Number(rect.right) <= 0 || Number(rect.bottom) <= 0
        || Number(rect.left) >= (Number(window.innerWidth) || Number(rect.right))
        || Number(rect.top) >= (Number(window.innerHeight) || Number(rect.bottom))) continue;
      const active = Boolean(document.activeElement
        && (document.activeElement === candidate || candidate.contains?.(document.activeElement)));
      candidates.push({ active, candidate, rect });
    }
    candidates.sort((left, right) => Number(right.active) - Number(left.active)
      || right.rect.bottom - left.rect.bottom || right.rect.left - left.rect.left);
    return candidates[0]?.candidate ?? null;
  };

  const currentConversationContext = (composer = null) => {
    const mountedComposer = composer ?? activeConversationComposer();
    const root = mountedComposer ? findComposerReactRoot(mountedComposer) : null;
    if (!root) {
      return {
        threadId: null,
        clientThreadId: null,
        browserConversationId: null,
        hasConversation: null,
        source: "no-composer-fiber",
      };
    }

    let threadId = null;
    let threadIdSource = null;
    let clientThreadId = null;
    let browserConversationId = null;
    let hasConversation = null;
    let modelProvider = null;
    let modelProviderSource = null;
    let depth = 0;

    // Only inspect the mounted composer's ancestor chain. A graph-wide Fiber scan can
    // reach cached routes and prewarmed conversations from other tasks, which makes a
    // genuinely new task look as though it already owns an old conversation UUID.
    for (let fiber = root; fiber && depth < 180; fiber = fiber.return, depth += 1) {
      const props = fiber.memoizedProps;
      if (props && typeof props === "object") {
        if (modelProvider == null) {
          const candidates = [
            [props.modelProvider, "modelProvider"],
            [props.model_provider, "model_provider"],
            [props.modelProviderId, "modelProviderId"],
            [props.threadSettings?.modelProvider, "threadSettings.modelProvider"],
            [props.threadSettings?.model_provider, "threadSettings.model_provider"],
            [props.thread?.modelProvider, "thread.modelProvider"],
            [props.thread?.model_provider, "thread.model_provider"],
            [props.conversation?.modelProvider, "conversation.modelProvider"],
            [props.conversation?.model_provider, "conversation.model_provider"],
          ];
          for (const [value, source] of candidates) {
            const normalized = normalizeProviderId(value);
            if (!normalized) continue;
            modelProvider = normalized;
            modelProviderSource = source;
            break;
          }
        }
        if (hasConversation == null && typeof props.hasConversation === "boolean") {
          hasConversation = props.hasConversation;
        }
        if (browserConversationId == null && typeof props.browserConversationId === "string") {
          browserConversationId = props.browserConversationId;
        }
        for (const key of ["clientThreadId", "pendingClientThreadId"]) {
          const value = props[key];
          if (clientThreadId == null && typeof value === "string"
            && value.startsWith(CLIENT_NEW_THREAD_PREFIX)) {
            clientThreadId = value;
          }
        }
        for (const [value, source] of [
          [props.conversationId, "conversationId"],
          [props.routeConversationId, "routeConversationId"],
          [props.threadId, "threadId"],
          [props.thread?.id, "thread.id"],
          [props.thread?.threadId, "thread.threadId"],
          [props.conversation?.id, "conversation.id"],
          [props.conversation?.threadId, "conversation.threadId"],
        ]) {
          if (threadId == null && typeof value === "string" && UUID_PATTERN.test(value)) {
            threadId = value;
            threadIdSource = source;
          }
        }
      }
      if (clientThreadId == null && typeof fiber.key === "string"
        && fiber.key.startsWith(CLIENT_NEW_THREAD_PREFIX)) {
        clientThreadId = fiber.key;
      }
    }

    if (threadId == null && typeof browserConversationId === "string"
      && UUID_PATTERN.test(browserConversationId)) {
      threadId = browserConversationId;
      threadIdSource = "browserConversationId";
    }

    // On the blank new-task route, Codex may retain cached UUIDs while the route is
    // represented by a client-new-thread id. hasConversation=false is the authoritative
    // signal that the first user turn has not created this task yet.
    if (hasConversation === false && clientThreadId) {
      threadId = null;
      threadIdSource = null;
    }

    return {
      threadId,
      clientThreadId,
      browserConversationId,
      hasConversation,
      modelProvider,
      modelProviderSource,
      source: threadIdSource ?? (clientThreadId ? "client-new-thread" : "no-thread"),
    };
  };

  const currentConversationId = (composer = null) =>
    currentConversationContext(composer).threadId;

  // thread/start and thread/prewarm always create a new task. They must use the
  // renderer/window's pending selection even while an older task is visible.
  const selectedProfileForRequest = () => resolvePendingProfile();
  const selectedContextForRequest = () => resolvePendingContext();
