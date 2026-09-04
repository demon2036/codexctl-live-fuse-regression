  const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

  const normalizeProviderId = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return PROVIDER_ID_PATTERN.test(normalized) ? normalized : null;
  };

  const cloneProvider = (provider) => provider ? {
    id: provider.id,
    label: provider.label,
    kind: provider.kind ?? "custom",
    source: provider.source ?? "config",
  } : null;

  const normalizeProviderEntry = (id, raw = {}, source = "config") => {
    const normalizedId = normalizeProviderId(id);
    if (!normalizedId || !PROVIDER_ID_PATTERN.test(normalizedId)) return null;
    const label = String(raw?.name ?? raw?.label ?? normalizedId).trim().slice(0, 80)
      || normalizedId;
    return {
      id: normalizedId,
      label,
      kind: normalizedId === "openai" ? "builtin" : "custom",
      source,
    };
  };

  const providerFromResult = (result) => {
    const candidates = [
      result?.thread?.modelProvider,
      result?.thread?.model_provider,
      result?.thread?.modelProviderId,
      result?.thread?.model_provider_id,
      result?.thread?.settings?.modelProvider,
      result?.thread?.settings?.model_provider,
      result?.modelProvider,
      result?.model_provider,
      result?.modelProviderId,
      result?.model_provider_id,
      result?.threadSettings?.modelProvider,
      result?.threadSettings?.model_provider,
    ];
    for (const candidate of candidates) {
      const provider = normalizeProviderId(candidate);
      if (provider) return provider;
    }
    return null;
  };

  const rememberProvider = (threadId, provider, source) => {
    const normalizedProvider = normalizeProviderId(provider);
    if (typeof threadId !== "string" || !UUID_PATTERN.test(threadId)
      || !normalizedProvider) return null;
    const observation = { id: normalizedProvider, threadId, source, observedAt: Date.now() };
    state.providerByThread.set(threadId, observation);
    if (state.providerByThread.size > 600) {
      const oldest = [...state.providerByThread.entries()]
        .sort((left, right) => Number(left[1]?.observedAt ?? 0)
          - Number(right[1]?.observedAt ?? 0))
        .slice(0, state.providerByThread.size - 500);
      for (const [id] of oldest) state.providerByThread.delete(id);
    }
    state.lastProviderObservation = observation;
    return observation;
  };

  const recordProviderFromResult = (method, params, result) => {
    if (!["thread/start", "thread/prewarm", "thread/read", "thread/resume", "thread/fork", "thread/list"]
      .includes(method)) return null;
    const observations = [];
    if (method === "thread/list") {
      for (const entry of Array.isArray(result?.data) ? result.data : []) {
        const observation = rememberProvider(
          entry?.id ?? entry?.threadId,
          providerFromResult({ thread: entry }),
          `${method}:result`,
        );
        if (observation) observations.push(observation);
      }
    } else {
      const threadId = result?.thread?.id ?? result?.threadId ?? params?.threadId ?? null;
      const observation = rememberProvider(
        threadId,
        providerFromResult(result),
        `${method}:result`,
      );
      if (observation) observations.push(observation);
    }
    if (!observations.length) return null;
    scheduleEnsure();
    return observations.length === 1 ? observations[0] : observations;
  };

  const providerConfigFromResult = (result) => {
    const candidates = [
      result?.config,
      result?.result?.config,
      result?.value?.config,
      result?.data?.config,
    ];
    return candidates.find((value) => value && typeof value === "object"
      && !Array.isArray(value)) ?? {};
  };

  const providerCatalogFromConfig = (result) => {
    const config = providerConfigFromResult(result);
    const entries = new Map();
    const add = (id, raw, source) => {
      const provider = normalizeProviderEntry(id, raw, source);
      if (!provider) return;
      const previous = entries.get(provider.id);
      if (!previous || previous.source === "builtin") {
        entries.set(provider.id, provider);
      }
    };
    add("openai", { name: "OpenAI" }, "builtin");
    const configured = config.model_providers ?? config.modelProviders;
    if (configured && typeof configured === "object" && !Array.isArray(configured)) {
      for (const [id, raw] of Object.entries(configured)) add(id, raw, "config");
    }
    const bootstrapProviders = state.config?.providers ?? state.config?.modelProviders;
    if (Array.isArray(bootstrapProviders)) {
      for (const entry of bootstrapProviders) add(entry?.id, entry, "bootstrap");
    } else if (bootstrapProviders && typeof bootstrapProviders === "object") {
      for (const [id, raw] of Object.entries(bootstrapProviders)) add(id, raw, "bootstrap");
    }
    const configuredDefaultId = normalizeProviderId(
      config.model_provider ?? config.modelProvider ?? config.default_model_provider,
    );
    const defaultId = launchProviderId() ?? configuredDefaultId
      ?? normalizeProviderId(state.config?.defaultProviderId) ?? "openai";
    if (defaultId && !entries.has(defaultId)) add(defaultId, { name: defaultId }, "observed");
    const ordered = [...entries.values()].sort((left, right) => {
      const rank = (provider) => provider.id === "openai" ? 0
        : provider.id === defaultId ? 1 : 2;
      return rank(left) - rank(right) || left.label.localeCompare(right.label)
        || left.id.localeCompare(right.id);
    });
    return { providers: ordered, defaultId };
  };

  const fallbackProviderCatalog = () => {
    const providers = [{
      id: "openai", label: "OpenAI", kind: "builtin", source: "builtin",
    }];
    const launchId = launchProviderId();
    if (launchId && launchId !== "openai") {
      providers.push(normalizeProviderEntry(launchId, { name: launchId }, "launch"));
    }
    return providers.filter(Boolean);
  };

  const preserveOrInstallFallbackProviderCatalog = () => {
    const hasLastKnownGood = Number(state.providerCatalogFetchedAt) > 0
      && state.providerCatalog.length > 0;
    if (hasLastKnownGood) return;
    state.providerCatalog = fallbackProviderCatalog();
    state.providerDefaultId = launchProviderId()
      ?? normalizeProviderId(state.config?.defaultProviderId) ?? "openai";
  };

  const requestConfigRead = () => {
    const client = state.manager?.requestClient;
    if (!client) return null;
    const patch = client[PATCH_KEY];
    if (patch?.originalSendRequest && typeof patch.originalSendRequest === "function") {
      return (method, params, options) => patch.originalSendRequest.call(client, method, params, options);
    }
    if (typeof client.sendRequest === "function") {
      return (method, params, options) => client.sendRequest.call(client, method, params, options);
    }
    return null;
  };

  const loadProviderCatalog = async (force = false) => {
    const fresh = state.providerCatalogStatus === "ready"
      && Date.now() - Number(state.providerCatalogFetchedAt || 0) < PROVIDER_CATALOG_TTL_MS;
    if (!force && fresh) return state.providerCatalog.map(cloneProvider);
    if (state.providerCatalogPromise) return state.providerCatalogPromise;
    const send = requestConfigRead();
    if (!send) {
      state.providerCatalogStatus = "error";
      state.providerCatalogError = "本地 app-server 尚未连接";
      preserveOrInstallFallbackProviderCatalog();
      scheduleEnsure();
      throw new Error(state.providerCatalogError);
    }
    state.providerCatalogStatus = "loading";
    state.providerCatalogError = null;
    scheduleEnsure();
    const task = (async () => {
      try {
        const result = await send("config/read", { includeLayers: false });
        const parsed = providerCatalogFromConfig(result);
        state.providerCatalog = parsed.providers;
        state.providerDefaultId = parsed.defaultId;
        state.providerCatalogFetchedAt = Date.now();
        state.providerCatalogStatus = "ready";
        state.providerCatalogError = null;
        scheduleEnsure();
        return state.providerCatalog.map(cloneProvider);
      } catch {
        preserveOrInstallFallbackProviderCatalog();
        state.providerCatalogStatus = "error";
        state.providerCatalogError = "无法读取 app-server 的 Provider 配置";
        scheduleEnsure();
        throw new Error(state.providerCatalogError);
      } finally {
        // The promise is cleared by the continuation below. Keeping this
        // block free of a self-referential const avoids a synchronous-throw TDZ.
      }
    })();
    state.providerCatalogPromise = task;
    task.then(() => {
      if (state.providerCatalogPromise === task) state.providerCatalogPromise = null;
    }, () => {
      if (state.providerCatalogPromise === task) state.providerCatalogPromise = null;
    });
    return task;
  };

  const providerCatalog = () => state.providerCatalog.map(cloneProvider);
  const launchProviderId = () => normalizeProviderId(state.config?.launchProviderId);
  const providerDefaultId = () => launchProviderId()
    ?? normalizeProviderId(state.providerDefaultId)
    ?? normalizeProviderId(state.config?.defaultProviderId) ?? "openai";
  const providerById = (id) => {
    const normalized = normalizeProviderId(id);
    if (!normalized) return null;
    return state.providerCatalog.find((provider) => provider.id === normalized) ?? null;
  };
  const providerDetailsForId = (id, source = "default") => {
    const normalized = normalizeProviderId(id);
    if (!normalized) return null;
    return cloneProvider(providerById(normalized) ?? normalizeProviderEntry(
      normalized,
      { name: normalized === "openai" ? "OpenAI" : normalized },
      source,
    ));
  };
  const pendingProviderDetails = () => {
    const id = normalizeProviderId(state.pendingProvider);
    if (!id) return null;
    return providerDetailsForId(id, "pending");
  };
  const selectedProviderForRequest = () => featureEnabled("provider")
    ? normalizeProviderId(state.pendingProvider) ?? launchProviderId() : null;

  const effectiveProviderForNewTask = () => {
    const pending = selectedProviderForRequest();
    return pending || providerDefaultId();
  };

  const selectProvider = async (provider) => {
    const id = normalizeProviderId(typeof provider === "string" ? provider : provider?.id);
    if (!id) throw new Error("Provider ID 无效");
    if (!providerById(id)) await loadProviderCatalog();
    const selected = providerById(id);
    if (!selected) throw new Error(`Provider 不在当前 app-server 配置中：${id}`);
    state.providerSelectionVersion += 1;
    state.pendingProvider = selected.id;
    persist(sessionStorage, PENDING_PROVIDER_KEY, state.pendingProvider);
    try { state.manager?.clearPrewarmedThreads?.(); } catch {}
    scheduleEnsure();
    return cloneProvider(selected);
  };

  const claimPendingProviderForTask = (params) => {
    const pendingProviderId = normalizeProviderId(state.pendingProvider);
    const providerId = featureEnabled("provider")
      ? pendingProviderId ?? launchProviderId() : null;
    const eligible = featureEnabled("provider") && isEligibleThreadStart(params);
    if (eligible) state.providerSelectionVersion += 1;
    const claim = {
      providerId,
      provider: providerDetailsForId(providerId, pendingProviderId ? "pending" : "launch"),
      version: state.providerSelectionVersion,
      consumed: eligible && Boolean(pendingProviderId),
    };
    if (claim.consumed) {
      state.pendingProvider = null;
      persist(sessionStorage, PENDING_PROVIDER_KEY, null);
      scheduleEnsure();
    }
    return claim;
  };

  const restorePendingProviderClaim = (claim) => {
    if (!claim?.consumed || state.providerSelectionVersion !== claim.version
      || state.pendingProvider != null || !claim.providerId) return false;
    const restored = normalizeProviderId(claim.providerId);
    if (!restored) return false;
    state.pendingProvider = restored;
    persist(sessionStorage, PENDING_PROVIDER_KEY, state.pendingProvider);
    scheduleEnsure();
    return true;
  };

  const currentSessionProvider = (composer = null) => {
    const conversation = currentConversationContext(composer);
    if (!conversation.threadId) {
      const pendingId = normalizeProviderId(state.pendingProvider);
      const launchId = launchProviderId();
      return {
        id: effectiveProviderForNewTask(),
        threadId: null,
        status: "pending",
        source: pendingId ? "pending-selection"
          : launchId ? "launch-default"
            : state.providerDefaultId ? "config-default" : "implicit-openai-default",
        candidate: conversation.modelProvider ?? null,
      };
    }
    if (conversation.modelProvider) {
      return {
        id: conversation.modelProvider,
        threadId: conversation.threadId,
        status: "resolved",
        source: `composer:${conversation.modelProviderSource}`,
        candidate: null,
      };
    }
    const recorded = state.providerByThread.get(conversation.threadId);
    if (recorded) {
      return {
        id: recorded.id,
        threadId: conversation.threadId,
        status: "resolved",
        source: recorded.source,
        candidate: null,
      };
    }
    const persisted = normalizeProviderId(state.threadMap[conversation.threadId]?.provider);
    if (persisted) {
      return {
        id: persisted,
        threadId: conversation.threadId,
        status: "resolved",
        source: "thread-map:persisted",
        candidate: null,
      };
    }
    return {
      id: null,
      threadId: conversation.threadId,
      status: "unknown",
      source: "provider-not-exposed",
      candidate: null,
    };
  };

  const providerForThread = (threadId) => {
    if (typeof threadId !== "string" || !UUID_PATTERN.test(threadId)) return null;
    const active = currentSessionProvider();
    if (active.threadId === threadId && active.status === "resolved") {
      return normalizeProviderId(active.id);
    }
    return normalizeProviderId(state.providerByThread.get(threadId)?.id)
      ?? normalizeProviderId(state.threadMap[threadId]?.provider);
  };
