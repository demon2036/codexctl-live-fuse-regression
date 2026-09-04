"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const [
  hookFile,
  specFile,
  resultFile,
  readyAtText,
  navigationAtText,
  navigationSource = "renderer",
  appRoutesReadyAtText,
  controlContextAvailableText = "true",
  navigationTimersUntilText = "-1",
] = process.argv.slice(2);
const readyAtMs = Number(readyAtText);
const navigationAtMs = Number(navigationAtText);
const appRoutesReadyAtMs = appRoutesReadyAtText === undefined
  ? readyAtMs : Number(appRoutesReadyAtText);
const controlContextAvailable = controlContextAvailableText === "true";
const navigationTimersUntilMs = Number(navigationTimersUntilText);
const revision = "a".repeat(24);
const realLoad = Module._load;
const realDateNow = Date.now;
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
let now = 1_000_000;
let documentGeneration = 0;
let reloadScheduled = false;
let navigationEmitted = false;
let nextTimerId = 1;
let timerDrainScheduled = false;
const timers = new Map();

function diagnostics() {
  const elapsed = now - 1_000_000;
  const visible = readyAtMs >= 0 && elapsed >= readyAtMs;
  const navigationRepairs = navigationSource === "renderer"
    && navigationAtMs >= 0 && elapsed >= navigationAtMs ? 1 : 0;
  const button = visible ? [{ visible: true }] : [];
  return {
    revision,
    appRoutesReady: appRoutesReadyAtMs >= 0 && elapsed >= appRoutesReadyAtMs,
    features: { prompt: true, context: true },
    managerStatus: "ready",
    managerProbe: { attempts: 1, inProgress: false },
    controlContextAvailable,
    buttonCount: button.length,
    contextButtonCount: button.length,
    providerIndicatorCount: button.length,
    promptButtons: button,
    contextButtons: button,
    providerIndicators: button,
    currentProvider: { id: visible ? "polo" : null, status: visible ? "resolved" : "pending" },
    activeTimers: {
      managerProbe: 0,
      navigation: navigationTimersUntilMs >= 0 && elapsed < navigationTimersUntilMs ? 1 : 0,
      toast: 0,
      bridge: 0,
    },
    uiMetrics: {
      navigationRepairs,
      mutationBatches: 0,
      mutationRecords: 0,
    },
  };
}

const contents = Object.assign(new EventEmitter(), {
  getType() { return "window"; },
  getURL() { return "app://-/index.html"; },
  isLoadingMainFrame() { return false; },
  async executeJavaScript(source) {
    if (navigationSource === "document-reload-hang" && source === "void 0"
      && documentGeneration === 0) {
      if (!reloadScheduled) {
        reloadScheduled = true;
        queueMicrotask(() => {
          contents.emit(
            "did-start-navigation",
            null,
            "app://-/index.html?initialRoute=/codex/thread",
            false,
            true,
          );
          documentGeneration += 1;
          contents.emit("dom-ready");
        });
      }
      return new Promise(() => {});
    }
    return source.includes("__CODEX_BASE_PROMPT_SWITCHER__") ? diagnostics() : null;
  },
});
const app = new EventEmitter();
const electron = {
  app,
  webContents: { getAllWebContents() { return [contents]; } },
};

async function waitForResult() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (fs.existsSync(resultFile)) return JSON.parse(fs.readFileSync(resultFile, "utf8"));
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("preload fixture produced no result");
}

(async () => {
  process.env.CODEXCTL_PRELOAD_SPEC = specFile;
  process.env.CODEXCTL_PRELOAD_RESULT = resultFile;
  Object.defineProperty(process.versions, "electron", { value: "fixture", configurable: true });
  process.type = "browser";
  Date.now = () => now;
  const scheduleTimerDrain = () => {
    if (timerDrainScheduled || timers.size === 0) return;
    timerDrainScheduled = true;
    setImmediate(() => {
      timerDrainScheduled = false;
      const pending = [...timers.entries()].sort((left, right) => left[1].due - right[1].due)[0];
      if (!pending) return;
      const [id, timer] = pending;
      timers.delete(id);
      now = timer.due;
      if (!navigationEmitted && navigationSource === "webcontents" && navigationAtMs >= 0
        && now - 1_000_000 >= navigationAtMs) {
        navigationEmitted = true;
        contents.emit("did-navigate-in-page", null, contents.getURL(), true);
      }
      timer.callback();
      scheduleTimerDrain();
    });
  };
  global.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, due: now + (Number(delay) || 0) });
    scheduleTimerDrain();
    return id;
  };
  global.clearTimeout = (id) => { timers.delete(id); };
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return electron;
    return realLoad.call(this, request, parent, isMain);
  };
  require(hookFile);
  const record = await waitForResult();
  await new Promise((resolve) => setImmediate(resolve));
  process.stdout.write(`${JSON.stringify({
    record,
    listeners: {
      domReady: contents.listenerCount("dom-ready"),
      didStartNavigation: contents.listenerCount("did-start-navigation"),
      didNavigateInPage: contents.listenerCount("did-navigate-in-page"),
    },
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => {
  Module._load = realLoad;
  Date.now = realDateNow;
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
});
