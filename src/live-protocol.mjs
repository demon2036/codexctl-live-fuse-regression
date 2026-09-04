import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

export const LIVE_FRAME_MAX_BYTES = 64 * 1024;
export const LIVE_PLUGIN_IDS = Object.freeze(["context", "prompt", "provider", "wallpaper"]);
export const LIVE_OPERATIONS = Object.freeze([
  "debug.start",
  "debug.stop",
  "master.set",
  "plugin.reload",
  "plugin.set",
  "shutdown",
  "status",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  return record(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function pluginId(value, { all = false } = {}) {
  const id = String(value ?? "");
  if ((!all || id !== "all") && !LIVE_PLUGIN_IDS.includes(id)) {
    throw new Error(`unsupported live plugin: ${id || "<missing>"}`);
  }
  return id;
}

function sourcePath(value) {
  const source = String(value ?? "");
  if (!path.isAbsolute(source) || source.length > 4096 || source.includes("\0")) {
    throw new Error("debug source must be a bounded absolute path");
  }
  return path.normalize(source);
}

function validateParams(operation, params) {
  if (!record(params)) throw new Error("live request params must be an object");
  if (operation === "status" || operation === "shutdown") {
    if (!exact(params, [])) throw new Error(`${operation} accepts no params`);
    return {};
  }
  if (operation === "master.set") {
    if (!exact(params, ["enabled"]) || typeof params.enabled !== "boolean") {
      throw new Error("master.set requires enabled");
    }
    return { enabled: params.enabled };
  }
  if (operation === "plugin.set") {
    if (!exact(params, ["enabled", "pluginId"]) || typeof params.enabled !== "boolean") {
      throw new Error("plugin.set params are invalid");
    }
    return { enabled: params.enabled, pluginId: pluginId(params.pluginId) };
  }
  if (operation === "plugin.reload") {
    if (!exact(params, ["pluginId"])) throw new Error("plugin.reload params are invalid");
    return { pluginId: pluginId(params.pluginId, { all: true }) };
  }
  if (operation === "debug.stop") {
    if (!exact(params, ["pluginId"])) throw new Error("debug.stop params are invalid");
    return { pluginId: pluginId(params.pluginId) };
  }
  if (operation === "debug.start") {
    if (!exact(params, ["pluginId", "source", "watch"]) || typeof params.watch !== "boolean") {
      throw new Error("debug.start params are invalid");
    }
    return {
      pluginId: pluginId(params.pluginId),
      source: sourcePath(params.source),
      watch: params.watch,
    };
  }
  throw new Error(`unsupported live operation: ${operation}`);
}

export function newLiveIdentity() {
  return { authToken: randomBytes(32).toString("hex"), sessionId: randomUUID() };
}

export function createLiveRequest({ authToken, operation, params = {}, requestId = randomUUID(), sessionId }) {
  return validateLiveRequest({
    authToken,
    operation,
    params,
    requestId,
    schema: "codexctl-live-request/1",
    sessionId,
  });
}

export function validateLiveRequest(value) {
  if (!exact(value, ["authToken", "operation", "params", "requestId", "schema", "sessionId"])
    || value.schema !== "codexctl-live-request/1" || !UUID.test(String(value.requestId ?? ""))
    || !UUID.test(String(value.sessionId ?? "")) || !TOKEN.test(String(value.authToken ?? ""))
    || !LIVE_OPERATIONS.includes(value.operation)) {
    throw new Error("live request envelope is invalid");
  }
  return {
    authToken: value.authToken,
    operation: value.operation,
    params: validateParams(value.operation, value.params),
    requestId: value.requestId,
    schema: value.schema,
    sessionId: value.sessionId,
  };
}

export function createLiveResponse(requestId, { error = null, result = null } = {}) {
  if (!UUID.test(String(requestId ?? ""))) throw new Error("live response request id is invalid");
  const failure = error ? {
    code: String(error.code ?? "operation-failed").slice(0, 80),
    message: String(error.message ?? error).slice(0, 600),
  } : null;
  return {
    error: failure,
    ok: failure === null,
    requestId,
    result: failure ? null : result ?? null,
    schema: "codexctl-live-response/1",
  };
}

export function validateLiveResponse(value, requestId = null) {
  if (!exact(value, ["error", "ok", "requestId", "result", "schema"])
    || value.schema !== "codexctl-live-response/1" || !UUID.test(String(value.requestId ?? ""))
    || typeof value.ok !== "boolean" || (requestId && value.requestId !== requestId)) {
    throw new Error("live response envelope is invalid");
  }
  if (value.ok) {
    if (value.error !== null) throw new Error("successful live response contains an error");
  } else if (!exact(value.error, ["code", "message"])
    || typeof value.error.code !== "string" || typeof value.error.message !== "string"
    || value.result !== null) {
    throw new Error("failed live response is invalid");
  }
  return value;
}

export function encodeLiveFrame(value) {
  const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (frame.length > LIVE_FRAME_MAX_BYTES) throw new Error("live frame exceeds size limit");
  return frame;
}

export function createLiveFrameDecoder(onValue) {
  if (typeof onValue !== "function") throw new TypeError("live frame decoder requires a callback");
  let buffered = Buffer.alloc(0);
  let failed = false;
  return (chunk) => {
    if (failed) return;
    buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
    while (true) {
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) break;
      if (newline + 1 > LIVE_FRAME_MAX_BYTES) {
        failed = true;
        throw new Error("live frame exceeds size limit");
      }
      const frame = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (frame.length === 0) continue;
      let parsed;
      try { parsed = JSON.parse(frame.toString("utf8")); }
      catch {
        failed = true;
        throw new Error("live frame is not valid JSON");
      }
      onValue(parsed);
    }
    if (buffered.length > LIVE_FRAME_MAX_BYTES) {
      failed = true;
      throw new Error("live frame exceeds size limit");
    }
  };
}
