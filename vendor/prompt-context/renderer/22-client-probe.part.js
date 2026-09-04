  const probeManager = (fastOnly = false) => {
    clearTimeout(state.managerProbeTimer);
    state.managerProbeTimer = null;
    if (state.managerStatus === "ready" && state.manager) return state.manager;
    if (state.managerSearchPromise) return null;
    if (state.managerProbeAttempts >= MANAGER_MAX_PROBES) {
      state.managerStatus = "incompatible";
      scheduleEnsure();
      return null;
    }
    state.managerProbeAttempts += 1;
    state.managerScanMetrics.attempts += 1;
    state.managerScanMetrics.lastResult = "searching";
    state.managerStatus = "searching";
    const token = ++state.managerSearchToken;
    let task;
    const thorough = !fastOnly
      && state.managerProbeAttempts === MANAGER_GRAPH_PROBE_ATTEMPT;
    if (thorough) state.managerScanMetrics.graphAttempts += 1;
    task = findManager(token, thorough).then((manager) => {
      if (token !== state.managerSearchToken) return null;
      patchManager(manager);
      state.managerProbeAttempts = 0;
      scheduleEnsure();
      return state.manager;
    }).catch((error) => {
      if (token !== state.managerSearchToken) return null;
      state.managerStatus = state.managerProbeAttempts >= MANAGER_MAX_PROBES
        ? "incompatible" : "searching";
      state.managerError = error instanceof Error ? error.message : String(error);
      // DOM ready precedes React's composer mount in the packaged App. Reuse
      // the already-bounded startup probe to attach controls as soon as that
      // composer exists; no observer or steady-state polling is introduced.
      const composerMounted = Boolean(document.querySelector?.('[data-codex-composer="true"]'));
      const promptMissing = featureEnabled("prompt")
        && !document.querySelector?.('[data-codex-base-prompt-trigger="true"]');
      const contextMissing = featureEnabled("context")
        && !document.querySelector?.('[data-codex-context-window-trigger="true"]');
      const providerMissing = featureEnabled("provider")
        && !document.querySelector?.('[data-codex-provider-indicator="true"]');
      if (composerMounted && (promptMissing || contextMissing || providerMissing)) scheduleEnsure();
      if (state.managerProbeAttempts < MANAGER_MAX_PROBES) {
        state.managerProbeTimer = setTimeout(probeManager, MANAGER_PROBE_DELAY_MS);
      } else scheduleEnsure();
      return null;
    }).finally(() => {
      if (state.managerSearchPromise === task) state.managerSearchPromise = null;
    });
    state.managerSearchPromise = task;
    return null;
  };

  const reprobeManager = () => {
    try {
      if (!state.manager) {
        state.managerProbeAttempts = 0;
        probeManager();
        return null;
      }
      patchManager(state.manager);
      clearTimeout(state.managerProbeTimer);
      state.managerProbeTimer = null;
      scheduleEnsure();
      return state.manager;
    } catch (error) {
      state.managerStatus = "searching";
      state.managerError = error instanceof Error ? error.message : String(error);
      state.managerProbeAttempts = 0;
      probeManager();
      return null;
    }
  };

  const requestBridge = (action, payload = {}) => new Promise((resolve, reject) => {
    const bindingName = String(state.config.bindingName || "__codexBasePromptBridge");
    const binding = window[bindingName];
    if (typeof binding !== "function") {
      reject(new Error("Native file bridge is unavailable"));
      return;
    }
    state.bridgeSequence += 1;
    const id = `${Date.now().toString(36)}-${state.bridgeSequence.toString(36)}`;
    const timeout = setTimeout(() => {
      state.bridgeRequests.delete(id);
      reject(new Error("Native file bridge timed out"));
    }, 120000);
    state.bridgeRequests.set(id, { resolve, reject, timeout });
    try {
      binding(JSON.stringify({ id, action, ...payload }));
    } catch (error) {
      clearTimeout(timeout);
      state.bridgeRequests.delete(id);
      reject(error);
    }
  });

  const resolveBridge = (id, response) => {
    const request = state.bridgeRequests.get(id);
    if (!request) return false;
    clearTimeout(request.timeout);
    state.bridgeRequests.delete(id);
    if (response?.ok) request.resolve(response);
    else request.reject(new Error(response?.error || "Native file operation failed"));
    return true;
  };
