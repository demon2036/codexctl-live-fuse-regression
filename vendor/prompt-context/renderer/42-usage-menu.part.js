  const usageInteger = (value) => {
    const numeric = finiteNonNegative(value);
    return numeric == null ? "—" : Math.round(numeric).toLocaleString("en-US");
  };

  const usagePercent = (value, digits = 2) => {
    const numeric = finiteNonNegative(value);
    return numeric == null ? "—" : `${numeric.toFixed(digits)}%`;
  };

  const usageSection = (titleText, badgeText = null) => {
    const section = document.createElement("section");
    section.className = "cbps-usage-section";
    const heading = document.createElement("div");
    heading.className = "cbps-usage-heading";
    const title = document.createElement("span");
    title.textContent = badgeText ? `${titleText} ` : titleText;
    heading.appendChild(title);
    if (badgeText) {
      const badge = document.createElement("span");
      badge.className = "cbps-usage-badge";
      badge.textContent = badgeText;
      heading.appendChild(badge);
    }
    section.appendChild(heading);
    return section;
  };

  const usageProgress = (percent, labelText, className = "") => {
    const track = document.createElement("div");
    track.className = `cbps-usage-progress ${className}`.trim();
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", labelText);
    const numeric = finiteNonNegative(percent);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    if (numeric == null) track.setAttribute("aria-valuetext", "Unavailable");
    else {
      track.setAttribute("aria-valuenow", String(Math.min(100, numeric)));
      track.setAttribute("aria-valuetext", usagePercent(numeric));
    }
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, numeric ?? 0)}%`;
    track.appendChild(fill);
    return track;
  };

  const usageRow = (labelText, valueText, percent = null) => {
    const row = document.createElement("div");
    row.className = "cbps-usage-row";
    const label = document.createElement("span");
    label.className = "cbps-usage-row-label";
    label.textContent = `${labelText} `;
    const value = document.createElement("span");
    value.className = "cbps-usage-row-value";
    value.textContent = percent == null ? valueText : `${valueText} ${usagePercent(percent)}`;
    row.append(label, value);
    return row;
  };

  const appendCurrentUsage = (panel, metrics) => {
    const section = usageSection("Current context");
    const current = metrics.current;
    section.appendChild(usageRow(
      "Context",
      `${usageInteger(current.usedTokens)} / ${usageInteger(current.contextWindow)}`,
      current.percent,
    ));
    section.appendChild(usageRow("Remaining", usageInteger(current.remainingTokens)));
    section.appendChild(usageProgress(
      current.percent,
      "Current context",
      "cbps-usage-progress-context",
    ));
    panel.appendChild(section);
  };

  const appendCacheUsage = (panel, metrics) => {
    const section = usageSection("Prompt cache");
    const last = metrics.cache.last;
    const conversation = metrics.cache.conversation;
    section.appendChild(usageRow(
      "Last request",
      `${usageInteger(last.cachedInputTokens)} / ${usageInteger(last.inputTokens)}`,
      last.percent,
    ));
    section.appendChild(usageRow(
      "Conversation",
      `${usageInteger(conversation.cachedInputTokens)} / ${usageInteger(conversation.inputTokens)}`,
      conversation.percent,
    ));
    section.appendChild(usageRow(
      "Uncached this turn",
      usageInteger(last.uncachedInputTokens),
    ));
    panel.appendChild(section);
  };

  const appendSourceUsage = (panel, metrics) => {
    const roleMode = metrics.roles?.mode ?? "unavailable";
    const badge = roleMode === "exact" ? "Exact"
      : roleMode === "estimated" ? "Estimated" : "Unavailable";
    const section = usageSection("Role breakdown", badge);
    if (!metrics.roles?.categories?.length) {
      section.appendChild(usageRow("Breakdown", "Unavailable"));
    } else {
      for (const category of metrics.roles.categories) {
        const row = usageRow(
          category.label,
          `${usageInteger(category.tokens)} · ${usagePercent(category.percent)}`,
        );
        row.className += " cbps-usage-source-row";
        row.appendChild(usageProgress(
          category.percent,
          `${category.label} share`,
          "cbps-usage-progress-source",
        ));
        section.appendChild(row);
      }
    }
    panel.appendChild(section);
  };

  const appendCompactionUsage = (panel, metrics) => {
    const section = usageSection("Compaction");
    section.appendChild(usageRow("Compactions", usageInteger(metrics.compaction.count)));
    const turnsAgo = metrics.compaction.turnsAgo;
    section.appendChild(usageRow(
      "Last compaction",
      turnsAgo == null ? "Never" : `${usageInteger(turnsAgo)} ${turnsAgo === 1 ? "turn" : "turns"} ago`,
    ));
    panel.appendChild(section);
  };

  const openUsageMenu = (button) => {
    const threadId = currentConversationId(state.controlComposer);
    if (!threadId || state.managerStatus !== "ready") {
      if (state.managerStatus !== "ready") reprobeManager();
      showToast(threadId ? "Usage 数据仍在连接，请稍后重试" : "当前还没有已建立的 task", "error");
      return;
    }
    closeMenu();
    const metrics = usageMetricsForThread(threadId);
    const menu = document.createElement("div");
    const panelId = `cbps-context-usage-${threadId.replace(/[^a-z0-9_-]/gi, "-")}`;
    const titleId = `${panelId}-title`;
    menu.className = "cbps-menu cbps-usage-menu";
    menu.id = panelId;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-labelledby", titleId);
    menu.setAttribute("data-codex-context-usage-panel", "true");
    menu.setAttribute("data-source-mode", metrics.sources?.mode ?? "unavailable");
    menu.setAttribute("data-role-mode", metrics.roles?.mode ?? "unavailable");

    const title = document.createElement("div");
    title.id = titleId;
    title.className = "cbps-menu-title cbps-usage-title";
    title.textContent = "Context usage";
    menu.appendChild(title);
    appendCurrentUsage(menu, metrics);
    appendCacheUsage(menu, metrics);
    appendSourceUsage(menu, metrics);
    appendCompactionUsage(menu, metrics);
    const note = document.createElement("div");
    note.className = "cbps-note cbps-usage-note";
    note.textContent = metrics.roles?.mode === "estimated"
      ? "Role shares are estimated from read-only conversation items; runtime totals and cache values remain exact."
      : "Read-only runtime statistics. No Codex App files or conversation objects are modified.";
    menu.appendChild(note);

    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-expanded", "true");
    positionMenu();
  };

  const refreshOpenUsageMenu = () => {
    const button = state.menu?.getAttribute?.("data-codex-context-usage-panel") === "true"
      ? state.menuButton : null;
    if (button?.isConnected) openUsageMenu(button);
  };
