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
      opener(targetButton);
      if (state.menu && state.menuButton === targetButton) {
        targetButton.setAttribute("aria-expanded", "false");
        state.menuButton = overflowButton;
        overflowButton.setAttribute("aria-expanded", "true");
        positionMenu();
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
    menu.appendChild(overflowMenuItem(
      "base-prompt", "Base Prompt", "下一个新 task", button, openMenu,
    ));
    menu.appendChild(overflowMenuItem(
      "context-window", "Context window", "当前 task", button, openContextMenu,
    ));
    menu.appendChild(overflowMenuItem(
      "provider", "Provider", "当前或下一个 task", button, openProviderMenu,
    ));
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
