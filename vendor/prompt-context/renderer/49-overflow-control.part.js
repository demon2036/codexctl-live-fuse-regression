  const overflowMenuItem = (target, label, description, overflowButton, opener) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cbps-menu-item cbps-overflow-menu-item";
    item.setAttribute("role", "menuitem");
    item.setAttribute("data-codex-overflow-target", target);
    item.appendChild(Object.assign(document.createElement("span"), {
      className: "cbps-check", textContent: "›",
    }));
    item.appendChild(Object.assign(document.createElement("span"), {
      className: "cbps-item-label", textContent: label,
    }));
    item.appendChild(Object.assign(document.createElement("span"), {
      className: "cbps-item-path", textContent: description,
    }));
    item.addEventListener("click", () => {
      const targetButton = state.controlHost?.querySelector(
        `[data-composer-navigation-target="${target}"]`,
      );
      closeMenu();
      if (!targetButton) return;
      state.menuFallbackButton = overflowButton;
      try {
        opener(targetButton);
        if (state.menu && state.menuButton === targetButton) {
          targetButton.setAttribute("aria-expanded", "false");
          state.menuButton = overflowButton;
          overflowButton.setAttribute("aria-expanded", "true");
          positionMenu();
        }
      } finally {
        state.menuFallbackButton = null;
      }
    });
    return item;
  };

  const openControlOverflowMenu = (button) => {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "cbps-menu cbps-overflow-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-codex-control-overflow-menu", "true");
    const title = document.createElement("div");
    title.className = "cbps-menu-title";
    title.textContent = "Controls";
    menu.appendChild(title);
    const inline = new Set((state.controlHost?.dataset.cbpsInline ?? "").split(" "));
    const append = (selector, target, label, description, opener) => {
      if (!inline.has(target) && state.controlHost?.querySelector(selector)) menu.appendChild(overflowMenuItem(
        target, label, description, button, opener,
      ));
    };
    append('[data-codex-context-usage-trigger="true"]',
      "context-usage", "Usage", "最近调用与累计缓存统计", openUsageMenu);
    append('[data-codex-base-prompt-trigger="true"]',
      "base-prompt", "Base Prompt", "下一个新 task", openMenu);
    append('[data-codex-context-window-trigger="true"]',
      "context-window", "Context window", "当前 task", openContextMenu);
    append('[data-codex-provider-indicator="true"]',
      "provider", "Provider", "当前或下一个 task", openProviderMenu);
    append('[data-codex-live-control-trigger="true"]',
      "live-control", "Enhancements", "插拔、调试与恢复", openLiveControlMenu);
    if (!mountControlOverlay(menu)) return;
    state.menu = menu;
    state.menuButton = button;
    button.setAttribute("aria-expanded", "true");
    positionMenu();
  };

  const makeControlOverflowButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cbps-control cbps-trigger cbps-more-trigger";
    button.setAttribute("data-codex-control-overflow-trigger", "true");
    button.setAttribute("data-composer-navigation-target", "control-overflow");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "更多 task 控制");
    button.innerHTML = '<span class="cbps-label"><span class="cbps-label-prefix">More</span></span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.menu && state.menuButton === button) closeMenu();
      else openControlOverflowMenu(button);
    });
    return button;
  };
  const measureControlPresentations = (host, baseline) => {
    const saved = {
      hidden: host.hidden,
      presentation: host.getAttribute("data-cbps-presentation"),
      density: host.getAttribute("data-cbps-density"),
      inline: host.getAttribute("data-cbps-inline"),
      left: host.style.left, top: host.style.top,
      width: host.style.width, maxWidth: host.style.maxWidth,
    };
    host.hidden = false;
    host.setAttribute("data-cbps-measuring", "true");
    Object.assign(host.style, { left: "0px", top: "0px", width: "max-content", maxWidth: "none" });
    const measure = (definition) => {
      setAttributeIfChanged(host, "data-cbps-presentation", definition.presentation);
      setAttributeIfChanged(host, "data-cbps-density", definition.density);
      setAttributeIfChanged(host, "data-cbps-inline", definition.inline ?? "");
      const rect = controlRectSnapshot(host.getBoundingClientRect());
      const controls = measurableControlNodes(host).map((node) => {
        const current = controlRectSnapshot(node.getBoundingClientRect());
        return {
          left: current.left - rect.left, top: current.top - rect.top,
          right: current.right - rect.left, bottom: current.bottom - rect.top,
          width: current.width, height: current.height,
        };
      });
      return { ...definition, width: rect.width, height: rect.height, controls };
    };
    const direct = ["comfortable", "compact", "tight"].map((density) => measure({
      key: `direct-${density}`, presentation: "direct", density,
    }));
    const fallback = measure({ key: "more-only", presentation: "more-only", density: "tight" });
    const overflow = [];
    let inline = [];
    // Reserve More first, then keep each control that fits. A long label must
    // not prevent a shorter, lower-priority control from using the remaining gap.
    for (const target of ["context-usage", "context-window", "base-prompt", "provider", "live-control"]) {
      if (!host.querySelector(`[data-composer-navigation-target="${target}"]`)) continue;
      const proposed = [...inline, target];
      const candidate = measure({ key: `overflow-${proposed.join("-")}`,
        presentation: "overflow", density: "tight", inline: proposed.join(" "),
      });
      if (!candidateFits(candidate, baseline)) continue;
      inline = proposed;
      overflow.unshift(candidate);
    }
    restoreControlAttribute(host, "data-cbps-presentation", saved.presentation);
    restoreControlAttribute(host, "data-cbps-density", saved.density);
    restoreControlAttribute(host, "data-cbps-inline", saved.inline);
    host.removeAttribute("data-cbps-measuring");
    Object.assign(host.style, {
      left: saved.left, top: saved.top, width: saved.width, maxWidth: saved.maxWidth,
    });
    host.hidden = saved.hidden;
    return [...direct, ...overflow, fallback].map((candidate, index) => ({ ...candidate, index }));
  };
