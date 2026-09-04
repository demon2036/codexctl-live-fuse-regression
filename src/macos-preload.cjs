"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CONTROL_FINAL_REPAIR_SETTLE_TIMEOUT_MS,
  CONTROL_NAVIGATION_TIMEOUT_MS,
  CONTROL_READY_TIMEOUT_MS,
  HOOK_TIMEOUT_MS,
} = require("./macos-preload-budget.cjs");
const { resolveThemeAsset } = require("./macos-preload-assets.cjs");
const { startMacPreloadLifecycle } = require("./macos-preload-lifecycle.cjs");

const SPEC_FILE = process.env.CODEXCTL_PRELOAD_SPEC;
const RESULT_FILE = process.env.CODEXCTL_PRELOAD_RESULT;
delete process.env.CODEXCTL_PRELOAD_SPEC;
delete process.env.CODEXCTL_PRELOAD_RESULT;
delete process.env.NODE_OPTIONS;

const REVISION = /^[a-f0-9]{24}$/;
const RESULT_BASENAME = /^preload-result-[a-f0-9-]{36}\.json$/;
const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_ART_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 192 * 1024;
const CONTROL_READY_INTERVAL_MS = 100;
const startedAt = Date.now();
let completed = false;

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function readRegular(filename, maximumBytes, label) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filename, flags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== stat.size) throw new Error(`${label} changed while being read`);
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function validatePayload(value, keys, label) {
  if (!exactKeys(value, keys) || typeof value.payload !== "string"
    || value.payload.length < 1 || value.payload.length > MAX_SPEC_BYTES
    || !REVISION.test(value.revision)) throw new Error(`${label} spec is invalid`);
}

function loadSpec() {
  if (!path.isAbsolute(SPEC_FILE || "") || !path.isAbsolute(RESULT_FILE || "")
    || path.dirname(SPEC_FILE) !== path.dirname(RESULT_FILE)
    || !RESULT_BASENAME.test(path.basename(RESULT_FILE))) {
    throw new Error("preload paths are invalid");
  }
  const parsed = JSON.parse(readRegular(SPEC_FILE, MAX_SPEC_BYTES, "preload spec").toString("utf8"));
  if (!exactKeys(parsed, ["schema", "promptContext", "wallpaper"])
    || parsed.schema !== "codexctl-macos-preload/1") throw new Error("preload schema is invalid");
  if (parsed.promptContext !== null) {
    validatePayload(parsed.promptContext, ["payload", "revision"], "Prompt/Context");
  }
  if (parsed.wallpaper !== null) {
    validatePayload(
      parsed.wallpaper,
      ["bytes", "image", "mime", "payload", "revision", "themeId"],
      "Wallpaper",
    );
    if (!/^theme\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(parsed.wallpaper.image)
      || !["image/png", "image/jpeg", "image/webp"].includes(parsed.wallpaper.mime)
      || !Number.isSafeInteger(parsed.wallpaper.bytes)
      || parsed.wallpaper.bytes < 1 || parsed.wallpaper.bytes > MAX_ART_BYTES
      || typeof parsed.wallpaper.themeId !== "string" || parsed.wallpaper.themeId.length > 80) {
      throw new Error("Wallpaper asset spec is invalid");
    }
  }
  if (!parsed.promptContext && !parsed.wallpaper) throw new Error("preload has no enabled module");
  return parsed;
}

function writeResult(result) {
  if (completed) return;
  completed = true;
  const temporary = `${RESULT_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(result)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, RESULT_FILE);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function resultRecord(ok, url, promptContext, wallpaper, error = null) {
  return {
    schema: "codexctl-macos-preload-result/1",
    ok,
    pid: process.pid,
    url,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    promptContext,
    wallpaper,
    error,
  };
}

async function createWallpaperBlob(contents, wallpaper, art, ensureCurrent) {
  const revision = JSON.stringify(wallpaper.revision);
  ensureCurrent();
  await contents.executeJavaScript(`(() => {
    const revision = ${revision};
    const transfers = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__ ||= Object.create(null);
    transfers[revision] = { bytes: 0, chunks: [], expected: ${art.length}, mime: ${JSON.stringify(wallpaper.mime)} };
  })()`, true);
  for (let offset = 0; offset < art.length; offset += CHUNK_BYTES) {
    ensureCurrent();
    const encoded = art.subarray(offset, Math.min(art.length, offset + CHUNK_BYTES)).toString("base64");
    await contents.executeJavaScript(`(() => {
      const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[${revision}];
      if (!transfer || transfer.bytes !== ${offset}) throw new Error("wallpaper-transfer-order");
      const binary = atob(${JSON.stringify(encoded)});
      const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
      transfer.chunks.push(bytes); transfer.bytes += bytes.length;
    })()`, true);
  }
  ensureCurrent();
  return contents.executeJavaScript(`(() => {
    const revision = ${revision};
    const transfer = window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__?.[revision];
    if (!transfer || transfer.bytes !== transfer.expected) throw new Error("wallpaper-transfer-incomplete");
    const blob = new Blob(transfer.chunks, { type: transfer.mime });
    const url = URL.createObjectURL(blob);
    (window.__CODEXCTL_WALLPAPER_V2_BLOBS__ ||= Object.create(null))[revision] =
      { revision, url, bytes: blob.size, mime: transfer.mime, blob };
    delete window.__CODEXCTL_WALLPAPER_V2_TRANSFERS__[revision];
    return url;
  })()`, true);
}

function enabledControlsReady(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return false;
  if (diagnostics.controlContextAvailable === false) {
    return diagnostics.buttonCount === 0 && diagnostics.contextButtonCount === 0
      && diagnostics.providerIndicatorCount === 0;
  }
  const promptReady = diagnostics.features?.prompt !== true
    || (diagnostics.buttonCount === 1 && diagnostics.promptButtons?.[0]?.visible === true);
  const contextReady = diagnostics.features?.context !== true
    || (diagnostics.contextButtonCount === 1 && diagnostics.contextButtons?.[0]?.visible === true);
  const providerReady = diagnostics.features?.prompt !== true
    && diagnostics.features?.context !== true
    || (diagnostics.providerIndicatorCount === 1
      && diagnostics.providerIndicators?.[0]?.visible === true);
  return promptReady && contextReady && providerReady;
}

function controlsStable(diagnostics) {
  if (!enabledControlsReady(diagnostics)
    || diagnostics.activeTimers?.navigation !== 0) return false;
  return diagnostics.controlContextAvailable === false
    || diagnostics.appRoutesReady === true;
}

function navigationObserved(diagnostics) {
  return Number.isInteger(diagnostics?.uiMetrics?.navigationRepairs)
    && diagnostics.uiMetrics.navigationRepairs > 0;
}

function promptContextFailureSummary(diagnostics) {
  const count = (value) => Number.isInteger(value) ? value : "?";
  return `appRoutesReady=${String(diagnostics?.appRoutesReady)}; `
    + `controls=${count(diagnostics?.buttonCount)}/${count(diagnostics?.contextButtonCount)}`
    + `/${count(diagnostics?.providerIndicatorCount)}; `
    + `controlContextAvailable=${String(diagnostics?.controlContextAvailable)}; `
    + `managerStatus=${String(diagnostics?.managerStatus)}; `
    + `navigationTimers=${count(diagnostics?.activeTimers?.navigation)}; `
    + `controlAnchorAttached=${String(diagnostics?.controlAnchorAttached)}`;
}

async function waitForPromptContext(contents, revision, ensureCurrent) {
  const waitStartedAt = Date.now();
  const normalDeadline = waitStartedAt + CONTROL_READY_TIMEOUT_MS;
  const navigationDeadline = waitStartedAt + CONTROL_NAVIGATION_TIMEOUT_MS;
  let diagnostics = null;
  let followedNavigation = false;
  let awaitedFinalRoutes = false;
  let finalControlsObserved = false;
  let contentsNavigated = false;
  const onStartNavigation = (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame !== false) contentsNavigated = true;
  };
  const onInPageNavigation = (_event, _url, isMainFrame) => {
    if (isMainFrame !== false) contentsNavigated = true;
  };
  contents.on?.("did-start-navigation", onStartNavigation);
  contents.on?.("did-navigate-in-page", onInPageNavigation);
  try {
    while (true) {
      ensureCurrent();
      diagnostics = await contents.executeJavaScript(
        "window.__CODEX_BASE_PROMPT_SWITCHER__?.diagnostics?.() ?? null",
        true,
      );
      ensureCurrent();
      if (diagnostics?.revision !== revision) {
        throw new Error("Prompt/Context revision was not installed");
      }
      followedNavigation ||= contentsNavigated || navigationObserved(diagnostics);
      awaitedFinalRoutes ||= diagnostics.appRoutesReady === false;
      finalControlsObserved ||= diagnostics.appRoutesReady === true
        && enabledControlsReady(diagnostics);
      if (controlsStable(diagnostics)) return diagnostics;
      const phaseDeadline = followedNavigation || awaitedFinalRoutes
        ? navigationDeadline : normalDeadline;
      const deadline = finalControlsObserved
        ? phaseDeadline + CONTROL_FINAL_REPAIR_SETTLE_TIMEOUT_MS
        : phaseDeadline;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.min(CONTROL_READY_INTERVAL_MS, remaining),
      ));
    }
  } finally {
    contents.removeListener?.("did-start-navigation", onStartNavigation);
    contents.removeListener?.("did-navigate-in-page", onInPageNavigation);
  }
  const summary = promptContextFailureSummary(diagnostics);
  if (followedNavigation) {
    throw new Error(
      `Prompt/Context navigation was observed but controls did not stabilize within bounded ${CONTROL_NAVIGATION_TIMEOUT_MS}ms; ${summary}`,
    );
  }
  if (awaitedFinalRoutes) {
    throw new Error(
      `Prompt/Context final app routes did not stabilize within bounded ${CONTROL_NAVIGATION_TIMEOUT_MS}ms; ${summary}`,
    );
  }
  throw new Error(
    `Prompt/Context controls were not visible after ${CONTROL_READY_TIMEOUT_MS}ms; ${summary}`,
  );
}

async function inject(contents, spec, ensureCurrent, setStage) {
  const url = contents.getURL();
  let promptContext = null;
  let wallpaper = null;
  if (spec.promptContext) {
    setStage("prompt-context-payload");
    ensureCurrent();
    await contents.executeJavaScript(spec.promptContext.payload, true);
    ensureCurrent();
    setStage("prompt-context-ready");
    const diagnostics = await waitForPromptContext(
      contents,
      spec.promptContext.revision,
      ensureCurrent,
    );
    promptContext = {
      revision: diagnostics.revision,
      appRoutesReady: diagnostics.appRoutesReady,
      features: diagnostics.features,
      managerStatus: diagnostics.managerStatus,
      controlContextAvailable: diagnostics.controlContextAvailable,
      buttonCount: diagnostics.buttonCount,
      contextButtonCount: diagnostics.contextButtonCount,
      providerIndicatorCount: diagnostics.providerIndicatorCount,
      promptButtons: diagnostics.promptButtons,
      contextButtons: diagnostics.contextButtons,
      providerIndicators: diagnostics.providerIndicators,
      currentProvider: diagnostics.currentProvider,
      activeTimers: diagnostics.activeTimers,
      managerProbe: diagnostics.managerProbe,
      uiMetrics: diagnostics.uiMetrics,
    };
  }
  if (spec.wallpaper) {
    setStage("wallpaper-asset");
    ensureCurrent();
    const canonical = resolveThemeAsset(SPEC_FILE, spec.wallpaper.image);
    const art = readRegular(canonical, MAX_ART_BYTES, "Wallpaper asset");
    if (art.length !== spec.wallpaper.bytes) throw new Error("Wallpaper asset size changed");
    setStage("wallpaper-transfer");
    const artUrl = await createWallpaperBlob(contents, spec.wallpaper, art, ensureCurrent);
    ensureCurrent();
    const placeholder = JSON.stringify("blob:codexctl-pending");
    if (spec.wallpaper.payload.split(placeholder).length !== 2) {
      throw new Error("Wallpaper payload placeholder is invalid");
    }
    const payload = spec.wallpaper.payload.replace(placeholder, JSON.stringify(artUrl));
    setStage("wallpaper-payload");
    await contents.executeJavaScript(payload, true);
    ensureCurrent();
    setStage("wallpaper-ready");
    const diagnostics = await contents.executeJavaScript(
      "window.__CODEXCTL_WALLPAPER_V2__?.diagnostics?.() ?? null",
      true,
    );
    if (diagnostics?.revision !== spec.wallpaper.revision || diagnostics.installed !== true
      || diagnostics.artReady !== true || diagnostics.stylePresent !== true
      || diagnostics.rootAttribute !== "on" || diagnostics.metrics?.observers !== 0
      || diagnostics.metrics?.timers !== 0) throw new Error("Wallpaper performance contract failed");
    wallpaper = {
      revision: diagnostics.revision,
      themeId: diagnostics.themeId,
      installed: diagnostics.installed,
      artReady: diagnostics.artReady,
      stylePresent: diagnostics.stylePresent,
      rootAttribute: diagnostics.rootAttribute,
      observers: diagnostics.metrics.observers,
      timers: diagnostics.metrics.timers,
      cssBytes: diagnostics.metrics.cssBytes,
      styleRules: diagnostics.metrics.styleRules,
    };
  }
  return resultRecord(true, url, promptContext, wallpaper);
}

if (SPEC_FILE && RESULT_FILE && process.versions.electron
  && (!process.type || process.type === "browser")) {
  setImmediate(() => {
    let electron;
    let spec;
    try {
      electron = require("electron");
      spec = loadSpec();
      if (!electron?.app?.on || !electron?.webContents?.getAllWebContents) {
        throw new Error("Electron preload APIs are unavailable");
      }
    } catch (error) {
      const detail = `${String(error.message || error)}; stage=loading-spec; `
        + `navigations=0; elapsedMs=${Date.now() - startedAt}`;
      writeResult(resultRecord(false, null, null, null, detail.slice(0, 600)));
      return;
    }
    startMacPreloadLifecycle({
      electron,
      inject: (contents, ensureCurrent, setStage) => (
        inject(contents, spec, ensureCurrent, setStage)
      ),
      onFailure: ({ elapsedMs, error, navigations, stage, url }) => {
        const detail = `${String(error.message || error)}; stage=${stage}; `
          + `navigations=${navigations}; elapsedMs=${elapsedMs}`;
        writeResult(resultRecord(false, url, null, null, detail.slice(0, 600)));
      },
      onSuccess: writeResult,
      startedAt,
      timeoutMs: HOOK_TIMEOUT_MS,
    });
  });
}
