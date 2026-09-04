((bootstrapConfig) => {
  "use strict";

  const STATE_KEY = "__CODEX_BASE_PROMPT_SWITCHER__";
  const PATCH_KEY = "__CODEX_BASE_PROMPT_REQUEST_PATCH_V1__";
  const STYLE_ID = "codex-base-prompt-switcher-style";
  const CODEX_VIEW_MESSAGE_EVENT = "codex-message-from-view";
  const PENDING_KEY = "codex-base-prompt-pending-v1";
  const PENDING_CONTEXT_KEY = "codex-context-window-pending-v1";
  const PENDING_PROVIDER_KEY = "codex-provider-pending-v1";
  const PROMPT_SELECTION_REVISION_KEY = "codex-base-prompt-selection-revision-v1";
  const CONTEXT_SELECTION_REVISION_KEY = "codex-context-selection-revision-v1";
  const PROVIDER_SELECTION_REVISION_KEY = "codex-provider-selection-revision-v1";
  const RECENTS_KEY = "codex-base-prompt-recents-v1";
  const THREAD_MAP_KEY = "codex-base-prompt-thread-map-v1";
  const CONTEXT_VERIFY_TIMEOUT_MS = 3000;
  const PROVIDER_CATALOG_TTL_MS = 30_000;
  // Startup gets one idle graph fallback; explicit control use can restart the probe.
  const MANAGER_MAX_PROBES = 16;
  const MANAGER_PROBE_DELAY_MS = 250;
  const MANAGER_GRAPH_PROBE_ATTEMPT = 4;
  const MANAGER_SCAN_MAX_OBJECTS = 12000;
  const MANAGER_SCAN_MAX_DEPTH = 10;
  const MANAGER_SCAN_SLICE_OBJECTS = 160;
  const MANAGER_SCAN_SLICE_MS = 5;
  const UUID_PATTERN = /^(?:thread_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DEFAULT_PROFILE = Object.freeze({
    id: "default",
    label: "Default",
    path: null,
    hash: null,
    source: "builtin",
  });
  const ORIGINAL_PROFILE = Object.freeze({
    id: "original",
    label: "Original",
    path: null,
    hash: null,
    // A historical task already carries its exact base instructions in the
    // rollout. Leaving both baseInstructions and model_instructions_file
    // absent on resume makes Codex restore those instructions verbatim.
    source: "rollout",
  });
  const FALLBACK_CONTEXT_PRESETS = [
    { id: "native", label: "Native / Official", contextWindow: null, autoCompactTokenLimit: null, scope: null, native: true },
    { id: "oai", label: "Legacy OAI 272K", contextWindow: 272000, autoCompactTokenLimit: 244800, scope: "total" },
    { id: "200k", label: "200K", contextWindow: 200000, autoCompactTokenLimit: 180000, scope: "total" },
    { id: "300k", label: "300K", contextWindow: 300000, autoCompactTokenLimit: 270000, scope: "total" },
    { id: "400k", label: "400K", contextWindow: 400000, autoCompactTokenLimit: 360000, scope: "total" },
    { id: "450k", label: "450K", contextWindow: 450000, autoCompactTokenLimit: 400000, scope: "total" },
  ];
  const configuredContexts = Array.isArray(bootstrapConfig?.contexts)
    && bootstrapConfig.contexts.length ? bootstrapConfig.contexts : FALLBACK_CONTEXT_PRESETS;
  const CONTEXT_PRESETS = Object.freeze(configuredContexts.map((entry) => Object.freeze({
    id: String(entry.id),
    label: String(entry.label),
    contextWindow: entry.contextWindow == null ? null : Number(entry.contextWindow),
    autoCompactTokenLimit: entry.autoCompactTokenLimit == null
      ? null : Number(entry.autoCompactTokenLimit),
    scope: entry.scope == null ? null
      : entry.scope === "body_after_prefix" ? "body_after_prefix" : "total",
    native: entry.id === "native" || entry.native === true,
    source: "configured-preset",
  })));
  const NATIVE_CONTEXT = Object.freeze({
    id: "native",
    label: "Native / Official",
    contextWindow: null,
    autoCompactTokenLimit: null,
    scope: null,
    native: true,
    source: "official-native",
  });
  const DEFAULT_CONTEXT = Object.freeze({
    ...(CONTEXT_PRESETS.find((entry) => entry.id === bootstrapConfig?.defaultContextId)
      ?? CONTEXT_PRESETS[0]),
    source: "configured-default",
  });

  const existing = window[STATE_KEY];
  if (existing && existing.runtimeRevision === bootstrapConfig?.revision
    && typeof existing.updateConfig === "function") {
    existing.updateConfig(bootstrapConfig);
    return existing.diagnostics();
  }
  if (existing && typeof existing.cleanup === "function") {
    try { existing.cleanup(); } catch {}
  }

  const parseStored = (storage, key, fallback) => {
    try {
      const value = JSON.parse(storage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const normalizeProfile = (value, source = "configured") => {
    if (!value || typeof value !== "object") return null;
    if (value.id === "original" && value.path == null) {
      return {
        ...ORIGINAL_PROFILE,
        source: String(value.source || source || "rollout").slice(0, 80),
      };
    }
    if (value.id === "default" || value.path == null) return { ...DEFAULT_PROFILE };
    const path = String(value.path ?? "").trim();
    const label = String(value.label ?? "").trim();
    if (!path.startsWith("/") || !label || label.length > 80) return null;
    return {
      id: String(value.id || `file:${path}`).slice(0, 220),
      label,
      path,
      hash: typeof value.hash === "string" ? value.hash.slice(0, 128) : null,
      source,
    };
  };

  const formatTokenCount = (value) => {
    const tokens = Number(value);
    if (!Number.isFinite(tokens)) return "—";
    if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(2))}M`;
    if (tokens >= 1000) return `${Number((tokens / 1000).toFixed(1))}K`;
    return Math.round(tokens).toLocaleString("en-US");
  };

  // Codex reserves 5% headroom and token_count reports the usable window:
  // 272K -> 258.4K, 450K -> 427.5K. Some app-server/provider builds report
  // the configured value, so accept only those two exact representations.
  const runtimeReportedContextWindow = (configuredWindow) => {
    const tokens = Number(configuredWindow);
    return Number.isInteger(tokens) ? Math.floor(tokens * 0.95) : null;
  };
  const runtimeWindowMatchesContext = (runtimeWindow, configuredWindow) =>
    Number.isInteger(runtimeWindow) && Number.isInteger(configuredWindow)
    && (runtimeWindow === configuredWindow
      || runtimeWindow === runtimeReportedContextWindow(configuredWindow));

  const recommendedCompactLimit = (contextWindow) => {
    const windowTokens = Number(contextWindow);
    if (!Number.isInteger(windowTokens)) return null;
    const rounded = Math.floor((windowTokens * 0.9) / 1000) * 1000;
    return Math.min(rounded, windowTokens - 16000);
  };

  const normalizeContext = (value, source = "selected") => {
    if (!value || typeof value !== "object") return null;
    if (value.id === "native" || value.native === true || value.contextWindow == null) {
      return { ...NATIVE_CONTEXT, source };
    }
    const contextWindow = Number(value.contextWindow);
    const autoCompactTokenLimit = value.autoCompactTokenLimit == null
      ? recommendedCompactLimit(contextWindow)
      : Number(value.autoCompactTokenLimit);
    if (!Number.isInteger(contextWindow) || contextWindow < 32000 || contextWindow > 4096000
      || !Number.isInteger(autoCompactTokenLimit) || autoCompactTokenLimit < 16000
      || autoCompactTokenLimit > contextWindow - 16000) {
      return null;
    }
    const scope = value.scope === "body_after_prefix" ? "body_after_prefix" : "total";
    return {
      id: String(value.id || `custom:${contextWindow}:${autoCompactTokenLimit}:${scope}`).slice(0, 220),
      label: String(value.label || formatTokenCount(contextWindow)).slice(0, 80),
      contextWindow,
      autoCompactTokenLimit,
      scope,
      native: false,
      source,
    };
  };

  const cloneProfile = (profile) => ({
    id: profile.id,
    label: profile.label,
    path: profile.path,
    hash: profile.hash ?? null,
    source: profile.source ?? "configured",
  });

  const cloneContext = (context) => ({
    id: context.id,
    label: context.label,
    contextWindow: context.contextWindow ?? null,
    autoCompactTokenLimit: context.autoCompactTokenLimit ?? null,
    scope: context.scope ?? null,
    native: context.native === true,
    source: context.source ?? "selected",
  });

  const state = {
    config: bootstrapConfig && typeof bootstrapConfig === "object" ? bootstrapConfig : {},
    manager: null,
    managerStatus: bootstrapConfig?.features?.prompt === true
      || bootstrapConfig?.features?.context === true
      || bootstrapConfig?.features?.provider === true ? "searching" : "disabled",
    managerError: null,
    managerProbeTimer: null,
    managerProbeAttempts: 0,
    managerSearchToken: 0,
    managerSearchPromise: null,
    managerSearchWake: null,
    managerScanMetrics: {
      attempts: 0,
      graphAttempts: 0,
      totalVisited: 0,
      lastVisited: 0,
      lastDurationMs: 0,
      maxSliceMs: 0,
      lastResult: "idle",
      lastStrategy: "idle",
    },
    domReadyHandler: null,
    domIntegrated: false,
    appRoutesReady: typeof window.electronBridge?.sendMessageFromView !== "function",
    appRoutesReadyHandler: null,
    controlHost: null,
    controlAnchor: null,
    controlAnchorOriginal: null,
    controlAnchorRect: null,
    controlComposer: null,
    controlLayoutCheckQueued: false,
    controlLayoutFrame: null,
    controlResizeObserver: null,
    controlResizeTargets: [],
    controlResizeWidths: new Map(),
    controlPositionQueued: false,
    ensureQueued: false,
    stopped: false,
    navigationHandler: null,
    navigationTimers: new Set(),
    toastTimers: new Set(),
    healthSignature: null,
    healthSequence: 0,
    uiMetrics: {
      ensurePasses: 0,
      ensureSchedules: 0,
      mutationBatches: 0,
      mutationRecords: 0,
      ignoredMutationBatches: 0,
      structuralMutationBatches: 0,
      positionPasses: 0,
      navigationRepairs: 0,
    },
    menu: null,
    menuButton: null,
    liveStatus: bootstrapConfig?.liveControl?.enabled === true ? {
      connected: false,
      sessionId: bootstrapConfig.liveControl.sessionId,
    } : null,
    liveActionPending: null,
    liveActionSequence: 0,
    toast: null,
    bridgeSequence: 0,
    bridgeRequests: new Map(),
    lastTransform: null,
    lastRecordedThread: null,
    configuredProfiles: [],
    recentProfiles: [],
    threadMap: {},
    providerByThread: new Map(),
    lastProviderObservation: null,
    providerCatalog: [],
    providerCatalogStatus: "idle",
    providerCatalogError: null,
    providerCatalogPromise: null,
    providerCatalogFetchedAt: 0,
    providerDefaultId: null,
    pendingProvider: null,
    providerSelectionVersion: 0,
    pendingProfile: { ...DEFAULT_PROFILE },
    profileSelectionVersion: 0,
    pendingContext: { ...DEFAULT_CONTEXT },
    contextSwitches: new Set(),
    contextSwitchByThread: new Map(),
    queuedContextSwitches: new Map(),
    lastContextSwitch: null,
  };
