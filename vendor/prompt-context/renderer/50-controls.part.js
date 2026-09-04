  const lockSvg = `
    <svg viewBox="0 0 16 16" aria-hidden="true" class="cbps-lock-icon">
      <path d="M4.25 7V5.5a3.75 3.75 0 0 1 7.5 0V7h.5A1.75 1.75 0 0 1 14 8.75v4.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-4.5A1.75 1.75 0 0 1 3.75 7h.5Zm1.5 0h4.5V5.5a2.25 2.25 0 0 0-4.5 0V7Zm-2.25 1.75v4.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-4.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Z" fill="currentColor"/>
    </svg>`;
  const chevronSvg = `
    <svg viewBox="0 0 16 16" aria-hidden="true" class="cbps-chevron">
      <path d="m4.2 6.2 3.8 3.8 3.8-3.8 1 1L8 12 3.2 7.2l1-1Z" fill="currentColor"/>
    </svg>`;

  const setAttributeIfChanged = (element, name, value) => {
    const next = String(value);
    if (element.getAttribute(name) !== next) element.setAttribute(name, next);
  };
  const compactControlLabel = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "—";
    const token = text.match(/\b\d+(?:\.\d+)?\s*[KMG](?:B)?\b/i);
    return token ? token[0].replace(/\s+/g, "") : text;
  };
  const controlLabel = (prefix, value) => `<span class="cbps-label">`
    + `<span class="cbps-label-prefix">${escapeHtml(prefix)}</span>`
    + '<span class="cbps-label-separator" aria-hidden="true">:</span>'
    + `<span class="cbps-label-value">${escapeHtml(value)}</span></span>`;
  const renderButton = (button, composer) => {
    const threadId = currentConversationId(composer);
    const locked = Boolean(threadId);
    const current = locked ? profileForThread(threadId) : null;
    const profile = resolvePendingProfile();
    const ready = state.managerStatus === "ready";
    setAttributeIfChanged(button, "data-locked", locked ? "true" : "false");
    setAttributeIfChanged(button, "data-thread-id", threadId || "");
    setAttributeIfChanged(button, "data-custom", profile.path ? "true" : "false");
    setAttributeIfChanged(button, "data-ready", ready ? "true" : "false");
    setAttributeIfChanged(button, "aria-label", `选择下一个新 task 的 Developer Prompt，当前 ${profile.label}`);
    setAttributeIfChanged(button, "title", locked
      ? `当前 task：${current.label}（已锁定）\n下一个新 task：${profile.label}\n${profile.path || "Codex built-in instructions"}`
      : profile.path || "使用 Codex 内置 instructions");
    const content = locked
      ? `${lockSvg}${controlLabel("Next", profile.label)}${chevronSvg}`
      : `<span class="cbps-dot" aria-hidden="true"></span>${controlLabel("Base", profile.label)}${chevronSvg}`;
    const renderKey = JSON.stringify([locked, current?.label, profile.label]);
    if (button.dataset.cbpsRenderKey !== renderKey) {
      button.innerHTML = content;
      setAttributeIfChanged(button, "data-cbps-render-key", renderKey);
    }
  };

  const renderContextButton = (button, composer) => {
    const threadId = currentConversationId(composer);
    if (threadId) reconcilePendingContextVerification(threadId);
    const currentTask = Boolean(threadId);
    const context = currentTask ? contextForThread(threadId) : resolvePendingContext();
    const queued = currentTask ? state.queuedContextSwitches.get(threadId) ?? null : null;
    const displayedContext = queued?.context ?? context;
    const usage = currentTask ? tokenUsageForThread(threadId) : null;
    const runtimeWindow = usage?.modelContextWindow ?? null;
    const lastSwitch = currentTask ? contextSwitchForThread(threadId) : null;
    const runtimeVerificationPending = Boolean(currentTask
      && lastSwitch?.ok === true
      && lastSwitch.threadId === threadId
      && lastSwitch.verificationPending
      && lastSwitch.totalTokens != null
      && usage?.totalTokens === lastSwitch.totalTokens);
    const runtimeMismatch = currentTask
      && Number.isInteger(runtimeWindow)
      && Number.isInteger(context.contextWindow)
      && !runtimeWindowMatchesContext(runtimeWindow, context.contextWindow)
      && !runtimeVerificationPending;
    const switching = currentTask && state.contextSwitches.has(threadId);
    const ready = state.managerStatus === "ready" && !switching;
    const label = queued ? displayedContext.label
      : runtimeMismatch ? formatTokenCount(runtimeWindow)
        : context.contextWindow ? context.label : "Native";
    const compactLabel = compactControlLabel(label);
    // Base Prompt remains locked after creation; Context is intentionally live.
    setAttributeIfChanged(button, "data-locked", "false");
    setAttributeIfChanged(button, "data-thread-id", threadId || "");
    setAttributeIfChanged(button, "data-context-override", displayedContext.contextWindow ? "true" : "false");
    setAttributeIfChanged(button, "data-context-queued", queued ? "true" : "false");
    setAttributeIfChanged(button, "data-runtime-mismatch", runtimeMismatch ? "true" : "false");
    setAttributeIfChanged(button, "data-ready", ready ? "true" : "false");
    setAttributeIfChanged(button, "aria-label", currentTask
      ? `切换当前 task 的上下文窗口，当前 ${label}`
      : `选择下一个新 task 的上下文窗口，当前 ${label}`);
    setAttributeIfChanged(button, "title", `${contextTitle(displayedContext)}${queued
      ? `\n当前 ${context.label}；本轮完成后应用到当前 task`
      : runtimeMismatch
      ? `\n当前 runtime 有效窗口为 ${formatTokenCount(runtimeWindow)}；配置值尚未生效`
      : Number.isInteger(runtimeWindow) && Number.isInteger(context.contextWindow)
        ? `\n当前 runtime 有效窗口 ${formatTokenCount(runtimeWindow)}（配置 ${formatTokenCount(context.contextWindow)}）`
        : ""}${currentTask
      ? "\n当前 task 可增大或缩小；缩小时下一轮按新阈值自动 compact"
      : "\n用于下一个新 task"}`);
    const statusText = switching
      ? '<span class="cbps-locked-text">· 切换中</span>'
      : queued
        ? '<span class="cbps-locked-text">· 本轮后应用</span>'
      : runtimeVerificationPending
        ? '<span class="cbps-locked-text">· 待下一轮确认</span>'
      : runtimeMismatch
        ? `<span class="cbps-locked-text">· 请求 ${escapeHtml(context.label)}</span>${chevronSvg}`
        : chevronSvg;
    const content = `<span class="cbps-dot" aria-hidden="true"></span>${controlLabel("Context", compactLabel)}${statusText}`;
    const renderKey = JSON.stringify([
      label, compactLabel, context.label, displayedContext.label, runtimeMismatch, switching,
      Boolean(queued),
    ]);
    if (button.dataset.cbpsRenderKey !== renderKey) {
      button.innerHTML = content;
      setAttributeIfChanged(button, "data-cbps-render-key", renderKey);
    }
  };

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const makeButton = (permissionButton, composer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cbps-control cbps-trigger";
    button.setAttribute("data-codex-base-prompt-trigger", "true");
    button.setAttribute("data-composer-navigation-target", "base-prompt");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === button) closeMenu();
      else openMenu(button);
    });
    renderButton(button, composer);
    return button;
  };

  const makeContextButton = (permissionButton, composer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cbps-control cbps-trigger cbps-context-trigger";
    button.setAttribute("data-codex-context-window-trigger", "true");
    button.setAttribute("data-composer-navigation-target", "context-window");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === button) closeMenu();
      else openContextMenu(button);
    });
    renderContextButton(button, composer);
    return button;
  };

  const renderUsageButton = (button, composer) => {
    const threadId = currentConversationId(composer);
    const metrics = threadId ? usageMetricsForThread(threadId, { includeBreakdown: false }) : null;
    const latest = metrics?.cache?.last;
    const percent = finiteNonNegative(latest?.percent);
    const label = percent == null ? "—" : percent > 100 ? "100%+" : percent >= 99.95 ? "100%" : usagePercent(percent, 1);
    setAttributeIfChanged(button, "data-thread-id", threadId || "");
    setAttributeIfChanged(button, "data-ready",
      state.managerStatus === "ready" && threadId ? "true" : "false");
    setAttributeIfChanged(button, "aria-label", `查看最近一次模型调用的缓存率，当前 ${label}`);
    setAttributeIfChanged(button, "title", percent == null
      ? "最近一次模型调用尚无可用的缓存数据"
      : `缓存 ${usageInteger(latest.cachedInputTokens)} / ${usageInteger(latest.inputTokens)}；未缓存 ${usageInteger(latest.uncachedInputTokens)}（${usagePercent(percent)}）`);
    const content = `<span class="cbps-dot" aria-hidden="true"></span>${controlLabel("Usage", label)}`;
    const renderKey = JSON.stringify([threadId, label, latest?.cachedInputTokens, latest?.uncachedInputTokens]);
    if (button.dataset.cbpsRenderKey !== renderKey) {
      button.innerHTML = content;
      setAttributeIfChanged(button, "data-cbps-render-key", renderKey);
    }
  };

  const makeUsageButton = (permissionButton, composer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cbps-control cbps-trigger cbps-usage-trigger";
    button.setAttribute("data-codex-context-usage-trigger", "true");
    button.setAttribute("data-composer-navigation-target", "context-usage");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === button) closeMenu();
      else openUsageMenu(button);
    });
    renderUsageButton(button, composer);
    return button;
  };

  const CONTROL_HOST_ID = "codex-prompt-context-control-host";

  const visuallyAvailable = (element) => {
    if (!element || element.isConnected === false
      || element.getAttribute?.("aria-hidden") === "true") return false;
    let style = null;
    try { style = window.getComputedStyle(element); } catch {}
    const opacity = Number(style?.opacity ?? 1);
    return style?.display !== "none"
      && style?.visibility !== "hidden"
      && style?.pointerEvents !== "none"
      && Number.isFinite(opacity) && opacity > 0.05;
  };

  const rectInViewport = (rect) => Number(rect?.width) > 1 && Number(rect?.height) > 1
    && Number(rect.right) > 0 && Number(rect.bottom) > 0
    && Number(rect.left) < (Number(window.innerWidth) || Number(rect.right))
    && Number(rect.top) < (Number(window.innerHeight) || Number(rect.bottom));

  const controlContext = () => {
    const candidates = [];
    for (const composer of document.querySelectorAll('[data-codex-composer="true"]')) {
      const footer = composer.closest('[data-composer-footer-responsive]');
      const permissionButton = footer?.querySelector('[data-composer-navigation-target="permissions"]');
      if (!footer || !permissionButton?.parentElement) continue;
      if (composer.closest?.('[aria-hidden="true"]') || footer.closest?.('[aria-hidden="true"]')) continue;
      if (!visuallyAvailable(composer) || !visuallyAvailable(footer)
        || !visuallyAvailable(permissionButton)) continue;
      const rect = permissionButton.getBoundingClientRect();
      if (!rectInViewport(rect) || !hitTestIncludes(permissionButton, rect)) continue;
      const active = Boolean(document.activeElement
        && (document.activeElement === composer || composer.contains?.(document.activeElement)));
      candidates.push({ composer, footer, permissionButton, rect, active });
    }
    candidates.sort((left, right) => Number(right.active) - Number(left.active)
      || right.rect.bottom - left.rect.bottom || right.rect.left - left.rect.left);
    return candidates[0] ?? null;
  };

  const ensureControlHost = () => {
    if (!document.body) return null;
    let host = state.controlHost;
    if (!host?.isConnected) host = document.getElementById(CONTROL_HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = CONTROL_HOST_ID;
      host.className = "cbps-control-host";
      host.setAttribute("data-codex-prompt-context-host", "true");
      document.body.appendChild(host);
    } else if (host.parentElement !== document.body) {
      document.body.appendChild(host);
      state.controlHostReparented = true;
    }
    state.controlHost = host;
    return host;
  };

  const controlOwnerSignal = (node) => node?.nodeType === 1 && (node.matches?.(
    CONTROL_OWNER_SIGNAL_SELECTOR,
  ) || node.querySelector?.(CONTROL_OWNER_SIGNAL_SELECTOR));
  const syncControlOwnerObserver = (context = null) => {
    const root = context?.footer?.closest?.('[data-app-shell-main-surface]')
      ?? document.querySelector?.('[data-app-shell-main-surface]')
      ?? document.getElementById?.('root')
      ?? null;
    if (root === state.controlOwnerObserverRoot) return;
    state.controlOwnerObserver?.disconnect();
    state.controlOwnerObserverRoot = root;
    if (!root || typeof MutationObserver !== "function") return;
    if (!state.controlOwnerObserver) state.controlOwnerObserver = new MutationObserver((records) => {
      if (state.stopped) return;
      const relevant = records.some((record) => !state.controlComposer?.contains?.(record.target)
        && (controlOwnerSignal(record.target)
          || [...record.addedNodes, ...record.removedNodes].some(controlOwnerSignal)));
      if (!relevant) return;
      if (!state.controlComposer?.isConnected || !state.controlFooter?.isConnected
        || !state.controlAnchor?.isConnected) scheduleEnsure();
      else scheduleControlPosition();
    });
    state.controlOwnerObserver.observe(root, { childList: true, subtree: true });
  };
  const syncControlResizeObserver = (context = null, protectedNodes = []) => {
    const targets = new Set(context ? [
      context.composer, context.footer, context.permissionButton, ...protectedNodes,
    ] : []);
    for (let element = context?.footer?.parentElement;
      element && element !== document.body; element = element.parentElement) targets.add(element);
    const next = [...targets].filter((element) => element?.isConnected !== false);
    if (next.length === state.controlResizeTargets.length
      && next.every((target, index) => target === state.controlResizeTargets[index])) return;
    state.controlResizeObserver?.disconnect();
    state.controlResizeTargets = next;
    state.controlResizeWidths.clear();
    if (!next.length || typeof ResizeObserver !== "function") return;
    if (!state.controlResizeObserver) state.controlResizeObserver = new ResizeObserver(() => {
      if (!state.stopped) scheduleControlPosition();
    });
    for (const target of next) state.controlResizeObserver.observe(target);
  };

  const positionControlHost = () => {
    state.controlPositionQueued = false;
    if (state.stopped || !state.controlHost?.isConnected) return;
    const context = controlContext();
    if (!context) {
      layoutControlHost(null, state.controlHost);
      if (state.menu) positionMenu();
      return;
    }
    const { composer } = context;
    const promptButton = state.controlHost.querySelector('[data-codex-base-prompt-trigger="true"]');
    const contextButton = state.controlHost.querySelector('[data-codex-context-window-trigger="true"]');
    const usageButton = state.controlHost.querySelector('[data-codex-context-usage-trigger="true"]');
    const providerIndicator = state.controlHost.querySelector('[data-codex-provider-indicator="true"]');
    const liveButton = state.controlHost.querySelector('[data-codex-live-control-trigger="true"]');
    if (promptButton) renderButton(promptButton, composer);
    if (contextButton) renderContextButton(contextButton, composer);
    if (usageButton) renderUsageButton(usageButton, composer);
    if (providerIndicator) renderProviderIndicator(providerIndicator, composer);
    if (liveButton) renderLiveControlButton(liveButton);
    layoutControlHost(context, state.controlHost);
    state.uiMetrics.positionPasses += 1;
    if (state.menu) positionMenu();
  };

  function scheduleControlPosition() {
    if (state.stopped || state.controlPositionQueued) return;
    state.controlPositionQueued = true;
    if (typeof queueMicrotask === "function") queueMicrotask(positionControlHost);
    else Promise.resolve().then(positionControlHost);
  }

  const ensureUi = () => {
    if (state.stopped) return;
    state.uiMetrics.ensurePasses += 1;
    const context = controlContext();
    const host = ensureControlHost();
    if (!host) return;
    const permissionButton = context?.permissionButton;
    const composer = context?.composer;
    let promptButton = host.querySelector('[data-codex-base-prompt-trigger="true"]');
    let contextButton = host.querySelector('[data-codex-context-window-trigger="true"]');
    let usageButton = host.querySelector('[data-codex-context-usage-trigger="true"]');
    let providerIndicator = host.querySelector('[data-codex-provider-indicator="true"]');
    let liveButton = host.querySelector('[data-codex-live-control-trigger="true"]');
    let overflowButton = host.querySelector('[data-codex-control-overflow-trigger="true"]');
    if (featureEnabled("prompt") && permissionButton && composer) {
      if (!promptButton) promptButton = makeButton(permissionButton, composer);
      promptButton.className = "cbps-control cbps-trigger";
      if (promptButton.parentElement !== host) host.appendChild(promptButton);
      renderButton(promptButton, composer);
    } else promptButton?.remove();
    if (featureEnabled("context") && permissionButton && composer) {
      if (!contextButton) contextButton = makeContextButton(permissionButton, composer);
      contextButton.className = "cbps-control cbps-trigger cbps-context-trigger";
      if (contextButton.parentElement !== host) host.appendChild(contextButton);
      renderContextButton(contextButton, composer);
    } else contextButton?.remove();
    if (featureEnabled("context") && permissionButton && composer) {
      if (!usageButton) usageButton = makeUsageButton(permissionButton, composer);
      usageButton.className = "cbps-control cbps-trigger cbps-usage-trigger";
      if (usageButton.parentElement !== host) host.appendChild(usageButton);
      renderUsageButton(usageButton, composer);
    } else usageButton?.remove();
    if (featureEnabled("provider") && permissionButton && composer) {
      if (!providerIndicator) providerIndicator = makeProviderIndicator(permissionButton, composer);
      providerIndicator.className = "cbps-control cbps-trigger cbps-provider-indicator";
      if (providerIndicator.parentElement !== host) host.appendChild(providerIndicator);
      renderProviderIndicator(providerIndicator, composer);
    } else providerIndicator?.remove();
    if (liveControlEnabled() && permissionButton && composer) {
      if (!liveButton) liveButton = makeLiveControlButton();
      if (liveButton.parentElement !== host) host.appendChild(liveButton);
      renderLiveControlButton(liveButton);
    } else liveButton?.remove();
    if (businessFeaturesEnabled() || liveControlEnabled()) {
      if (!overflowButton) overflowButton = makeControlOverflowButton();
      if (overflowButton.parentElement !== host) host.appendChild(overflowButton);
    } else overflowButton?.remove();
    host.hidden = !context || (!businessFeaturesEnabled() && !liveControlEnabled());
    scheduleControlPosition();
    if (state.menu && !state.menuButton?.isConnected) closeMenu();
    else positionMenu();
    notifyHealthChanged();
  };

  function scheduleEnsure() {
    if (state.stopped || state.ensureQueued) return;
    state.ensureQueued = true;
    state.uiMetrics.ensureSchedules += 1;
    const flush = () => {
      state.ensureQueued = false;
      ensureUi();
    };
    if (typeof queueMicrotask === "function") queueMicrotask(flush);
    else Promise.resolve().then(flush);
  }

  const onDocumentKeyDown = (event) => { if (event.key === "Escape") closeMenu(); };
  const onWindowResize = () => { scheduleControlPosition(); positionMenu(); };
