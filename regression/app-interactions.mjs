import { withAppSession } from "./app-cdp.mjs";

function add(failures, condition, code) {
  if (condition) failures.push(code);
}

export function evaluateAppInteractions(value = {}) {
  const failures = [];
  for (const [field, actual] of Object.entries(value.prompt ?? {})) {
    add(failures, actual !== true, `prompt-${field}`);
  }
  const context = value.context ?? {};
  for (const field of [
    "activeAppliedBeforeTurn", "activeLabelCurrentThread", "copyClean",
    "failureRolledBack", "idempotentNoRequest", "largeVerified", "nativeNoOverride",
    "retryRecovered", "shrinkRejectedBeforeRequest",
  ]) add(failures, context[field] !== true, `context-${field}`);
  add(failures, context.activeCoalescedWindow !== 600000, "context-active-window");
  add(failures, context.immediateOrder !== "thread/read,thread/unsubscribe,thread/resume",
    "context-immediate-order");
  add(failures, context.largeWindow !== 450000 || context.largeCompact !== 400000,
    "context-450k-mapping");
  add(failures, context.oaiWindow !== 272000 || context.oaiEffective !== 258400,
    "context-272k-mapping");
  for (const [field, actual] of Object.entries(value.layout ?? {})) {
    add(failures, actual !== true, `layout-${field}`);
  }
  const stress = value.stress ?? {};
  add(failures, stress.graphAttempts > 1, "stress-manager-graph");
  add(failures, stress.navigationPeakTimers < 1 || stress.navigationPeakTimers > 3,
    "stress-navigation-peak");
  for (const field of [
    "inputEnsureDelta", "inputPositionDelta", "navigationEndTimers", "observerCount",
    "settledTimerCount", "workerCount",
  ]) add(failures, stress[field] !== 0, `stress-${field}`);
  add(failures, stress.wallpaperDeltaZero !== true, "stress-wallpaper");
  add(failures, Object.values(stress.hotListeners ?? {}).some((count) => count !== 0),
    "stress-hot-listeners");
  const unique = [...new Set(failures)];
  return { failures: unique, status: unique.length ? "fail" : "pass" };
}

const INTERACTION_EXPRESSION = `(async () => {
  const api = window.__CODEX_BASE_PROMPT_SWITCHER__;
  const fixture = window.__CODEXCTL_REGRESSION_APP__;
  if (!api || api.diagnostics().managerStatus !== "ready") throw new Error("controller-not-ready");
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const value = predicate();
      if (value) return value;
      await delay(20);
    }
    throw new Error("wait-timeout:" + label);
  };
  const bounds = (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height };
  };
  const aligned = (host, permission) => Math.abs(host.left - permission.right - 5) < 1
    && Math.abs(host.top - permission.top) < 1 && host.right <= innerWidth + 1;
  const hitTarget = (node) => {
    const rect = node?.getBoundingClientRect();
    if (!node || !rect || rect.width <= 1 || rect.height <= 1) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === node || node.contains(hit);
  };
  const dispatchAt = (node, type) => {
    const rect = node?.getBoundingClientRect();
    if (!node || !rect || rect.width <= 1 || rect.height <= 1) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    hit.dispatchEvent(new EventType(type, { bubbles: true, clientX: x, clientY: y }));
    return hit === node || node.contains(hit);
  };
  const profile = (id, label, contextWindow, autoCompactTokenLimit) => ({
    id, label, contextWindow, autoCompactTokenLimit, scope: "total",
  });
  const DEFAULT = { id: "default", label: "Default" };
  const NATIVE = { id: "native", label: "Native / Official", native: true };
  const OAI = profile("oai", "Legacy OAI 272K", 272000, 244800);
  const C200 = profile("200k", "200K", 200000, 180000);
  const C400 = profile("400k", "400K", 400000, 360000);
  const C450 = profile("450k", "450K", 450000, 400000);
  const C600 = profile("600k", "600K", 600000, 540000);
  const ids = {
    large: "22222222-3333-4444-8555-666666666666",
    active: "33333333-4444-4555-8666-777777777777",
    failed: "44444444-5555-4666-8777-888888888888",
    oai: "55555555-6666-4777-8888-999999999999",
    native: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  };
  const record = (id, context, enabled = false) => api.recordThreadFromResult(
    { thread: { id } }, DEFAULT, context, "app/regression",
    { prompt: false, context: enabled },
  );
  const contextButton = () => document.querySelector(
    '[data-codex-context-window-trigger="true"]',
  );
  const chooseContext = async (label) => {
    contextButton().click();
    const menu = await waitFor(() => document.querySelector(".cbps-context-menu"), "context-menu");
    const item = [...menu.querySelectorAll(".cbps-menu-item")].find((node) =>
      (label === "Native" && node.querySelector(".cbps-item-label")?.textContent.startsWith("Native /"))
      || node.querySelector(".cbps-item-label")?.textContent === label);
    if (!item) throw new Error("missing-context-item:" + label + ":" + [...menu.querySelectorAll(
      ".cbps-item-label",
    )].map((node) => node.textContent).join("|"));
    const copy = menu.textContent || "";
    item.click();
    return copy;
  };

  const promptButton = document.querySelector('[data-codex-base-prompt-trigger="true"]');
  const defaultVisible = /Default/.test(promptButton?.textContent || "");
  promptButton.click();
  const promptMenu = await waitFor(() => document.querySelector(".cbps-menu:not(.cbps-context-menu)"), "prompt-menu");
  const work = [...promptMenu.querySelectorAll(".cbps-menu-item")].find((node) =>
    node.querySelector(".cbps-item-label")?.textContent === "Work");
  const menuReachable = Boolean(work);
  work?.click();
  await waitFor(() => api.diagnostics().pendingProfile?.id === "work", "next-base");
  fixture.resetCalls();
  const firstThread = await fixture.manager.requestClient.sendRequest(
    "thread/start", { threadSource: "user", config: {} },
  );
  await fixture.manager.requestClient.sendRequest(
    "thread/start", { threadSource: "user", config: {} },
  );
  const starts = fixture.calls.filter(({ method }) => method === "thread/start");
  const promptResult = {
    defaultVisible,
    historicalPreserved: api.profileForThread(firstThread.thread.id)?.id === "work",
    menuReachable,
    oneShotFirst: Boolean(starts[0]?.params?.config?.model_instructions_file),
    oneShotSecondClean: !Object.hasOwn(starts[1]?.params?.config || {}, "model_instructions_file"),
    resetToDefault: api.diagnostics().pendingProfile?.id === "default",
  };

  fixture.setCurrentThread(ids.large);
  fixture.setUsage(258400);
  record(ids.large, NATIVE);
  fixture.resetCalls();
  const copy = await chooseContext("450K");
  await waitFor(() => fixture.calls.some(({ method }) => method === "thread/resume"), "450k-resume");
  const immediate = fixture.calls.map(({ method }) => method).join(",");
  const largeResume = fixture.calls.find(({ method }) => method === "thread/resume");
  fixture.setUsage(427500, 100001);
  const largeVerified = api.diagnostics().lastContextSwitch?.verificationPending === false;
  const beforeSame = fixture.calls.length;
  await api.hotSwitchContext(ids.large, C450);
  const idempotentNoRequest = fixture.calls.length === beforeSame;
  const beforeShrink = fixture.calls.length;
  let shrinkError = "";
  try { await api.hotSwitchContext(ids.large, OAI); } catch (error) { shrinkError = error.message; }
  const shrinkRejectedBeforeRequest = beforeShrink === fixture.calls.length
    && /272K.*450K|450K.*272K/.test(shrinkError);

  fixture.setCurrentThread(ids.oai);
  fixture.setUsage(258400);
  record(ids.oai, NATIVE);
  fixture.resetCalls();
  await chooseContext("Legacy OAI 272K");
  await waitFor(() => fixture.calls.some(({ method }) => method === "thread/resume"), "272k-resume");
  const oaiResume = fixture.calls.find(({ method }) => method === "thread/resume");
  fixture.setUsage(258400, 100001);

  fixture.setCurrentThread(ids.native);
  fixture.setUsage(200000);
  record(ids.native, NATIVE);
  await api.hotSwitchContext(ids.native, C200);
  fixture.setUsage(190000, 100001);
  api.diagnostics();
  fixture.resetCalls();
  await chooseContext("Native");
  await waitFor(() => fixture.calls.some(({ method }) => method === "thread/resume"), "native-resume");
  const nativeResume = fixture.calls.find(({ method }) => method === "thread/resume");

  fixture.setCurrentThread(ids.active, "active");
  fixture.setUsage(380000);
  record(ids.active, C400, true);
  fixture.resetCalls();
  await api.hotSwitchContext(ids.active, C450);
  await api.hotSwitchContext(ids.active, C600);
  const activeLabel = contextButton().textContent || "";
  const beforeTurn = fixture.calls.length;
  fixture.setThreadStatus("idle");
  await fixture.manager.requestClient.sendRequest("turn/start", { threadId: ids.active, input: [] });
  const boundary = fixture.calls.slice(beforeTurn);
  const activeResume = boundary.find(({ method }) => method === "thread/resume");

  fixture.setCurrentThread(ids.failed);
  fixture.setUsage(380000);
  record(ids.failed, C400, true);
  fixture.resetCalls();
  fixture.failNextResume();
  let failed = false;
  try { await api.hotSwitchContext(ids.failed, C450); } catch { failed = true; }
  const failureRolledBack = failed && api.contextForThread(ids.failed)?.id === "400k";
  fixture.resetCalls();
  const retry = await api.hotSwitchContext(ids.failed, C450);

  await waitFor(() => api.diagnostics().activeTimers.navigation === 0, "layout-timers-settled");
  const host = document.getElementById("codex-prompt-context-control-host");
  const permission = document.getElementById("permission");
  const initial = { host: bounds(host), permission: bounds(permission) };
  const footer = document.getElementById("composer-footer");
  footer.style.minHeight = "150px";
  window.dispatchEvent(new Event("resize"));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const multiline = { host: bounds(host), permission: bounds(permission) };
  const nativeContext = document.getElementById("native-context");
  const nativeSend = document.getElementById("native-send");
  const nativeContextHit = hitTarget(nativeContext);
  const nativeSendHit = hitTarget(nativeSend);
  const contextHoverBefore = fixture.nativeEvents.contextHover;
  const nativeContextHovered = dispatchAt(nativeContext, "pointerover")
    && fixture.nativeEvents.contextHover === contextHoverBefore + 1;
  const sendClickBefore = fixture.nativeEvents.sendClick;
  const nativeSendClicked = dispatchAt(nativeSend, "click")
    && fixture.nativeEvents.sendClick === sendClickBefore + 1;
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  const nativeContextRect = bounds(nativeContext);
  const hostBeforeNativeControls = bounds(host).right <= nativeContextRect.left - 4;
  const hostPointerIsolated = getComputedStyle(host).pointerEvents === "none"
    && [...host.querySelectorAll(".cbps-control")]
      .every((node) => getComputedStyle(node).pointerEvents === "auto");

  promptButton.click();
  const coexistMenu = await waitFor(() => document.querySelector(".cbps-menu"), "coexist-menu");
  const coexistRect = bounds(coexistMenu);
  fixture.showSkillMenu(true);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const skillMenu = document.getElementById("native-skill-menu");
  skillMenu.style.position = "fixed";
  skillMenu.style.left = Math.round(coexistRect.left + 12) + "px";
  skillMenu.style.top = Math.round(coexistRect.top + 12) + "px";
  skillMenu.style.bottom = "auto";
  const providerIndicator = document.querySelector('[data-codex-provider-indicator="true"]');
  providerIndicator.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const toast = document.querySelector(".cbps-toast");
  const hostZ = Number(getComputedStyle(host).zIndex);
  const menuZ = Number(getComputedStyle(coexistMenu).zIndex);
  const toastZ = Number(getComputedStyle(toast).zIndex);
  const skillZ = Number(getComputedStyle(skillMenu).zIndex);
  const customOverlaysHosted = coexistMenu.parentElement === host && toast?.parentElement === host;
  const nativeSkillsAboveCustom = [hostZ, menuZ, toastZ]
    .every((value) => Number.isFinite(value) && value < skillZ);
  const skillMenuReachableWithCustom = hitTarget(skillMenu);
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  fixture.showSkillMenu(false);

  fixture.showStaleComposer(true);
  window.dispatchEvent(new Event("resize"));
  await delay(40);
  const staleComposerIgnored = aligned(
    bounds(host), bounds(document.getElementById("permission")),
  );
  fixture.showStaleComposer(false);
  window.dispatchEvent(new Event("resize"));
  await delay(40);

  const nativeControls = document.getElementById("native-controls");
  nativeControls.style.right = "104px";
  window.dispatchEvent(new Event("resize"));
  await delay(40);
  const narrowHost = bounds(host);
  const narrowNativeContext = bounds(nativeContext);
  const narrowHostSafelyHidden = host.hidden === true
    && getComputedStyle(host).display === "none"
    && narrowHost.width === 0 && narrowHost.height === 0;
  const narrowHostContained = host.hidden !== true
    && narrowHost.right <= narrowNativeContext.left - 4
    && [...host.querySelectorAll(".cbps-control")].every((node) => {
      const rect = bounds(node);
      return rect.width > 1 && rect.height > 1
        && rect.left >= narrowHost.left - 0.5 && rect.right <= narrowHost.right + 0.5;
    });
  const narrowControlsStayIsolated = (narrowHostSafelyHidden || narrowHostContained)
    && hitTarget(nativeContext) && hitTarget(nativeSend);
  nativeControls.style.right = "24px";
  window.dispatchEvent(new Event("resize"));
  await delay(40);

  const beforeNavigation = api.diagnostics();
  const sidebar = document.getElementById("sidebar");
  for (let index = 0; index < 100; index += 1) {
    sidebar.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }
  const navigationPeak = api.diagnostics();
  await delay(800);
  const navigationEnd = api.diagnostics();
  const beforeInput = api.diagnostics();
  const wallpaperBefore = window.__CODEXCTL_WALLPAPER_V2__.diagnostics().metrics;
  const composer = document.getElementById("composer");
  for (let index = 0; index < 1000; index += 1) {
    composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: "a" }));
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: "a" }));
  }
  for (let index = 0; index < 100; index += 1) {
    sidebar.scrollTop = (sidebar.scrollTop + 47) % Math.max(1, sidebar.scrollHeight - sidebar.clientHeight);
    sidebar.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  const afterInput = api.diagnostics();
  const wallpaperAfter = window.__CODEXCTL_WALLPAPER_V2__.diagnostics().metrics;
  await delay(3200);
  const settled = api.diagnostics();
  const timerCount = Object.values(settled.activeTimers).reduce((sum, value) => sum + value, 0)
    + (wallpaperAfter.timers || 0) + fixture.counters.intervals;
  const wallpaperDeltaZero = ["observers", "timers", "layoutReads", "reconciles",
    "mutationBatches", "mutationRecords"].every((key) =>
    (wallpaperAfter[key] || 0) - (wallpaperBefore[key] || 0) === 0);

  fixture.setBlankNewConversation();
  const firstTurn = fixture.manager.requestClient.sendRequest("turn/start", {
    threadId: fixture.threadId, input: [{ type: "text", text: "fixture send" }],
  });
  fixture.unmountComposer();
  const detachedHostBounds = bounds(host);
  const suppressedAtComposerDetach = getComputedStyle(host).display === "none"
    && detachedHostBounds.width === 0 && detachedHostBounds.height === 0;
  window.dispatchEvent(new Event("resize"));
  await firstTurn;
  await delay(30);
  const hiddenDuringRemount = getComputedStyle(host).display === "none";
  fixture.setCurrentThread(fixture.threadId);
  fixture.mountComposer();
  await delay(800);
  const remountedPermission = document.getElementById("permission");
  const coldFirstTurnIsolated = suppressedAtComposerDetach && hiddenDuringRemount
    && getComputedStyle(host).display !== "none"
    && aligned(bounds(host), bounds(remountedPermission));
  return {
    prompt: promptResult,
    context: {
      activeAppliedBeforeTurn: boundary.map(({ method }) => method).join(",")
        === "thread/read,thread/unsubscribe,thread/resume,turn/start",
      activeCoalescedWindow: activeResume?.params?.config?.model_context_window ?? null,
      activeLabelCurrentThread: /600K.*本轮后应用/.test(activeLabel)
        && !/下一个.*task|下一个任务/i.test(activeLabel),
      copyClean: !/只对下一个|仅适用于下一个|下一个.*task/i.test(copy),
      failureRolledBack,
      idempotentNoRequest,
      immediateOrder: immediate,
      largeCompact: largeResume?.params?.config?.model_auto_compact_token_limit ?? null,
      largeVerified,
      largeWindow: largeResume?.params?.config?.model_context_window ?? null,
      nativeNoOverride: !Object.hasOwn(nativeResume?.params?.config || {}, "model_context_window"),
      oaiEffective: fixture.manager.conversations.get(ids.oai).latestTokenUsageInfo.modelContextWindow,
      oaiWindow: oaiResume?.params?.config?.model_context_window ?? null,
      retryRecovered: retry?.queued !== true && api.contextForThread(ids.failed)?.id === "450k",
      shrinkRejectedBeforeRequest,
    },
    layout: {
      hostBeforeNativeControls,
      hostPointerIsolated,
      initialAligned: aligned(initial.host, initial.permission),
      multilineAligned: aligned(multiline.host, multiline.permission),
      moved: initial.host.top !== multiline.host.top,
      nativeContextHit,
      nativeContextHovered,
      nativeSendHit,
      nativeSendClicked,
      narrowControlsStayIsolated,
      coldFirstTurnIsolated,
      customOverlaysHosted,
      nativeSkillsAboveCustom,
      skillMenuReachableWithCustom,
      staleComposerIgnored,
    },
    stress: {
      graphAttempts: settled.managerProbe.graphAttempts,
      hotListeners: fixture.counters.hotListeners,
      inputEnsureDelta: afterInput.uiMetrics.ensureSchedules - beforeInput.uiMetrics.ensureSchedules,
      inputPositionDelta: afterInput.uiMetrics.positionPasses - beforeInput.uiMetrics.positionPasses,
      navigationEndTimers: navigationEnd.activeTimers.navigation,
      navigationPeakTimers: navigationPeak.activeTimers.navigation,
      observerCount: fixture.counters.mutationObservers + fixture.counters.resizeObservers
        + (wallpaperAfter.observers || 0),
      settledTimerCount: timerCount,
      wallpaperDeltaZero,
      workerCount: fixture.counters.workers,
    },
  };
})()`;

export function exerciseAppInteractions(port) {
  return withAppSession(port, (session) => session.evaluate(INTERACTION_EXPRESSION, 20_000));
}
