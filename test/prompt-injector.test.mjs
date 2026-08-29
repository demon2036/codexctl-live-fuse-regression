import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { makePayload, rendererHarness } from "../test-support/prompt-renderer-harness.mjs";

test("Prompt renderer waits safely for the early document root before DOM integration", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());

  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  assert.equal(api.diagnostics().revision, fixture.loaded.revision);
  assert.equal(harness.document.documentElement, null);
  assert.equal(harness.timers.size, 0, "document readiness must not be polled");

  harness.createDom();
  harness.dispatchDocument("readystatechange");
  await Promise.resolve();
  assert.ok(harness.document.getElementById("codex-base-prompt-switcher-style"));
});

test("Prompt manager discovery is bounded and yields a usable local request manager", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const composer = harness.document.createElement("section");
  harness.document.body.appendChild(composer);
  const requestClient = {
    async sendRequest() { return {}; },
    async prewarmThreadStart() { return {}; },
  };
  const manager = {
    hostId: "local",
    requestClient,
    threadCreation: {},
    conversations: new Map(),
    getHostId() { return "local"; },
    startConversation() {},
    clearPrewarmedThreads() {},
  };
  composer.__reactFiber$codexctl = {
    memoizedState: null,
    memoizedProps: null,
    pendingProps: null,
    dependencies: null,
    updateQueue: { memoCache: { data: [null, null, [manager]] } },
    stateNode: null,
    return: null,
  };
  harness.document.querySelectorAll = (selector) =>
    selector === '[data-codex-composer="true"]' ? [composer] : [];

  harness.dispatchDocument("readystatechange");
  await Promise.resolve();
  assert.equal(harness.runNextTimer(), true, "manager discovery should run from its bounded startup timer");
  await harness.flush();

  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.managerStatus, "ready");
  assert.equal(diagnostics.managerProbe.lastResult, "found");
  assert.equal(diagnostics.managerProbe.lastStrategy, "fiber-memo-cache");
  assert.ok(diagnostics.managerProbe.lastVisited < 10);
  assert.equal(typeof requestClient.sendRequest, "function");
});

test("Prompt UI installs no document-wide MutationObserver", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  harness.dispatchDocument("readystatechange");
  await Promise.resolve();

  const diagnostics = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics();
  assert.equal(diagnostics.controlContextAvailable, false);
  assert.equal(harness.mutationObservers.length, 0);
  assert.equal(diagnostics.uiMetrics.mutationBatches, 0);
});

test("Prompt controls live outside the React composer reconciliation boundary", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  assert.match(fixture.loaded.payload, /document\.body\.appendChild\(host\)/);
  assert.match(fixture.loaded.payload, /codex-prompt-context-control-host/);
  assert.doesNotMatch(fixture.loaded.payload, /anchor-name:|position-anchor:|anchor\(/);
  assert.match(fixture.loaded.payload, /controlHost\.style\.left\s*=/);
  assert.doesNotMatch(fixture.loaded.payload,
    /html:not\(\[data-codexctl-wallpaper="active"\]\) (?:\.thread-scroll-container|:is\()/s);
  assert.doesNotMatch(fixture.loaded.payload,
    /\.cbps-control-host\s*\{[^}]*contain:\s*(?:layout|paint|strict|content)/s);
  assert.match(fixture.loaded.payload,
    /\.cbps-control-host\s*\{[^}]*pointer-events:\s*none\s*!important/s);
  assert.doesNotMatch(fixture.loaded.payload, /insertAdjacentElement/);
  assert.doesNotMatch(fixture.loaded.payload, /new MutationObserver/);
  assert.doesNotMatch(fixture.loaded.payload, /new ResizeObserver/);
});

test("Prompt controls measure the visible Permissions button without mutating it", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const makeComposer = ({ left, top, visible }) => {
    const footer = harness.document.createElement("footer");
    footer.setAttribute("data-composer-footer-responsive", "true");
    footer.setBoundingClientRect({ left: 280, top, width: 700, height: 36 });
    const composer = harness.document.createElement("section");
    composer.setAttribute("data-codex-composer", "true");
    const permission = harness.document.createElement("button");
    permission.setAttribute("data-composer-navigation-target", "permissions");
    permission.setBoundingClientRect({
      left, top, width: visible ? 100 : 0, height: visible ? 28 : 0,
    });
    footer.append(composer, permission);
    harness.document.body.appendChild(footer);
    return permission;
  };

  const first = makeComposer({ left: 300, top: 600, visible: false });
  const second = makeComposer({ left: 420, top: 640, visible: true });
  harness.dispatchDocument("readystatechange");
  await harness.flush();

  const host = harness.document.getElementById("codex-prompt-context-control-host");
  assert.equal(host.parentElement, harness.document.body);
  assert.equal(first.getAttribute("data-codexctl-control-anchor"), null);
  assert.equal(second.getAttribute("data-codexctl-control-anchor"), null);
  assert.equal(harness.window.__CODEX_BASE_PROMPT_SWITCHER__.diagnostics().controlAnchorAttached, true);
  assert.equal(host.style.left, "525px", "inline coordinates remain the compatibility fallback");
  assert.equal(host.style.top, "640px");

  first.setBoundingClientRect({ width: 100, height: 28 });
  second.setBoundingClientRect({ width: 0, height: 0 });
  harness.dispatchWindow("resize");
  await harness.flush();
  assert.equal(first.getAttribute("data-codexctl-control-anchor"), null);
  assert.equal(second.getAttribute("data-codexctl-control-anchor"), null);

  harness.window.__CODEX_BASE_PROMPT_SWITCHER__.cleanup();
  assert.equal(first.getAttribute("data-codexctl-control-anchor"), null);
  assert.equal(harness.document.getElementById("codex-prompt-context-control-host"), null);
});

test("Prompt controls do not inherit the native Permissions button class list", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const footer = harness.document.createElement("footer");
  footer.setAttribute("data-composer-footer-responsive", "true");
  footer.setBoundingClientRect({ left: 280, top: 600, width: 700, height: 36 });
  const composer = harness.document.createElement("section");
  composer.setAttribute("data-codex-composer", "true");
  const permission = harness.document.createElement("button");
  permission.className = "native-permission-button px-4 h-8 text-sm leading-3 whitespace-nowrap";
  permission.setAttribute("data-composer-navigation-target", "permissions");
  permission.setBoundingClientRect({ left: 420, top: 600, width: 100, height: 28 });
  footer.append(composer, permission);
  harness.document.body.appendChild(footer);

  harness.dispatchDocument("readystatechange");
  await harness.flush();

  const host = harness.document.getElementById("codex-prompt-context-control-host");
  const controls = [...host.children];
  assert.deepEqual(controls.map((control) => (
    control.getAttribute("data-composer-navigation-target")
  )), ["base-prompt", "context-window", "context-usage", "provider", "control-overflow"]);
  for (const control of controls) {
    assert.match(control.className, /^cbps-control cbps-trigger/);
    assert.doesNotMatch(control.className, /native-permission-button|px-4|leading-3/);
  }
});

test("Prompt control styles provide a compact, width-aware typography contract", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();
  harness.dispatchDocument("readystatechange");
  await harness.flush();

  const style = harness.document.getElementById("codex-base-prompt-switcher-style");
  assert.ok(style);
  assert.match(style.textContent, /\.cbps-control-host\s*\{[^}]*min-width:\s*0/s);
  assert.match(style.textContent, /\.cbps-control-host\s*\{[^}]*width:\s*max-content/s);
  assert.match(style.textContent, /\.cbps-control-host\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(style.textContent, /\.cbps-control\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(style.textContent, /\.cbps-control\s*\{[^}]*appearance:\s*none/s);
  assert.match(style.textContent, /\.cbps-control\s*\{[^}]*font-family:\s*inherit/s);
  assert.match(style.textContent, /\.cbps-control\s*\{[^}]*line-height:\s*18px/s);
  assert.match(style.textContent, /\.cbps-control\s*\{[^}]*letter-spacing:\s*normal/s);
  assert.doesNotMatch(style.textContent, /container-type:\s*inline-size/s);
  assert.match(style.textContent, /cbps-label-prefix/);
});

test("Prompt/Context request state is recorded only when an override was actually applied", async (t) => {
  const fixture = await makePayload();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;

  const preview = api.previewTransform({
    threadSource: "user",
    baseInstructions: "official",
    config: { preserve: "yes" },
  });
  assert.equal(preview.params.baseInstructions, null);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.params.config)), {
    preserve: "yes",
    model_instructions_file: fixture.prompt,
    model_context_window: 384000,
    model_auto_compact_token_limit: 340000,
    model_auto_compact_token_limit_scope: "body_after_prefix",
  });

  const threadId = "11111111-2222-4333-8444-555555555555";
  api.recordThreadFromResult({ threadId }, preview.profile, preview.context, "test/not-applied", {
    prompt: false,
    context: false,
  });
  assert.equal(api.profileForThread(threadId).id, "original");
  assert.equal(api.contextForThread(threadId).id, "native");

  api.recordThreadFromResult({ threadId }, preview.profile, preview.context, "test/applied", {
    prompt: true,
    context: true,
  });
  assert.equal(api.profileForThread(threadId).id, "work");
  assert.equal(api.contextForThread(threadId).id, "lab");
});

test("Native Context and disabled features leave the official request untouched", async (t) => {
  const fixture = await makePayload({
    features: { prompt: false, context: false },
    defaultContextId: "native",
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  const params = {
    threadSource: "user",
    baseInstructions: "official",
    config: { preserve: "yes" },
  };
  const preview = harness.window.__CODEX_BASE_PROMPT_SWITCHER__.previewTransform(params);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.params)), params);
  assert.equal(preview.context.id, "native");
});

test("Developer Prompt Next Base claim is one-shot and restores only the latest failed claim", async (t) => {
  const fixture = await makePayload({ defaultProfileId: "default" });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const harness = rendererHarness(fixture.loaded.payload);
  t.after(() => harness.cleanup());
  harness.createDom();

  const api = harness.window.__CODEX_BASE_PROMPT_SWITCHER__;
  harness.window.__codexBasePromptBridge = (message) => {
    const request = JSON.parse(message);
    assert.equal(request.action, "validatePath");
    api.resolveBridge(request.id, { ok: true, label: "Work", hash: "verified-work" });
  };
  const configured = api.diagnostics().configuredProfiles;
  const work = configured.find((profile) => profile.id === "work");
  const fallback = configured.find((profile) => profile.id === "default");
  assert.ok(work);
  assert.ok(fallback);

  await api.selectProfile(work);
  const first = api.claimPendingProfileForTask({ threadSource: "user" });
  assert.equal(first.consumed, true);
  assert.equal(first.profile.id, "work");
  assert.equal(api.diagnostics().pendingProfile.id, "default");

  const newer = api.claimPendingProfileForTask({ threadSource: "user" });
  assert.equal(newer.consumed, false);
  assert.equal(newer.profile.id, "default");
  assert.equal(api.restorePendingProfileClaim(first), false,
    "an older failed request must not overwrite a newer task boundary");

  await api.selectProfile(work);
  const latest = api.claimPendingProfileForTask({ threadSource: "user" });
  assert.equal(api.restorePendingProfileClaim(latest), true);
  assert.equal(api.diagnostics().pendingProfile.id, "work");

  const stale = api.claimPendingProfileForTask({ threadSource: "user" });
  await api.selectProfile(fallback);
  assert.equal(api.restorePendingProfileClaim(stale), false,
    "a failed request must not overwrite the user's newer selection");
  assert.equal(api.diagnostics().pendingProfile.id, "default");
});
