  const featureEnabled = (name) => state.config?.features?.[name] === true;

  const notifyHealthChanged = () => {
    if (state.stopped) return;
    const signature = JSON.stringify({
      manager: state.managerStatus,
      prompt: featureEnabled("prompt")
        ? document.querySelectorAll?.('[data-codex-base-prompt-trigger="true"]')?.length ?? 0 : -1,
      context: featureEnabled("context")
        ? document.querySelectorAll?.('[data-codex-context-window-trigger="true"]')?.length ?? 0 : -1,
      provider: featureEnabled("prompt") || featureEnabled("context")
        ? document.querySelectorAll?.('[data-codex-provider-indicator="true"]')?.length ?? 0 : -1,
    });
    if (signature === state.healthSignature) return;
    state.healthSignature = signature;
    const binding = window[String(state.config.bindingName || "__codexBasePromptBridge")];
    if (typeof binding !== "function") return;
    state.healthSequence += 1;
    try {
      binding(JSON.stringify({
        id: `health-${state.healthSequence.toString(36)}`,
        action: "healthChanged",
      }));
    } catch {}
  };

  const persist = (storage, key, value) => {
    try { storage.setItem(key, JSON.stringify(value)); } catch {}
  };

  const loadStorage = () => {
    const promptRevision = String(state.config.promptSelectionRevision ?? 0);
    const contextRevision = String(state.config.contextSelectionRevision ?? 0);
    const providerRevision = String(state.config.providerSelectionRevision ?? 0);
    const promptRevisionMatches = sessionStorage.getItem(PROMPT_SELECTION_REVISION_KEY)
      === promptRevision;
    const contextRevisionMatches = sessionStorage.getItem(CONTEXT_SELECTION_REVISION_KEY)
      === contextRevision;
    const providerRevisionMatches = sessionStorage.getItem(PROVIDER_SELECTION_REVISION_KEY)
      === providerRevision;
    const pending = promptRevisionMatches
      ? normalizeProfile(parseStored(sessionStorage, PENDING_KEY, null), "pending")
      : null;
    const configuredDefaultProfile = allProfiles().find((profile) =>
      profile.id === state.config.defaultProfileId,
    );
    state.pendingProfile = pending ?? cloneProfile(configuredDefaultProfile ?? DEFAULT_PROFILE);
    if (!promptRevisionMatches) {
      persist(sessionStorage, PENDING_KEY, state.pendingProfile);
      sessionStorage.setItem(PROMPT_SELECTION_REVISION_KEY, promptRevision);
    }
    const pendingContext = contextRevisionMatches
      ? normalizeContext(parseStored(sessionStorage, PENDING_CONTEXT_KEY, null), "pending")
      : null;
    state.pendingContext = pendingContext ?? { ...DEFAULT_CONTEXT };
    if (!contextRevisionMatches) {
      persist(sessionStorage, PENDING_CONTEXT_KEY, state.pendingContext);
      sessionStorage.setItem(CONTEXT_SELECTION_REVISION_KEY, contextRevision);
    }
    const storedProviderValue = providerRevisionMatches
      ? parseStored(sessionStorage, PENDING_PROVIDER_KEY, null) : null;
    const storedProvider = normalizeProviderId(storedProviderValue);
    state.pendingProvider = storedProvider;
    state.providerSelectionVersion = 0;
    if (!providerRevisionMatches || storedProvider !== storedProviderValue) {
      persist(sessionStorage, PENDING_PROVIDER_KEY, state.pendingProvider);
      sessionStorage.setItem(PROVIDER_SELECTION_REVISION_KEY, providerRevision);
    }
    const recents = parseStored(localStorage, RECENTS_KEY, []);
    state.recentProfiles = Array.isArray(recents)
      ? recents.map((profile) => normalizeProfile(profile, "recent")).filter(Boolean).slice(0, 8)
      : [];
    const threadMap = parseStored(localStorage, THREAD_MAP_KEY, {});
    state.threadMap = threadMap && typeof threadMap === "object" && !Array.isArray(threadMap)
      ? threadMap : {};
    let threadMapChanged = false;
    for (const [threadId, entry] of Object.entries(state.threadMap)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || !Object.prototype.hasOwnProperty.call(entry, "provider")) continue;
      const normalized = normalizeProviderId(entry.provider);
      if (normalized && normalized === entry.provider) continue;
      const cleaned = { ...entry };
      if (normalized) cleaned.provider = normalized;
      else delete cleaned.provider;
      state.threadMap[threadId] = cleaned;
      threadMapChanged = true;
    }
    if (threadMapChanged) persist(localStorage, THREAD_MAP_KEY, state.threadMap);
  };

  const updateConfiguredProfiles = () => {
    const raw = Array.isArray(state.config.profiles) ? state.config.profiles : [];
    const seen = new Set(["default"]);
    state.configuredProfiles = [];
    for (const entry of raw) {
      const profile = normalizeProfile(entry, "configured");
      if (!profile || seen.has(profile.id) || (profile.path && seen.has(profile.path))) continue;
      seen.add(profile.id);
      if (profile.path) seen.add(profile.path);
      state.configuredProfiles.push(profile);
    }
  };

  const allProfiles = () => {
    const profiles = [{ ...DEFAULT_PROFILE }];
    const seenPaths = new Set();
    for (const profile of [...state.configuredProfiles, ...state.recentProfiles]) {
      if (!profile.path || seenPaths.has(profile.path)) continue;
      seenPaths.add(profile.path);
      profiles.push(profile);
    }
    return profiles;
  };

  const resolvePendingProfile = () => {
    if (state.pendingProfile.id === "default" || !state.pendingProfile.path) return { ...DEFAULT_PROFILE };
    const match = allProfiles().find((profile) =>
      profile.id === state.pendingProfile.id || profile.path === state.pendingProfile.path,
    );
    return match ? cloneProfile(match) : cloneProfile(state.pendingProfile);
  };

  const persistPendingProfile = (profile) => {
    state.pendingProfile = cloneProfile(profile);
    persist(sessionStorage, PENDING_KEY, state.pendingProfile);
  };

  const resolvePendingContext = () => {
    const normalized = normalizeContext(state.pendingContext, state.pendingContext?.source ?? "pending");
    if (!normalized) return { ...DEFAULT_CONTEXT };
    const preset = CONTEXT_PRESETS.find((item) => item.id === normalized.id
      || (item.contextWindow === normalized.contextWindow
        && item.autoCompactTokenLimit === normalized.autoCompactTokenLimit
        && item.scope === normalized.scope));
    return cloneContext(preset ?? normalized);
  };

  const persistPendingContext = (context) => {
    state.pendingContext = cloneContext(context);
    persist(sessionStorage, PENDING_CONTEXT_KEY, state.pendingContext);
  };

  const rememberRecent = (profile) => {
    if (!profile?.path) return;
    const normalized = normalizeProfile(profile, "recent");
    if (!normalized) return;
    state.recentProfiles = [normalized, ...state.recentProfiles.filter((item) => item.path !== normalized.path)]
      .slice(0, 8);
    persist(localStorage, RECENTS_KEY, state.recentProfiles);
  };

  const trimThreadMap = () => {
    const entries = Object.entries(state.threadMap);
    if (entries.length <= 600) return;
    entries.sort((left, right) => Number(right[1]?.createdAt ?? 0) - Number(left[1]?.createdAt ?? 0));
    state.threadMap = Object.fromEntries(entries.slice(0, 500));
  };
