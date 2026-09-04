  const chooseFile = async () => {
    try {
      const response = await requestBridge("chooseFile");
      if (response.cancelled) return;
      const profile = normalizeProfile({
        id: `file:${response.path}`,
        label: response.label,
        path: response.path,
        hash: response.hash,
      }, "recent");
      if (!profile) throw new Error("The selected file did not produce a valid profile");
      await selectProfile(profile);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    }
  };
  const shortPath = (filePath) => {
    if (!filePath) return "使用 Codex 内置 instructions";
    if (filePath.startsWith("/Users/") || filePath.startsWith("/home/")) {
      const parts = filePath.split("/");
      if (parts.length > 3) return `~/${parts.slice(3).join("/")}`;
    }
    return filePath;
  };

  const contextDescription = (context) => {
    if (!context.contextWindow) return "跟随所选模型，不写入覆盖值";
    return [
      `${formatTokenCount(context.contextWindow)} configured`,
      `${formatTokenCount(runtimeReportedContextWindow(context.contextWindow))} effective`,
      `compact @ ${formatTokenCount(context.autoCompactTokenLimit)}`,
    ].join(" · ");
  };

  const contextTitle = (context) => {
    if (!context.contextWindow) return "使用模型目录声明的上下文窗口与自动 compact 阈值";
    const lines = [
      `配置窗口 ${context.contextWindow.toLocaleString("en-US")} tokens`,
      `Codex 有效窗口 ${runtimeReportedContextWindow(context.contextWindow).toLocaleString("en-US")} tokens（预留 5%）`,
      `自动 compact ${context.autoCompactTokenLimit.toLocaleString("en-US")} tokens`,
      `计数范围：${context.scope}`,
    ];
    if (context.id === "oai") lines.unshift("Legacy OAI 272K");
    return lines.join("\n");
  };

  const checkIcon = () => {
    const span = document.createElement("span");
    span.className = "cbps-check";
    span.textContent = "✓";
    return span;
  };

  const positionMenu = () => {
    if (!state.menu || !state.menuButton) return;
    let anchorButton = state.menuButton;
    if (!visuallyAvailable(anchorButton) && visuallyAvailable(state.menuFallbackButton)) {
      anchorButton = state.menuFallbackButton;
    } else if (!visuallyAvailable(anchorButton)) {
      const fallback = state.controlHost?.querySelector(
        '[data-codex-control-overflow-trigger="true"]',
      );
      closeMenu();
      if (visuallyAvailable(fallback)) {
        try { fallback.focus({ preventScroll: true }); } catch { fallback.focus(); }
      }
      return;
    }
    const footer = state.controlFooter?.isConnected
      ? state.controlFooter : controlContext()?.footer;
    if (!footer?.isConnected) {
      closeMenu();
      return;
    }
    const footerRect = footer.getBoundingClientRect();
    const viewportRight = (Number(window.innerWidth) || 0) - 12;
    const paneLeft = Math.max(12, Number(footerRect.left) || 12);
    const paneRight = Math.min(
      viewportRight,
      Number(footerRect.right) > 0 ? Number(footerRect.right) : viewportRight,
    );
    const paneWidth = Math.max(0, paneRight - paneLeft);
    if (paneWidth < 64) {
      closeMenu();
      return;
    }
    state.menu.style.maxWidth = `${Math.floor(paneWidth)}px`;
    const rect = anchorButton.getBoundingClientRect();
    const menuRect = state.menu.getBoundingClientRect();
    const left = Math.min(paneRight - menuRect.width, Math.max(paneLeft, rect.left));
    const above = rect.top - menuRect.height - 10;
    const top = above >= 12 ? above : Math.min(window.innerHeight - menuRect.height - 12, rect.bottom + 10);
    state.menu.style.left = `${Math.round(left)}px`;
    state.menu.style.top = `${Math.round(Math.max(12, top))}px`;
  };

  const openMenu = (button) => {
    renderButton(button, state.controlComposer);
    if (state.managerStatus !== "ready") {
      reprobeManager();
      showToast("Base Prompt 控制器仍在连接，请稍后重试", "error");
      return;
    }
    closeMenu();
    const selected = resolvePendingProfile();
    const menu = document.createElement("div");
    menu.className = "cbps-menu";
    menu.setAttribute("role", "menu");
    const title = document.createElement("div");
    title.className = "cbps-menu-title";
    title.textContent = "Developer Prompt（下一个新 task）";
    menu.appendChild(title);
    const divider = document.createElement("div");
    divider.className = "cbps-divider";
    menu.appendChild(divider);

    for (const profile of allProfiles()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cbps-menu-item";
      item.setAttribute("role", "menuitemradio");
      const active = profile.id === selected.id || (profile.path && profile.path === selected.path);
      item.setAttribute("aria-checked", active ? "true" : "false");
      if (active) item.dataset.selected = "true";
      item.appendChild(active ? checkIcon() : Object.assign(document.createElement("span"), { className: "cbps-check" }));
      const label = document.createElement("span");
      label.className = "cbps-item-label";
      label.textContent = profile.label;
      item.appendChild(label);
      const description = document.createElement("span");
      description.className = "cbps-item-path";
      description.textContent = shortPath(profile.path);
      description.title = profile.path || "Codex built-in model instructions";
      item.appendChild(description);
      item.addEventListener("click", () => {
        selectProfile(profile, { validate: profile.source === "recent" }).catch((error) => {
          showToast(error instanceof Error ? error.message : String(error), "error");
        });
      });
      menu.appendChild(item);
    }

    const binding = window[String(state.config.bindingName || "__codexBasePromptBridge")];
    if (typeof binding === "function") {
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "cbps-menu-item cbps-choose";
      choose.setAttribute("role", "menuitem");
      const folder = document.createElement("span");
      folder.className = "cbps-check";
      folder.textContent = "⌁";
      choose.appendChild(folder);
      const chooseLabel = document.createElement("span");
      chooseLabel.className = "cbps-item-label";
      chooseLabel.textContent = "选择文件…";
      choose.appendChild(chooseLabel);
      const chooseDescription = document.createElement("span");
      chooseDescription.className = "cbps-item-path";
      chooseDescription.textContent = "任意绝对路径";
      choose.appendChild(chooseDescription);
      choose.addEventListener("click", () => {
        closeMenu();
        chooseFile();
      });
      menu.appendChild(choose);
    }

    const note = document.createElement("div");
    note.className = "cbps-note";
    note.textContent = "仅影响下一个新 task；创建后自动锁定";
    menu.appendChild(note);
    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-expanded", "true");
    positionMenu();
  };

  const openContextMenu = (button) => {
    renderContextButton(button, state.controlComposer);
    if (state.managerStatus !== "ready") {
      reprobeManager();
      showToast("Context 控制器仍在连接，请稍后重试", "error");
      return;
    }
    const threadId = currentConversationId(state.controlComposer);
    if (threadId) reconcilePendingContextVerification(threadId);
    if (threadId && state.contextSwitches.has(threadId)) {
      showToast("此 task 正在切换 Context，请稍候");
      return;
    }
    closeMenu();
    const applied = threadId ? contextForThread(threadId) : resolvePendingContext();
    const queued = threadId ? state.queuedContextSwitches.get(threadId) ?? null : null;
    const selected = queued?.context ?? applied;
    const usage = threadId ? tokenUsageForThread(threadId) : null;
    const lastSwitch = threadId ? contextSwitchForThread(threadId) : null;
    const runtimeVerificationPending = Boolean(threadId
      && lastSwitch?.ok === true
      && lastSwitch.threadId === threadId
      && lastSwitch.verificationPending
      && lastSwitch.totalTokens != null
      && usage?.totalTokens === lastSwitch.totalTokens);
    const menu = document.createElement("div");
    menu.className = "cbps-menu cbps-context-menu";
    menu.setAttribute("role", "menu");

    const title = document.createElement("div");
    title.className = "cbps-menu-title";
    title.textContent = threadId ? "当前 task 的上下文窗口" : "上下文窗口（下一个新 task）";
    menu.appendChild(title);
    const subtitle = document.createElement("div");
    subtitle.className = "cbps-menu-subtitle";
    subtitle.textContent = threadId
      ? queued
        ? `当前 ${applied.label} · 本轮完成后应用 ${queued.context.label}`
        : runtimeVerificationPending
        ? `当前有效 token ${formatTokenCount(usage.totalTokens)} · 已请求 ${selected.label}（下一轮 usage 确认）`
        : `当前 token ${formatTokenCount(usage.totalTokens)} · runtime effective ${formatTokenCount(usage.modelContextWindow)} · configured ${formatTokenCount(selected.contextWindow)}`
      : "同时设置 context window 与自动 compact 阈值";
    menu.appendChild(subtitle);
    const divider = document.createElement("div");
    divider.className = "cbps-divider";
    menu.appendChild(divider);

    for (const preset of CONTEXT_PRESETS) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cbps-menu-item";
      item.setAttribute("role", "menuitemradio");
      const active = preset.id === selected.id
        || (preset.contextWindow === selected.contextWindow
          && preset.autoCompactTokenLimit === selected.autoCompactTokenLimit
          && preset.scope === selected.scope);
      item.setAttribute("aria-checked", active ? "true" : "false");
      if (active) item.dataset.selected = "true";
      item.appendChild(active
        ? checkIcon()
        : Object.assign(document.createElement("span"), { className: "cbps-check" }));
      const label = document.createElement("span");
      label.className = "cbps-item-label";
      label.textContent = preset.id === "native" ? "Native / 官方默认"
        : preset.id === "oai" ? "Legacy OAI 272K" : preset.label;
      item.appendChild(label);
      const description = document.createElement("span");
      description.className = "cbps-item-path";
      description.textContent = contextDescription(preset);
      description.title = contextTitle(preset);
      item.appendChild(description);
      item.addEventListener("click", () => {
        selectContext(preset, { threadId }).catch((error) => {
          showToast(error instanceof Error ? error.message : String(error), "error");
        });
      });
      menu.appendChild(item);
    }

    appendCustomContextFields(menu, selected, threadId);

    const note = document.createElement("div");
    note.className = "cbps-note";
    note.textContent = threadId
      ? hasThreadRecord(threadId)
        ? "仅修改当前 task；缩小窗口时保留历史，下一轮按新阈值自动 compact。"
        : "旧 task 也可切换：Base Prompt 从 rollout 原样恢复；缩小时下一轮自动 compact。"
      : "仅影响下一个新 task；不会突破模型或 Provider 的真实上限";
    menu.appendChild(note);
    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-expanded", "true");
    positionMenu();
  };
