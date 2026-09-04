"use strict";

const {
  cleanupWallpaper,
  mountWallpaper,
  wallpaperProbe,
} = require("./live-host-wallpaper.cjs");
const {
  applyLiveUiStatus,
  disconnectedLiveUiStatus,
  parseLiveAction,
  recoveredLiveUiStatus,
  validateLiveUiStatus,
} = require("./live-host-control.cjs");

const REVISION = /^[a-f0-9]{24}$/;
const SLOTS = new Set(["controls", "wallpaper"]);
const RESOURCE_KEYS = [
  "blobs", "dom", "listeners", "observers", "requestPatches",
  "rootAttributes", "styles", "timers", "transfers",
];

function emptyResources() {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0]));
}

function primaryUrl(contents) {
  const url = contents.getURL?.() || "";
  if (!url.startsWith("app://")) return false;
  try { return new URL(url).searchParams.get("initialRoute") !== "/avatar-overlay"; }
  catch { return false; }
}

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validateArtifact(slotId, value) {
  if (!SLOTS.has(slotId)) throw new Error("unknown live host slot");
  if (slotId === "controls"
    && !exact(value, ["id", "payload", "revision", "schema", "type"])) {
    throw new Error("live controls artifact is invalid");
  }
  if (slotId === "wallpaper" && !exact(value,
    ["id", "image", "payload", "revision", "schema", "type"])) {
    throw new Error("live wallpaper artifact is invalid");
  }
  if (value.schema !== "codexctl-live-renderer-artifact/1" || value.type !== slotId
    || !/^[A-Za-z0-9._-]{1,80}$/.test(String(value.id ?? ""))
    || !REVISION.test(String(value.revision ?? ""))
    || typeof value.payload !== "string" || value.payload.length < 1
    || value.payload.length > 4 * 1024 * 1024) {
    throw new Error(`live ${slotId} artifact fields are invalid`);
  }
  if (slotId === "wallpaper" && (!exact(value.image, ["bytes", "hash", "mime", "path"])
    || !Number.isSafeInteger(value.image.bytes) || value.image.bytes < 1
    || value.image.bytes > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(value.image.hash)
    || !["image/png", "image/jpeg", "image/webp"].includes(value.image.mime)
    || typeof value.image.path !== "string" || !value.image.path.startsWith("/"))) {
    throw new Error("live wallpaper image reference is invalid");
  }
  return Object.freeze(value);
}

async function controlsProbe(contents) {
  return contents.executeJavaScript(`(() => {
    const state = window.__CODEX_BASE_PROMPT_SWITCHER__;
    const diagnostics = state?.diagnostics?.() ?? null;
    const timers = Object.values(diagnostics?.activeTimers || {})
      .reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0);
    return {
      revision: diagnostics?.revision ?? diagnostics?.runtimeRevision ?? null,
      installed: Boolean(state),
      dom: document.querySelectorAll('[data-codex-base-prompt-trigger="true"],'
        + '[data-codex-context-window-trigger="true"],'
        + '[data-codex-context-usage-trigger="true"],'
        + '[data-codex-provider-indicator="true"],'
        + '[data-codex-live-control-trigger="true"],#codex-prompt-context-control-host').length,
      styles: document.querySelectorAll('#codex-base-prompt-switcher-style').length,
      rootAttributes: document.querySelectorAll('[data-codexctl-control-anchor]').length,
      listeners: state ? 1 : 0,
      observers: 0,
      requestPatches: state?.manager?.requestClient ? 1 : 0,
      timers,
    };
  })()`, true);
}

async function cleanupControls(contents) {
  await contents.executeJavaScript(`(() => {
    try { window.__CODEX_BASE_PROMPT_SWITCHER__?.cleanup?.(); } catch {}
    delete window.__CODEX_BASE_PROMPT_SWITCHER__;
  })()`, true);
  return controlsProbe(contents);
}

async function mountControls(contents, artifact) {
  try {
    await contents.executeJavaScript(artifact.payload, true);
    const probe = await controlsProbe(contents);
    if (!probe.installed || probe.revision !== artifact.revision || probe.styles !== 1) {
      throw new Error("controls mount diagnostics failed");
    }
    return probe;
  } catch (error) {
    await cleanupControls(contents).catch(() => {});
    throw error;
  }
}

function resourcesFromProbe(slotId, probe) {
  const resources = emptyResources();
  if (!probe) return resources;
  if (slotId === "controls") {
    for (const key of ["dom", "listeners", "observers", "requestPatches",
      "rootAttributes", "styles", "timers"]) resources[key] = Number(probe[key] ?? 0);
  } else {
    for (const key of ["blobs", "observers", "rootAttributes", "styles", "timers", "transfers"]) {
      resources[key] = Number(probe[key] ?? 0);
    }
  }
  return resources;
}

class LiveHostRenderer {
  constructor(electron, { readyTimeoutMs = 20_000 } = {}) {
    this.electron = electron;
    this.readyTimeoutMs = readyTimeoutMs;
    this.records = new Map();
    this.desired = new Map([...SLOTS].map((id) => [id, null]));
    this.recovery = new Map();
    this.uiStatus = null;
    this.actionHandler = null;
    this.releases = [];
    this.waiters = new Set();
    this.tail = Promise.resolve();
  }

  queue(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }

  start() {
    const onCreated = (_event, contents) => this.attach(contents);
    this.electron.app.on("web-contents-created", onCreated);
    this.releases.push(() => this.electron.app.removeListener("web-contents-created", onCreated));
    for (const contents of this.electron.webContents.getAllWebContents()) this.attach(contents);
    return this;
  }

  attach(contents) {
    if (contents.getType?.() !== "window" || this.records.has(contents)) return;
    const record = { actual: new Map(), ready: false, releases: [] };
    this.records.set(contents, record);
    const listen = (event, listener) => {
      contents.on?.(event, listener);
      record.releases.push(() => contents.removeListener?.(event, listener));
    };
    const ready = () => {
      record.ready = false;
      record.actual.clear();
      if (!this.currentPrimary(contents, record)) return;
      void this.queue(() => this.syncRecord(contents, record));
    };
    listen("dom-ready", ready);
    listen("will-navigate", (event, url) => {
      if (!String(url).startsWith("codexctl-live-action:")) return;
      event.preventDefault?.();
      try {
        const action = parseLiveAction(url);
        if (!contents.isDestroyed?.() && primaryUrl(contents)) {
          record.ready = true;
          this.actionHandler?.(action);
        }
      } catch {}
    });
    listen("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      const url = typeof _url === "object" ? _url?.url : _url;
      if (String(url).startsWith("codexctl-live-action:")) return;
      if (isMainFrame !== false && inPlace !== true) {
        record.ready = false;
        record.actual.clear();
      }
    });
    listen("did-stop-loading", () => {
      const stale = !record.ready;
      if (this.currentPrimary(contents, record) && stale) {
        void this.queue(() => this.syncRecord(contents, record));
      }
    });
    listen("destroyed", () => {
      for (const release of record.releases.splice(0).reverse()) release();
      this.records.delete(contents);
    });
    if (!contents.isLoadingMainFrame?.() && primaryUrl(contents)) ready();
  }

  currentPrimary(contents, record) {
    const ready = !contents.isDestroyed?.()
      && contents.isLoadingMainFrame?.() !== true && primaryUrl(contents);
    if (record.ready !== ready) {
      record.ready = ready;
      record.actual.clear();
    }
    if (ready && this.waiters.size) {
      for (const resolve of this.waiters) resolve();
      this.waiters.clear();
    }
    return ready;
  }

  activeRecords() {
    return [...this.records].filter(([contents, record]) => (
      this.currentPrimary(contents, record)
    ));
  }

  async waitForPrimary() {
    if (this.activeRecords().length) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(wake);
        reject(new Error("live host primary app:// renderer timed out"));
      }, this.readyTimeoutMs);
      const wake = () => { clearTimeout(timer); resolve(); };
      this.waiters.add(wake);
    });
  }

  async mountRecord(contents, record, slotId, artifact) {
    const probe = slotId === "controls"
      ? await mountControls(contents, artifact) : await mountWallpaper(contents, artifact);
    record.actual.set(slotId, artifact.revision);
    if (slotId === "controls" && this.uiStatus) {
      await applyLiveUiStatus(contents, this.uiStatus);
    }
    return probe;
  }

  async unmountRecord(contents, record, slotId) {
    const probe = slotId === "controls"
      ? await cleanupControls(contents) : await cleanupWallpaper(contents);
    record.actual.delete(slotId);
    return probe;
  }

  async syncRecord(contents, record) {
    for (const slotId of SLOTS) {
      const artifact = this.desired.get(slotId);
      if (artifact && record.actual.get(slotId) !== artifact.revision) {
        await this.unmountRecord(contents, record, slotId);
        await this.mountRecord(contents, record, slotId, artifact);
      } else if (!artifact && record.actual.has(slotId)) {
        await this.unmountRecord(contents, record, slotId);
      }
    }
  }

  mount(slotId, rawArtifact) {
    return this.queue(async () => {
      const artifact = validateArtifact(slotId, rawArtifact);
      await this.waitForPrimary();
      this.desired.set(slotId, artifact);
      for (const [contents, record] of this.activeRecords()) {
        if (record.actual.get(slotId) !== artifact.revision) {
          await this.unmountRecord(contents, record, slotId);
          await this.mountRecord(contents, record, slotId, artifact);
        }
      }
      return this.diagnosticsNow(slotId);
    });
  }

  unmount(slotId) {
    return this.queue(async () => {
      if (!SLOTS.has(slotId)) throw new Error("unknown live host slot");
      this.desired.set(slotId, null);
      for (const [contents, record] of this.activeRecords()) {
        await this.unmountRecord(contents, record, slotId);
      }
      return this.diagnosticsNow(slotId);
    });
  }

  diagnostics(slotId) {
    return this.queue(() => this.diagnosticsNow(slotId));
  }

  async diagnosticsNow(slotId) {
    if (!SLOTS.has(slotId)) throw new Error("unknown live host slot");
    const active = this.activeRecords();
    const probes = [];
    for (const [contents] of active) {
      probes.push(slotId === "controls" ? await controlsProbe(contents) : await wallpaperProbe(contents));
    }
    const desired = this.desired.get(slotId);
    const mounted = Boolean(desired && active.length && probes.every((probe) => (
      probe.installed && probe.revision === desired.revision
    )));
    const resources = emptyResources();
    for (const probe of probes) {
      const current = resourcesFromProbe(slotId, probe);
      for (const key of RESOURCE_KEYS) resources[key] += current[key];
    }
    return {
      handleCount: mounted ? 1 : 0,
      mounted,
      resources,
      revision: mounted ? desired.revision : null,
    };
  }

  setRecovery(slotId, artifact) {
    if (!SLOTS.has(slotId)) throw new Error("unknown live host slot");
    this.recovery.set(slotId, artifact === null ? null : validateArtifact(slotId, artifact));
    return { accepted: true, slotId };
  }

  clearRecovery(slotId) {
    this.recovery.delete(slotId);
    return { accepted: true, slotId };
  }

  setActionHandler(handler) {
    this.actionHandler = typeof handler === "function" ? handler : null;
  }

  setUiStatus(value) {
    return this.queue(async () => {
      this.uiStatus = validateLiveUiStatus(value);
      for (const [contents] of this.activeRecords()) {
        await applyLiveUiStatus(contents, this.uiStatus);
      }
      return { accepted: true };
    });
  }

  setConnected(connected) {
    if (connected || !this.uiStatus) return Promise.resolve();
    return this.queue(async () => {
      this.uiStatus = disconnectedLiveUiStatus(this.uiStatus);
      for (const [contents] of this.activeRecords()) {
        await applyLiveUiStatus(contents, this.uiStatus);
      }
    });
  }

  recover() {
    return this.queue(async () => {
      const recovery = new Map(this.recovery);
      for (const [slotId, artifact] of recovery) {
        this.desired.set(slotId, artifact);
        for (const [contents, record] of this.activeRecords()) {
          await this.unmountRecord(contents, record, slotId);
          if (artifact) await this.mountRecord(contents, record, slotId, artifact);
        }
      }
      this.recovery.clear();
      this.uiStatus = recoveredLiveUiStatus(this.uiStatus, recovery);
      if (this.uiStatus) for (const [contents] of this.activeRecords()) {
        await applyLiveUiStatus(contents, this.uiStatus);
      }
    });
  }

  status() {
    return {
      desired: Object.fromEntries([...this.desired].map(([id, value]) => [id,
        value ? { id: value.id, revision: value.revision } : null])),
      primaryRenderers: this.activeRecords().length,
      recoverySlots: [...this.recovery.keys()],
      uiConnected: this.uiStatus?.connected === true,
      uiStatus: this.uiStatus,
    };
  }

  async close() {
    this.actionHandler = null;
    for (const release of this.releases.splice(0).reverse()) release();
    for (const record of this.records.values()) {
      for (const release of record.releases.splice(0).reverse()) release();
    }
    this.records.clear();
  }
}

module.exports = { LiveHostRenderer, primaryUrl, validateArtifact };
