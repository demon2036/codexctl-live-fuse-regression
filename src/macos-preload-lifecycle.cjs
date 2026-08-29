"use strict";

function primaryUrl(contents) {
  const url = contents.getURL?.() || "";
  if (!url.startsWith("app://")) return false;
  try { return new URL(url).searchParams.get("initialRoute") !== "/avatar-overlay"; }
  catch { return false; }
}

function startMacPreloadLifecycle({
  electron,
  inject,
  onFailure,
  onSuccess,
  startedAt,
  timeoutMs,
}) {
  let activeEpoch = null;
  let deadlineTimer = null;
  let epoch = 0;
  let finished = false;
  let lastContents = null;
  let navigations = 0;
  let stage = "waiting-primary-dom";
  const attached = new WeakSet();
  const releases = [];

  const cleanup = () => {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    deadlineTimer = null;
    for (const release of releases.splice(0).reverse()) release();
  };
  const complete = (callback) => {
    if (finished) return;
    finished = true;
    try { callback(); }
    finally { cleanup(); }
  };
  const fail = (error, contents = lastContents) => complete(() => onFailure({
    elapsedMs: Date.now() - startedAt,
    error,
    navigations,
    stage,
    url: contents?.getURL?.() || null,
  }));
  const listen = (emitter, event, listener) => {
    emitter.on?.(event, listener);
    releases.push(() => emitter.removeListener?.(event, listener));
  };

  const attempt = async (contents) => {
    if (finished || activeEpoch === epoch || !primaryUrl(contents)) return;
    const attemptEpoch = epoch;
    activeEpoch = attemptEpoch;
    lastContents = contents;
    const ensureCurrent = () => {
      if (finished || attemptEpoch !== epoch) {
        throw new Error("preload document generation became stale");
      }
    };
    try {
      stage = "installing";
      const result = await inject(
        contents,
        ensureCurrent,
        (nextStage) => { if (attemptEpoch === epoch) stage = nextStage; },
      );
      ensureCurrent();
      stage = "writing-result";
      complete(() => onSuccess(result));
    } catch (error) {
      if (!finished && attemptEpoch === epoch) fail(error, contents);
    } finally {
      if (activeEpoch === attemptEpoch) activeEpoch = null;
    }
  };
  const scheduleAttempt = (contents) => {
    queueMicrotask(() => { void attempt(contents); });
  };
  const invalidate = (contents, waitForDomReady) => {
    if (finished || !primaryUrl(contents)) return;
    navigations += 1;
    epoch += 1;
    activeEpoch = null;
    lastContents = contents;
    stage = waitForDomReady ? "waiting-primary-dom" : "navigation-retry";
    if (!waitForDomReady) scheduleAttempt(contents);
  };
  const onCreated = (_event, contents) => {
    if (contents.getType?.() !== "window" || attached.has(contents)) return;
    attached.add(contents);
    const onDomReady = () => {
      stage = "primary-dom-ready";
      scheduleAttempt(contents);
    };
    const onStartNavigation = (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame !== false && inPlace !== true) invalidate(contents, true);
    };
    const onInPageNavigation = (_event, _url, isMainFrame) => {
      if (isMainFrame !== false) invalidate(contents, false);
    };
    listen(contents, "dom-ready", onDomReady);
    listen(contents, "did-start-navigation", onStartNavigation);
    listen(contents, "did-navigate-in-page", onInPageNavigation);
    if (!contents.isLoadingMainFrame?.() && primaryUrl(contents)) scheduleAttempt(contents);
  };

  listen(electron.app, "web-contents-created", onCreated);
  for (const contents of electron.webContents.getAllWebContents()) onCreated(null, contents);
  deadlineTimer = setTimeout(() => {
    fail(new Error(`macOS preload hook exceeded bounded ${timeoutMs}ms`));
  }, timeoutMs);
}

module.exports = { startMacPreloadLifecycle };
