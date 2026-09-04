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
    if (state.controlHost?.dataset.cbpsPresentation === "more-only"
      && state.controlHost.querySelector('[data-codex-context-usage-trigger="true"]')) {
      menu.appendChild(overflowMenuItem(
        "context-usage", "Usage", "最近调用与累计缓存统计", button, openUsageMenu,
      ));
    }
    const append = (selector, target, label, description, opener) => {
      if (state.controlHost?.querySelector(selector)) menu.appendChild(overflowMenuItem(
        target, label, description, button, opener,
      ));
    };
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
