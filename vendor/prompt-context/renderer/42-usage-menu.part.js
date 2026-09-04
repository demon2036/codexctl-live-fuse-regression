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

  const cacheRate = (bucket) => {
    const input = finiteNonNegative(bucket?.inputTokens);
    const cached = finiteNonNegative(bucket?.cachedInputTokens);
    if (input == null || cached == null || input <= 0) return null;
    return Math.min(100, (cached / input) * 100);
  };

  const appendCacheBucket = (panel, titleText, bucket, badgeText = "Exact") => {
    const section = usageSection(titleText, badgeText);
    const input = finiteNonNegative(bucket?.inputTokens);
    const cached = finiteNonNegative(bucket?.cachedInputTokens);
    const uncached = finiteNonNegative(bucket?.uncachedInputTokens);
    const percent = cacheRate(bucket);
    if (input == null || cached == null || uncached == null || input <= 0) {
      section.appendChild(usageRow("Cache data", "Not available yet"));
      panel.appendChild(section);
      return;
    }
    section.appendChild(usageRow("Cached input", `${usageInteger(cached)} / ${usageInteger(input)}`, percent));
    section.appendChild(usageRow("Uncached input", `${usageInteger(uncached)} / ${usageInteger(input)}`, 100 - percent));
    section.appendChild(usageProgress(percent, `${titleText} cached input`, "cbps-usage-progress-context"));
    panel.appendChild(section);
  };

  const localUsageBucket = (threadId) => {
    const usage = state.liveStatus?.usage;
    return usage?.local ?? usage?.totals ?? usage?.threads?.[threadId]?.local ?? null;
  };

  const appendLocalUsage = (panel, threadId) => {
    const bucket = localUsageBucket(threadId);
    if (bucket) {
      appendCacheBucket(panel, "Local history", bucket, "Persistent");
      return;
    }
    const section = usageSection("Local history", "Persistent");
    section.appendChild(usageRow("Status", "History index is not connected yet"));
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
    menu.setAttribute("data-usage-mode", "cache");

    const title = document.createElement("div");
    title.id = titleId;
    title.className = "cbps-menu-title cbps-usage-title";
    title.textContent = "Usage";
    menu.appendChild(title);
    appendCacheBucket(menu, "Latest model call", metrics.cache.last);
    appendCacheBucket(menu, "Current task", metrics.cache.conversation);
    appendLocalUsage(menu, threadId);
    const note = document.createElement("div");
    note.className = "cbps-note cbps-usage-note";
    note.textContent = "Cached and uncached input are exact runtime counters; no conversation content is modified.";
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
