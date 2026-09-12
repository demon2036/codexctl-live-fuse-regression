// This function runs in the isolated Chromium fixture, after normal startup.
export async function exerciseControlRecovery({ host, footer, requestClient, threadId }) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visibleTargets = () => [...host.children]
    .filter((node) => node.getBoundingClientRect().width > 0)
    .map((node) => node.dataset.composerNavigationTarget);
  const before = visibleTargets();
  const permission = footer.querySelector('[data-composer-navigation-target="permissions"]');
  const originalButtons = [...host.children];
  const request = () => requestClient.sendRequest("turn/start", { threadId, input: [] });
  const dismissals = [];
  for (const action of ["Escape", "aria-expanded"]) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999";
    document.body.appendChild(overlay);
    permission.setAttribute("aria-expanded", "true");
    permission.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await pause(80);
    const hiddenWhileOpen = host.hidden;
    overlay.remove();
    if (action === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: action }));
    else permission.setAttribute("aria-expanded", "false");
    await pause(160);
    dismissals.push({ action, hiddenWhileOpen, controls: visibleTargets() });
  }
  const transitions = [];
  for (const resize of [true, false]) {
    host.querySelector('[data-codex-base-prompt-trigger="true"]').click();
    permission.style.visibility = "hidden";
    await pause(80);
    const menuSuppressed = !document.querySelector(".cbps-menu");
    await request();
    // Let all three existing request repair timers expire while the owner is unavailable.
    await pause(900);
    const hiddenWhileUnavailable = host.hidden;
    permission.style.visibility = "";
    if (resize) window.dispatchEvent(new Event("resize"));
    await pause(160);
    transitions.push({ resize, hiddenWhileUnavailable, menuSuppressed, controls: visibleTargets(),
      buttonsPreserved: originalButtons.every((node) => node.parentElement === host) });
  }
  const parent = footer.parentElement;
  const composer = footer.querySelector('[data-codex-composer="true"]');
  const fiberKey = Object.keys(composer).find((key) => key.startsWith("__reactFiber$"));
  const replacement = footer.cloneNode(true);
  replacement.querySelector('[data-codex-composer="true"]')[fiberKey] = composer[fiberKey];
  footer.remove();
  await request();
  await pause(900);
  const hiddenWhileDetached = host.hidden;
  parent.appendChild(replacement);
  await pause(160);
  const replaced = { hiddenWhileDetached, controls: visibleTargets(),
    buttonsPreserved: originalButtons.every((node) => node.parentElement === host) };
  const beforeInput = window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().uiMetrics;
  const input = replacement.querySelector('[data-codex-composer="true"]');
  for (let index = 0; index < 100; index += 1) {
    input.appendChild(document.createTextNode("a"));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "a" }));
  }
  await pause(100);
  const afterInput = window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().uiMetrics;
  const model = replacement.querySelector("#model");
  const modelRect = model.getBoundingClientRect();
  const modelReachable = model.contains(document.elementFromPoint(
    modelRect.left + modelRect.width / 2, modelRect.top + modelRect.height / 2,
  ));
  return { before, dismissals, transitions, replaced, modelReachable,
    inputEnsureDelta: afterInput.ensureSchedules - beforeInput.ensureSchedules,
    inputPositionDelta: afterInput.positionPasses - beforeInput.positionPasses };
}
