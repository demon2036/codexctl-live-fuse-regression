  const appendCustomContextFields = (menu, selected, threadId) => {
    const divider = document.createElement("div");
    divider.className = "cbps-divider cbps-custom-divider";
    menu.appendChild(divider);
    const custom = document.createElement("div");
    custom.className = "cbps-custom-context";
    const heading = document.createElement("div");
    heading.className = "cbps-custom-heading";
    heading.textContent = "自定义（K tokens）";
    custom.appendChild(heading);

    const fields = document.createElement("div");
    fields.className = "cbps-custom-fields";
    const contextLabel = document.createElement("label");
    contextLabel.className = "cbps-custom-field";
    const contextCaption = document.createElement("span");
    contextCaption.textContent = "上下文上限";
    const contextInput = document.createElement("input");
    contextInput.type = "number";
    contextInput.min = "32";
    contextInput.max = "4096";
    contextInput.step = "1";
    contextInput.inputMode = "numeric";
    contextInput.value = String(selected.contextWindow ? selected.contextWindow / 1000 : 450);
    contextLabel.append(contextCaption, contextInput);
    fields.appendChild(contextLabel);

    const compactLabel = document.createElement("label");
    compactLabel.className = "cbps-custom-field";
    const compactCaption = document.createElement("span");
    compactCaption.textContent = "自动 compact";
    const compactInput = document.createElement("input");
    compactInput.type = "number";
    compactInput.min = "16";
    compactInput.max = "4080";
    compactInput.step = "1";
    compactInput.inputMode = "numeric";
    compactInput.value = String(selected.autoCompactTokenLimit
      ? selected.autoCompactTokenLimit / 1000
      : 400);
    compactLabel.append(compactCaption, compactInput);
    fields.appendChild(compactLabel);

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "cbps-custom-apply";
    apply.textContent = "应用";
    fields.appendChild(apply);
    custom.appendChild(fields);

    let compactEdited = false;
    compactInput.addEventListener("input", () => { compactEdited = true; });
    contextInput.addEventListener("input", () => {
      if (compactEdited) return;
      const contextK = Number(contextInput.value);
      if (!Number.isInteger(contextK)) return;
      const recommended = recommendedCompactLimit(contextK * 1000);
      if (recommended) compactInput.value = String(recommended / 1000);
    });
    const applyCustom = () => {
      const contextK = Number(contextInput.value);
      const compactK = Number(compactInput.value);
      const candidate = normalizeContext({
        id: `custom:${contextK}:${compactK}:total`,
        label: `${contextK}K`,
        contextWindow: contextK * 1000,
        autoCompactTokenLimit: compactK * 1000,
        scope: "total",
        source: "custom",
      }, "custom");
      if (!candidate) {
        showToast("请输入 32–4096K；compact 至少 16K，并给窗口保留至少 16K 余量", "error");
        return;
      }
      selectContext(candidate, { threadId }).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), "error");
      });
    };
    apply.addEventListener("click", applyCustom);
    compactInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applyCustom();
    });
    menu.appendChild(custom);
  };
