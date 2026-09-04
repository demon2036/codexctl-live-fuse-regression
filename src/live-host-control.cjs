"use strict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[a-f0-9]{24}$/;
const PLUGINS = new Set(["context", "prompt", "provider", "wallpaper"]);
const ACTIONS = new Set(["debug.stop", "master.set", "plugin.reload", "plugin.set"]);

function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function optionalRevision(value) {
  return value === null || REVISION.test(String(value));
}

function safeText(value, maximum = 500) {
  return typeof value === "string" && value.length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function validatePlugin(value) {
  const keys = ["available", "debugRevision", "displayName", "effectiveKind",
    "effectiveRevision", "enabled", "error", "id", "phase", "recoveryEnabled",
    "stableRevision", "watch"];
  if (!exact(value, keys) || !PLUGINS.has(value.id) || !safeText(value.displayName, 40)
    || typeof value.available !== "boolean" || typeof value.enabled !== "boolean"
    || typeof value.watch !== "boolean" || typeof value.recoveryEnabled !== "boolean"
    || !optionalRevision(value.stableRevision) || !optionalRevision(value.debugRevision)
    || !optionalRevision(value.effectiveRevision)
    || ![null, "debug", "stable"].includes(value.effectiveKind)
    || !safeText(value.phase, 80)
    || !(value.error === null || safeText(value.error))) {
    throw new Error("live UI plugin status is invalid");
  }
  return { ...value };
}

function validateError(value) {
  if (value === null) return null;
  if (!exact(value, ["code", "message"]) || !safeText(value.code, 80)
    || !safeText(value.message)) throw new Error("live UI error is invalid");
  return { ...value };
}

function validateTransaction(value) {
  if (value === null) return null;
  if (!exact(value, ["id", "kind", "status"]) || !UUID.test(String(value.id))
    || !safeText(value.kind, 80) || !safeText(value.status, 80)) {
    throw new Error("live UI transaction is invalid");
  }
  return { ...value };
}

function validateLiveUiStatus(value) {
  const keys = ["appPid", "companionPid", "connected", "hostRevision", "lastError",
    "lastTransaction", "masterEnabled", "plugins", "schema", "sessionId"];
  if (!exact(value, keys) || value.schema !== "codexctl-live-ui-status/1"
    || value.connected !== true || !UUID.test(String(value.sessionId))
    || !REVISION.test(String(value.hostRevision))
    || !Number.isSafeInteger(value.appPid) || value.appPid < 2
    || !Number.isSafeInteger(value.companionPid) || value.companionPid < 2
    || typeof value.masterEnabled !== "boolean" || !Array.isArray(value.plugins)
    || value.plugins.length !== PLUGINS.size) throw new Error("live UI status is invalid");
  const plugins = value.plugins.map(validatePlugin);
  if (new Set(plugins.map(({ id }) => id)).size !== PLUGINS.size) {
    throw new Error("live UI plugin status is incomplete");
  }
  return Object.freeze({
    ...value,
    lastError: validateError(value.lastError),
    lastTransaction: validateTransaction(value.lastTransaction),
    plugins,
  });
}

function parseBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("live action boolean is invalid");
}

function parseLiveAction(rawUrl) {
  const url = new URL(rawUrl);
  const operation = url.pathname.slice(1);
  if (url.protocol !== "codexctl-live-action:" || url.hostname !== "v1"
    || url.username || url.password || url.port || url.hash || !ACTIONS.has(operation)) {
    throw new Error("live action URL is invalid");
  }
  const entries = [...url.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error("live action params are duplicated");
  }
  const raw = Object.fromEntries(entries);
  if (operation === "master.set") {
    if (!exact(raw, ["enabled"])) throw new Error("live master action is invalid");
    return { operation, params: { enabled: parseBoolean(raw.enabled) } };
  }
  if (!PLUGINS.has(raw.pluginId)) throw new Error("live action plugin is invalid");
  if (operation === "plugin.set") {
    if (!exact(raw, ["enabled", "pluginId"])) throw new Error("live plugin action is invalid");
    return { operation, params: { enabled: parseBoolean(raw.enabled), pluginId: raw.pluginId } };
  }
  if (!exact(raw, ["pluginId"])) throw new Error("live plugin action is invalid");
  return { operation, params: { pluginId: raw.pluginId } };
}

async function applyLiveUiStatus(contents, status) {
  const encoded = Buffer.from(JSON.stringify(status), "utf8").toString("base64");
  return contents.executeJavaScript(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), value => value.charCodeAt(0));
    const status = JSON.parse(new TextDecoder().decode(bytes));
    return window.__CODEX_BASE_PROMPT_SWITCHER__?.setLiveStatus?.(status) === true;
  })()`, true);
}

function disconnectedLiveUiStatus(status) {
  return status ? Object.freeze({ ...status, connected: false, companionPid: null }) : null;
}

function recoveredLiveUiStatus(status, recovery) {
  if (!status) return null;
  const plugins = status.plugins.map((plugin) => {
    const slotId = plugin.id === "wallpaper" ? "wallpaper" : "controls";
    if (!recovery.has(slotId)) return plugin;
    const artifact = recovery.get(slotId);
    return {
      ...plugin,
      debugRevision: null,
      effectiveKind: plugin.enabled && artifact ? "stable" : null,
      effectiveRevision: plugin.enabled ? artifact?.revision ?? null : null,
      error: null,
      phase: "ready",
      recoveryEnabled: plugin.enabled,
      watch: false,
    };
  });
  return Object.freeze({
    ...status,
    lastError: {
      code: "companion-disconnected",
      message: "Debug B was removed and the retained stable state was restored.",
    },
    plugins,
  });
}

module.exports = {
  applyLiveUiStatus,
  disconnectedLiveUiStatus,
  parseLiveAction,
  recoveredLiveUiStatus,
  validateLiveUiStatus,
};
