import { contextBrowserBootstrap } from "./context-browser-bootstrap.mjs";

export function contextBrowserFixture(payload) {
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { margin: 0; background: #111; color: #eee; }
footer { position: fixed; left: 80px; right: 80px; bottom: 30px; height: 48px; }
[data-codex-composer="true"] { min-height: 32px; }
[data-composer-navigation-target="permissions"] {
  position: absolute; left: 0; bottom: 9px; width: 100px; height: 30px;
}
</style></head><body>
<footer data-composer-footer-responsive="true">
  <section data-codex-composer="true"></section>
  <button data-composer-navigation-target="permissions">Permissions</button>
</footer>
<footer data-composer-footer-responsive="true" aria-hidden="true" hidden>
  <section data-codex-composer="true"></section>
  <button data-composer-navigation-target="permissions">Stale permissions</button>
</footer>
<pre id="result"></pre>
<script>
(() => {
${contextBrowserBootstrap(encodedPayload)}
  (async () => {
    const api = await waitFor(() => {
      const candidate = window.__CODEX_BASE_PROMPT_SWITCHER__;
      return candidate && candidate.diagnostics().managerStatus === "ready" ? candidate : null;
    }, "Context manager");
    recordNative(api, THREAD_A);
    const promptButton = await waitFor(() =>
      document.querySelector('[data-codex-base-prompt-trigger="true"]'), "Prompt button");
    promptButton.click();
    const workItem = [...document.querySelectorAll(".cbps-menu-item")].find((item) =>
      item.querySelector(".cbps-item-label")?.textContent === "Work");
    if (!workItem) throw new Error("Developer Prompt menu is incomplete");
    workItem.click();
    await waitFor(() => api.diagnostics().pendingProfile.id === "work", "Next Base selection");
    await requestClient.sendRequest("thread/start", { threadSource: "user", config: {} });
    await requestClient.sendRequest("thread/start", { threadSource: "user", config: {} });
    const promptStarts = calls.filter((call) => call.method === "thread/start");

    const button = await waitFor(() =>
      document.querySelector('[data-codex-context-window-trigger="true"]'), "Context button");
    button.click();
    const contextMenu = document.querySelector(".cbps-context-menu");
    const nativeItem = [...contextMenu.querySelectorAll(".cbps-menu-item")].find((item) =>
      item.querySelector(".cbps-item-label")?.textContent.includes("Native"));
    const largeItem = [...contextMenu.querySelectorAll(".cbps-menu-item")].find((item) =>
      item.querySelector(".cbps-item-label")?.textContent === "450K");
    if (!nativeItem || !largeItem) throw new Error("Context menu is incomplete");
    const nativeTitle = nativeItem.querySelector(".cbps-item-path")?.title || "";
    largeItem.click();
    await waitFor(() => calls.some((call) => call.method === "thread/resume"
      && call.params.threadId === THREAD_A), "450K resume");
    const largeResume = calls.find((call) => call.method === "thread/resume"
      && call.params.threadId === THREAD_A);

    conversations.get(THREAD_A).latestTokenUsageInfo = {
      last: { totalTokens: 100001 }, modelContextWindow: 427500,
    };
    const largeVerified = api.diagnostics().lastContextSwitch.verificationPending === false;
    const beforeIdempotent = calls.length;
    await api.hotSwitchContext(THREAD_A, LARGE);
    const idempotentNoRequests = calls.length === beforeIdempotent;
    const beforeShrink = calls.length;
    await api.hotSwitchContext(THREAD_A, OAI);
    const afterShrink = calls.length;
    const shrinkResume = calls.slice(beforeShrink).find((call) => call.method === "thread/resume");

    conversations.set(THREAD_B, makeConversation());
    recordNative(api, THREAD_B);
    fiber.memoizedProps.conversationId = THREAD_B;
    button.click();
    const oaiItem = [...document.querySelectorAll(".cbps-menu-item")].find((item) =>
      item.querySelector(".cbps-item-label")?.textContent.includes("272K"));
    if (!oaiItem) throw new Error("272K Context menu item is missing");
    oaiItem.click();
    await waitFor(() => calls.some((call) => call.method === "thread/resume"
      && call.params.threadId === THREAD_B), "272K resume");
    const oaiResume = calls.find((call) => call.method === "thread/resume"
      && call.params.threadId === THREAD_B);
    conversations.get(THREAD_B).latestTokenUsageInfo = {
      last: { totalTokens: 100001 }, modelContextWindow: 258400,
    };
    const oaiVerified = api.diagnostics().currentContextSwitch?.verificationPending === false;
    const beforeNative = calls.length;
    button.click();
    const currentNativeItem = [...document.querySelectorAll(".cbps-menu-item")].find((item) =>
      item.querySelector(".cbps-item-label")?.textContent.includes("Native"));
    if (!currentNativeItem) throw new Error("Native Context menu item is missing");
    currentNativeItem.click();
    await waitFor(() => calls.slice(beforeNative).some((call) => call.method === "thread/resume"),
      "Native resume");
    const nativeResume = calls.slice(beforeNative).find((call) => call.method === "thread/resume");

    conversations.set(THREAD_C, makeConversation("active"));
    recordNative(api, THREAD_C);
    await api.hotSwitchContext(THREAD_C, LARGE);
    await api.hotSwitchContext(THREAD_C, MEDIUM);
    fiber.memoizedProps.conversationId = THREAD_C;
    button.click();
    const queuedLabel = button.textContent;
    button.click();
    const beforeQueuedTurn = calls.length;
    conversations.get(THREAD_C).threadRuntimeStatus = { type: "idle" };
    await requestClient.sendRequest("turn/start", { threadId: THREAD_C, input: [] });
    const queuedMethods = calls.slice(beforeQueuedTurn).map((call) => call.method);
    const queuedResume = calls.slice(beforeQueuedTurn).find((call) => call.method === "thread/resume");

    conversations.set(THREAD_D, makeConversation());
    recordNative(api, THREAD_D);
    await api.hotSwitchContext(THREAD_D, LARGE);
    conversations.get(THREAD_D).latestTokenUsageInfo = {
      last: { totalTokens: 100001 }, modelContextWindow: 258400,
    };
    fiber.memoizedProps.conversationId = THREAD_D;
    const rejectedFresh = api.diagnostics();

    const staleConversation = makeConversation("active");
    staleConversation.serverStatus = { type: "idle" };
    staleConversation.latestTokenUsageInfo = {
      last: { totalTokens: 100000 }, modelContextWindow: 380000,
    };
    conversations.set(THREAD_E, staleConversation);
    api.recordThreadFromResult(
      { thread: { id: THREAD_E } },
      { id: "default", label: "Default" },
      MEDIUM,
      "browser/400k",
      { prompt: false, context: true },
    );
    const beforeImmediate = calls.length;
    const immediateResult = await api.hotSwitchContext(THREAD_E, XL);
    const immediateCalls = calls.slice(beforeImmediate);
    const immediateMethods = immediateCalls.map((call) => call.method);
    const immediateResume = immediateCalls.find((call) => call.method === "thread/resume");

    const bounds = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    const host = document.getElementById("codex-prompt-context-control-host");
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]');
    const initialBounds = { host: bounds(host), permission: bounds(permission) };
    const footer = composer.closest("footer");
    footer.style.height = "160px";
    await new Promise((resolve) => setTimeout(resolve, 32));
    const multilineBounds = { host: bounds(host), permission: bounds(permission) };

    const nextFooter = document.createElement("footer");
    nextFooter.setAttribute("data-composer-footer-responsive", "true");
    const nextComposer = document.createElement("section");
    nextComposer.setAttribute("data-codex-composer", "true");
    nextComposer.__reactFiber$contextRegression = fiber;
    const nextPermission = document.createElement("button");
    nextPermission.setAttribute("data-composer-navigation-target", "permissions");
    nextPermission.textContent = "Permissions";
    nextFooter.append(nextComposer, nextPermission);
    footer.remove();
    document.body.insertBefore(nextFooter, host);
    const sidebar = document.createElement("aside");
    sidebar.className = "app-shell-left-panel";
    document.body.append(sidebar);
    sidebar.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await requestClient.sendRequest("thread/read", { threadId: THREAD_E });
    const replacementRowStyle = getComputedStyle(nextPermission.parentElement);
    const replacementGap = Math.max(0, Number.parseFloat(
      replacementRowStyle.columnGap === "normal"
        ? replacementRowStyle.gap : replacementRowStyle.columnGap,
    ) || 0);
    let replacementLayout = null;
    await waitFor(() => {
      const hostRect = host.getBoundingClientRect();
      const permissionRect = nextPermission.getBoundingClientRect();
      replacementLayout = {
        host: bounds(host), permission: bounds(nextPermission),
        composer: bounds(nextComposer), footer: bounds(nextFooter),
        gap: replacementGap, hidden: host.hidden,
        candidate: host.dataset.cbpsActiveCandidate ?? null,
        hits: document.elementsFromPoint(
          permissionRect.left + permissionRect.width / 2,
          permissionRect.top + permissionRect.height / 2,
        ).map((node) => node.tagName + ":" + (node.getAttribute("data-composer-navigation-target") || node.className || "")),
        controlOwner: api.diagnostics().controlOwner ?? null,
        anchorRect: api.diagnostics().controlAnchorRect ?? null,
      };
      return Math.abs(hostRect.left - permissionRect.right - replacementGap) < 0.6
        && Math.abs((hostRect.top + hostRect.height / 2)
          - (permissionRect.top + permissionRect.height / 2)) < 0.6;
    }, () => "Session replacement controls: " + JSON.stringify(replacementLayout));
    await new Promise((resolve) => setTimeout(resolve, 32));
    const sessionBounds = { host: bounds(host), permission: bounds(nextPermission) };
    await new Promise((resolve) => setTimeout(resolve, 800));

    const beforeNavigation = api.diagnostics();
    for (let index = 0; index < 100; index += 1) {
      sidebar.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }
    const navigationPeak = api.diagnostics();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const navigationEnd = api.diagnostics();
    const beforeInput = api.diagnostics();
    for (let index = 0; index < 1000; index += 1) {
      nextComposer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: "a" }));
      nextComposer.dispatchEvent(new InputEvent("input", { bubbles: true, data: "a" }));
    }
    const afterInput = api.diagnostics();
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const settled = api.diagnostics();

    return {
      viewport: { width: innerWidth, height: innerHeight },
      managerStatus: api.diagnostics().managerStatus,
      mutationObserverCount,
      resizeObserverCount,
      intervalCount,
      hotListenerCounts,
      firstPromptPath: promptStarts[0]?.params?.config?.model_instructions_file ?? null,
      secondPromptPath: promptStarts[1]?.params?.config?.model_instructions_file ?? null,
      promptResetToDefault: api.diagnostics().pendingProfile.id === "default",
      historicalPrompt: api.profileForThread(THREAD_A).id,
      nativeCopyIsClean: !/只对下一个|仅适用于下一个/.test(nativeTitle),
      largeWindow: largeResume?.params?.config?.model_context_window ?? null,
      largeCompact: largeResume?.params?.config?.model_auto_compact_token_limit ?? null,
      largeVerified,
      idempotentNoRequests,
      shrinkApplied: afterShrink > beforeShrink
        && shrinkResume?.params?.config?.model_context_window === 272000,
      oaiWindow: oaiResume?.params?.config?.model_context_window ?? null,
      oaiVerified,
      nativeHasWindowOverride: Object.hasOwn(
        nativeResume?.params?.config || {}, "model_context_window",
      ),
      nativeCurrent: api.contextForThread(THREAD_B).id,
      queuedLabel,
      queuedMethods,
      queuedWindow: queuedResume?.params?.config?.model_context_window ?? null,
      queuedDrained: api.queuedContextForRequest("turn/start", { threadId: THREAD_C }) == null,
      rejectedFreshRolledBack: rejectedFresh.lastContextSwitch.ok === false
        && rejectedFresh.currentContext.id === "native",
      staleActiveAppliedImmediately: immediateResult.queued !== true
        && immediateMethods.join(",") === "thread/read,thread/unsubscribe,thread/resume",
      staleActiveWindow: immediateResume?.params?.config?.model_context_window ?? null,
      controls: {
        composerContain: getComputedStyle(nextComposer).contain,
        nativePermissionUntouched:
          nextPermission.getAttribute("data-codexctl-control-anchor") === null,
        hostCount: document.querySelectorAll("#codex-prompt-context-control-host").length,
        promptCount: document.querySelectorAll('[data-codex-base-prompt-trigger="true"]').length,
        contextCount: document.querySelectorAll('[data-codex-context-window-trigger="true"]').length,
        hostOutsideFooter: host.parentElement === document.body,
        promptMenuReachable: Boolean(workItem),
        contextMenuReachable: Boolean(nativeItem && largeItem && oaiItem),
        initialBounds,
        multilineBounds,
        sessionBounds,
      },
      stress: {
        navigationRepairs: navigationPeak.uiMetrics.navigationRepairs
          - beforeNavigation.uiMetrics.navigationRepairs,
        navigationPeakTimers: navigationPeak.activeTimers.navigation,
        navigationEndTimers: navigationEnd.activeTimers.navigation,
        inputEnsureDelta: afterInput.uiMetrics.ensureSchedules
          - beforeInput.uiMetrics.ensureSchedules,
        inputPositionDelta: afterInput.uiMetrics.positionPasses
          - beforeInput.uiMetrics.positionPasses,
        graphAttempts: settled.managerProbe.graphAttempts,
        settledTimers: settled.activeTimers,
      },
    };
  })().then((result) => {
    document.getElementById("result").textContent = JSON.stringify(result);
  }).catch((error) => {
    document.getElementById("result").textContent = JSON.stringify({ error: error.stack || error.message });
  });
})();
</script></body></html>`;
}
