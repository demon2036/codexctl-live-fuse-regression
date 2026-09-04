  const liveControlEnabled = () => featureEnabled("live")
    && state.config?.liveControl?.enabled === true;

  const liveRevisionLabel = (revision) => revision ? String(revision).slice(0, 8) : "—";

  const sendLiveControlAction = (operation, params = {}) => {
    if (!liveControlEnabled() || state.liveActionPending) return false;
    const url = new URL(`codexctl-live-action://v1/${operation}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    state.liveActionSequence += 1;
    state.liveActionPending = `${operation}:${state.liveActionSequence}`;
    renderOpenLiveControlMenu();
    window.location.href = url.href;
    return true;
  };

  const liveConnectionText = () => {
    const status = state.liveStatus;
    if (!status?.connected) return "Companion disconnected · stable state retained";
    return `Connected · App ${status.appPid} · Companion ${status.companionPid}`;
  };

  const makeLiveActionButton = (label, operation, params, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cbps-live-action${options.secondary ? " cbps-live-action-secondary" : ""}`;
    button.textContent = label;
    button.disabled = options.disabled === true || Boolean(state.liveActionPending);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendLiveControlAction(operation, params);
    });
    return button;
  };

  const appendLiveMaster = (menu, status) => {
    const row = document.createElement("div");
    row.className = "cbps-live-master";
    const copy = document.createElement("div");
    copy.className = "cbps-live-copy";
    const title = document.createElement("strong");
    title.textContent = "All enhancements";
    const detail = document.createElement("span");
    detail.textContent = status.masterEnabled
      ? "On · same App PID" : "Off · official renderer state";
    copy.append(title, detail);
    row.append(copy, makeLiveActionButton(
      status.masterEnabled ? "Turn off" : "Turn on",
      "master.set",
      { enabled: !status.masterEnabled },
      { disabled: !status.connected },
    ));
    menu.appendChild(row);
  };

  const livePluginDetail = (plugin) => {
    const revision = liveRevisionLabel(plugin.effectiveRevision);
    if (plugin.debugRevision) {
      return `B ${revision} mounted · A ${liveRevisionLabel(plugin.stableRevision)} unmounted${
        plugin.watch ? " · watching" : ""}`;
    }
    if (!plugin.enabled) return `Off · A ${liveRevisionLabel(plugin.stableRevision)} retained`;
    return `${plugin.effectiveKind === "stable" ? "A" : "Active"} ${revision} mounted`;
  };

  const appendLivePlugin = (menu, plugin, status) => {
    const row = document.createElement("div");
    row.className = "cbps-live-plugin";
    row.setAttribute("data-codex-live-plugin", plugin.id);
    row.setAttribute("data-live-enabled", plugin.enabled ? "true" : "false");
    row.setAttribute("data-live-debug", plugin.debugRevision ? "true" : "false");
    const copy = document.createElement("div");
    copy.className = "cbps-live-copy";
    const title = document.createElement("strong");
    title.textContent = plugin.displayName;
    const detail = document.createElement("span");
    detail.textContent = livePluginDetail(plugin);
    copy.append(title, detail);
    if (plugin.error) {
      const error = document.createElement("span");
      error.className = "cbps-live-error";
      error.textContent = plugin.error;
      copy.appendChild(error);
    }
    const actions = document.createElement("div");
    actions.className = "cbps-live-actions";
    const disabled = !status.connected || !status.masterEnabled || !plugin.available;
    if (plugin.debugRevision) {
      actions.appendChild(makeLiveActionButton(
        plugin.recoveryEnabled ? "Restore A" : "Restore off",
        "debug.stop",
        { pluginId: plugin.id },
        { disabled: !status.connected },
      ));
    } else {
      actions.appendChild(makeLiveActionButton(
        plugin.enabled ? "Off" : "On",
        "plugin.set",
        { enabled: !plugin.enabled, pluginId: plugin.id },
        { disabled },
      ));
      actions.appendChild(makeLiveActionButton(
        "Reload", "plugin.reload", { pluginId: plugin.id },
        { disabled, secondary: true },
      ));
    }
    row.append(copy, actions);
    menu.appendChild(row);
  };

  const buildLiveControlMenu = (button) => {
    const status = state.liveStatus ?? { connected: false, masterEnabled: false, plugins: [] };
    const menu = document.createElement("div");
    menu.className = "cbps-menu cbps-live-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Codexctl enhancements");
    menu.setAttribute("data-codex-live-control-menu", "true");
    const title = document.createElement("div");
    title.className = "cbps-menu-title";
    title.textContent = "Codexctl Enhancements";
    const subtitle = document.createElement("div");
    subtitle.className = "cbps-menu-subtitle cbps-live-connection";
    subtitle.textContent = liveConnectionText();
    menu.append(title, subtitle);
    if (state.liveActionPending) {
      const pending = document.createElement("div");
      pending.className = "cbps-live-pending";
      pending.textContent = "Applying one serialized transaction…";
      menu.appendChild(pending);
    }
    appendLiveMaster(menu, status);
    for (const plugin of status.plugins ?? []) appendLivePlugin(menu, plugin, status);
    if (status.lastError) {
      const error = document.createElement("div");
      error.className = "cbps-live-banner-error";
      error.textContent = `${status.lastError.code}: ${status.lastError.message}`;
      menu.appendChild(error);
    }
    return menu;
  };

  const openLiveControlMenu = (button) => {
    closeMenu();
    const menu = buildLiveControlMenu(button);
    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-expanded", "true");
    positionMenu();
  };

  function renderOpenLiveControlMenu() {
    const button = state.menuButton;
    if (!state.menu?.matches?.('[data-codex-live-control-menu="true"]') || !button) return;
    openLiveControlMenu(button);
  }

  const setLiveControlStatus = (next) => {
    if (!next || next.schema !== "codexctl-live-ui-status/1"
      || next.sessionId !== state.config?.liveControl?.sessionId) return false;
    state.liveStatus = next;
    state.liveActionPending = null;
    renderOpenLiveControlMenu();
    scheduleEnsure();
    return true;
  };

  const renderLiveControlButton = (button) => {
    const plugins = state.liveStatus?.plugins ?? [];
    const enabled = plugins.filter((plugin) => plugin.enabled).length;
    const connected = state.liveStatus?.connected === true;
    setAttributeIfChanged(button, "data-live-connected", connected ? "true" : "false");
    setAttributeIfChanged(button, "aria-label", "Open Codexctl enhancements");
    setAttributeIfChanged(button, "title", liveConnectionText());
    const content = `<span class="cbps-dot" aria-hidden="true"></span>${
      controlLabel("Codexctl", connected ? `${enabled}/${plugins.length || 4}` : "offline")}`;
    const key = JSON.stringify([connected, enabled, plugins.length]);
    if (button.dataset.cbpsRenderKey !== key) {
      button.innerHTML = content;
      setAttributeIfChanged(button, "data-cbps-render-key", key);
    }
  };

  const makeLiveControlButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cbps-control cbps-trigger cbps-live-trigger";
    button.setAttribute("data-codex-live-control-trigger", "true");
    button.setAttribute("data-composer-navigation-target", "live-control");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === button) closeMenu();
      else openLiveControlMenu(button);
    });
    renderLiveControlButton(button);
    return button;
  };
