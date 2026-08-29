  const providerDescription = (provider) => provider?.kind === "builtin"
    ? "ChatGPT / OpenAI 官方 Provider" : "已配置 Provider";

  const clearMenuChildren = (menu) => {
    while (menu?.children?.length) menu.children[menu.children.length - 1].remove();
  };

  const providerMenuItem = (provider, selectedId, button) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cbps-menu-item cbps-provider-menu-item";
    item.setAttribute("role", "menuitemradio");
    const active = provider.id === selectedId;
    item.setAttribute("aria-checked", active ? "true" : "false");
    if (active) item.dataset.selected = "true";
    item.appendChild(active
      ? checkIcon()
      : Object.assign(document.createElement("span"), { className: "cbps-check" }));
    const label = document.createElement("span");
    label.className = "cbps-item-label";
    label.textContent = provider.label;
    item.appendChild(label);
    const description = document.createElement("span");
    description.className = "cbps-item-path";
    description.textContent = providerDescription(provider);
    description.title = provider.id;
    item.appendChild(description);
    item.addEventListener("click", async () => {
      item.disabled = true;
      try {
        const selected = await selectProvider(provider.id);
        closeMenu();
        showToast(`下一个新 session：${selected.label}`);
        renderProviderIndicator(button, state.controlComposer);
      } catch (error) {
        item.disabled = false;
        showToast(error instanceof Error ? error.message : String(error), "error");
      }
    });
    return item;
  };

  const renderProviderMenu = (menu, button, providers, status, error = null) => {
    clearMenuChildren(menu);
    const title = document.createElement("div");
    title.className = "cbps-menu-title";
    title.textContent = "Provider（下一个新 session）";
    menu.appendChild(title);
    const subtitle = document.createElement("div");
    subtitle.className = "cbps-menu-subtitle";
    subtitle.textContent = status === "loading"
      ? "正在读取 app-server 的 Provider 配置…"
      : "只影响下一个新 session；创建后锁定。";
    menu.appendChild(subtitle);
    const divider = document.createElement("div");
    divider.className = "cbps-divider";
    menu.appendChild(divider);
    if (status === "loading") {
      const loading = document.createElement("div");
      loading.className = "cbps-note";
      loading.textContent = "读取中…";
      menu.appendChild(loading);
    } else {
      const pending = pendingProviderDetails();
      const selectedId = pending?.id ?? providerDefaultId();
      for (const provider of providers) menu.appendChild(providerMenuItem(provider, selectedId, button));
      if (!providers.length) {
        const empty = document.createElement("div");
        empty.className = "cbps-note";
        empty.textContent = "没有可用的 Provider。";
        menu.appendChild(empty);
      }
      if (status === "error" || error) {
        const warning = document.createElement("div");
        warning.className = "cbps-note cbps-provider-warning";
        warning.textContent = error || (providers.length
          ? "Provider 配置读取失败，继续使用上次成功读取的列表。"
          : "Provider 配置读取失败，当前只显示内置 OpenAI。");
        menu.appendChild(warning);
      }
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "cbps-menu-item cbps-choose";
      refresh.setAttribute("role", "menuitem");
      refresh.appendChild(Object.assign(document.createElement("span"), {
        className: "cbps-check", textContent: "↻",
      }));
      refresh.appendChild(Object.assign(document.createElement("span"), {
        className: "cbps-item-label", textContent: "刷新列表",
      }));
      refresh.appendChild(Object.assign(document.createElement("span"), {
        className: "cbps-item-path", textContent: "重新读取 config/read",
      }));
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        try {
          const next = await loadProviderCatalog(true);
          if (state.menu === menu) renderProviderMenu(menu, button, next, state.providerCatalogStatus,
            state.providerCatalogError);
        } catch (refreshError) {
          if (state.menu === menu) renderProviderMenu(
            menu,
            button,
            providerCatalog(),
            state.providerCatalogStatus,
            refreshError instanceof Error ? refreshError.message : String(refreshError),
          );
        }
        positionMenu();
      });
      menu.appendChild(refresh);
    }
    positionMenu();
  };

  const openProviderMenu = async (button) => {
    const threadId = currentConversationId(state.controlComposer);
    if (threadId) {
      const current = currentSessionProvider(state.controlComposer);
      showToast(current.id
        ? `当前 session 已锁定 Provider：${current.id}；请新建 session 后再切换`
        : "当前 session 已创建；请新建 session 后再选择 Provider");
      return;
    }
    if (state.managerStatus !== "ready") {
      reprobeManager();
      showToast("Provider 控制器仍在连接，请稍后重试", "error");
      return;
    }
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "cbps-menu cbps-provider-menu";
    menu.setAttribute("role", "menu");
    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-expanded", "true");
    renderProviderMenu(menu, button, providerCatalog(), state.providerCatalogStatus);
    try {
      const providers = await loadProviderCatalog();
      if (state.menu === menu) {
        renderProviderMenu(menu, button, providers, state.providerCatalogStatus,
          state.providerCatalogError);
      }
    } catch (error) {
      if (state.menu === menu) {
        renderProviderMenu(menu, button, providerCatalog(), state.providerCatalogStatus,
          error instanceof Error ? error.message : String(error));
      }
    }
  };

  const renderProviderIndicator = (indicator, composer) => {
    const provider = currentSessionProvider(composer);
    const pending = provider.status === "pending" ? pendingProviderDetails() : null;
    const effective = provider.status === "pending"
      ? providerDetailsForId(provider.id, provider.source) : null;
    const label = provider.status === "resolved" ? provider.id
      : pending?.label ? `${pending.label}（next）`
        : effective?.label ?? provider.id ?? "unknown";
    const selectable = provider.status === "pending" && !provider.threadId;
    setAttributeIfChanged(indicator, "data-provider", provider.id ?? "");
    setAttributeIfChanged(indicator, "data-provider-pending", pending?.id ?? "");
    setAttributeIfChanged(indicator, "data-provider-status", provider.status);
    setAttributeIfChanged(indicator, "data-provider-selectable", selectable ? "true" : "false");
    setAttributeIfChanged(indicator, "data-thread-id", provider.threadId ?? "");
    setAttributeIfChanged(indicator, "aria-haspopup", selectable ? "menu" : "false");
    setAttributeIfChanged(indicator, "aria-label", selectable
      ? `选择下一个新 session 的 Provider，当前 ${label}`
      : provider.status === "resolved"
        ? `当前 session Provider：${label}`
        : provider.status === "pending"
          ? `尚未创建 session；新 session 默认 Provider：${label}`
          : "当前 session Provider 尚未读取到");
    setAttributeIfChanged(indicator, "title", selectable
      ? `${pending ? `下一个新 session：${pending.label}`
        : `新 session 默认：${effective?.label ?? label}`}\n点击选择一次性 Provider；创建后自动锁定。`
      : provider.status === "resolved"
        ? `Session provider: ${label}\n这是 Codex 当前 session 记录的 Provider / 路由 ID；它不单独证明最终上游计费账户。`
        : provider.status === "pending"
          ? `尚未创建 session；新 session 默认 Provider：${label}。`
          : "当前 session 已创建，但 App 尚未暴露 Provider；完成一次读取或恢复后会刷新。");
    const renderKey = JSON.stringify([
      provider.status, provider.id, provider.threadId, provider.source, pending?.id, label,
    ]);
    if (indicator.dataset.cbpsRenderKey !== renderKey) {
      indicator.innerHTML = `<span class="cbps-provider-dot" aria-hidden="true"></span>`
        + `<span class="cbps-label"><span class="cbps-label-prefix">Provider</span>`
        + '<span class="cbps-label-separator" aria-hidden="true">:</span>'
        + `<span class="cbps-label-value">${escapeHtml(label)}</span></span>`
        + (selectable ? chevronSvg : "");
      setAttributeIfChanged(indicator, "data-cbps-render-key", renderKey);
    }
  };

  const makeProviderIndicator = (permissionButton, composer) => {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = "cbps-control cbps-trigger cbps-provider-indicator";
    indicator.setAttribute("data-codex-provider-indicator", "true");
    indicator.setAttribute("data-composer-navigation-target", "provider");
    indicator.setAttribute("aria-live", "polite");
    indicator.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === indicator) closeMenu();
      else openProviderMenu(indicator);
    });
    renderProviderIndicator(indicator, composer);
    return indicator;
  };
