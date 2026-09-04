import net from "node:net";
import { randomUUID } from "node:crypto";

const FRAME_MAX_BYTES = 8 * 1024 * 1024;
const OPERATIONS = new Set([
  "recovery.clear", "recovery.set", "slot.diagnostics", "slot.mount", "slot.unmount",
  "status", "ui.status",
]);
const UI_ACTIONS = new Set(["debug.stop", "master.set", "plugin.reload", "plugin.set"]);
const PLUGINS = new Set(["context", "prompt", "provider", "wallpaper"]);

function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function encode(value) {
  const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (frame.length > FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
  return frame;
}

function createDecoder(onValue) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) break;
      if (newline + 1 > FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
      const current = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (!current.length) continue;
      onValue(JSON.parse(current.toString("utf8")));
    }
    if (buffered.length >= FRAME_MAX_BYTES) throw new Error("live host frame exceeds size limit");
  };
}

function validateWelcome(value, expected) {
  if (!exact(value, ["hostRevision", "pid", "schema", "sessionId"])
    || value.schema !== "codexctl-live-host-welcome/1"
    || value.sessionId !== expected.sessionId || value.hostRevision !== expected.hostRevision
    || !Number.isSafeInteger(value.pid) || value.pid < 2) {
    throw new Error("live host welcome is invalid");
  }
  return value;
}

function validateResponse(value, requestId) {
  if (!exact(value, ["error", "ok", "requestId", "result", "schema"])
    || value.schema !== "codexctl-live-host-response/1" || value.requestId !== requestId
    || typeof value.ok !== "boolean") throw new Error("live host response is invalid");
  if (value.ok && value.error !== null) throw new Error("live host success contains an error");
  if (!value.ok && (!exact(value.error, ["code", "message"])
    || value.result !== null)) throw new Error("live host failure is invalid");
  return value;
}

function validateEvent(value) {
  if (!exact(value, ["action", "event", "schema"])
    || value.schema !== "codexctl-live-host-event/1" || value.event !== "ui.action"
    || !exact(value.action, ["operation", "params"])
    || !UI_ACTIONS.has(value.action.operation)
    || !value.action.params || typeof value.action.params !== "object"
    || Array.isArray(value.action.params)) throw new Error("live host event is invalid");
  const { operation, params } = value.action;
  if (operation === "master.set") {
    if (!exact(params, ["enabled"]) || typeof params.enabled !== "boolean") {
      throw new Error("live host master action is invalid");
    }
  } else {
    if (!PLUGINS.has(params.pluginId)) throw new Error("live host plugin action is invalid");
    const keys = operation === "plugin.set" ? ["enabled", "pluginId"] : ["pluginId"];
    if (!exact(params, keys) || operation === "plugin.set" && typeof params.enabled !== "boolean") {
      throw new Error("live host plugin action is invalid");
    }
  }
  return value;
}

function openSocket(socketPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(socketPath);
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners("error");
        if (!error) return resolve(socket);
        socket.destroy();
        if (["ECONNREFUSED", "ENOENT"].includes(error.code) && Date.now() < deadline) {
          setTimeout(attempt, 50);
        } else reject(error);
      };
      socket.once("connect", () => finish(null));
      socket.once("error", finish);
    };
    attempt();
  });
}

export async function connectLiveHost({
  authToken,
  hostRevision,
  sessionId,
  socketPath,
  timeoutMs = 20_000,
}) {
  const socket = await openSocket(socketPath, timeoutMs);
  const pending = new Map();
  const eventListeners = new Set();
  let welcome = null;
  let closedResolve;
  let closed = false;
  const closedPromise = new Promise((resolve) => { closedResolve = resolve; });
  const failPending = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  let welcomeResolve;
  let welcomeReject;
  const welcomePromise = new Promise((resolve, reject) => {
    welcomeResolve = resolve;
    welcomeReject = reject;
  });
  const decode = createDecoder((value) => {
    if (!welcome) {
      try {
        welcome = validateWelcome(value, { hostRevision, sessionId });
        welcomeResolve(welcome);
      } catch (error) { welcomeReject(error); socket.destroy(); }
      return;
    }
    if (value?.schema === "codexctl-live-host-event/1") {
      const event = validateEvent(value);
      for (const listener of eventListeners) {
        queueMicrotask(() => { try { listener(event); } catch {} });
      }
      return;
    }
    const item = pending.get(value?.requestId);
    if (!item) { socket.destroy(); return; }
    pending.delete(value.requestId);
    clearTimeout(item.timer);
    try {
      const response = validateResponse(value, value.requestId);
      if (!response.ok) {
        const error = new Error(response.error.message);
        error.code = response.error.code;
        item.reject(error);
      } else item.resolve(response.result);
    } catch (error) { item.reject(error); socket.destroy(); }
  });
  socket.on("data", (chunk) => { try { decode(chunk); } catch { socket.destroy(); } });
  socket.on("error", () => {});
  socket.once("close", () => {
    closed = true;
    const error = new Error("live host connection closed");
    welcomeReject(error);
    failPending(error);
    closedResolve();
  });
  socket.write(encode({
    authToken,
    hostRevision,
    schema: "codexctl-live-host-hello/1",
    sessionId,
  }));
  const timer = setTimeout(() => {
    welcomeReject(new Error("live host handshake timed out"));
    socket.destroy();
  }, timeoutMs);
  try { await welcomePromise; }
  finally { clearTimeout(timer); }
  return {
    closed: closedPromise,
    get host() { return welcome; },
    call(operation, params = {}, callTimeoutMs = 20_000) {
      if (closed) return Promise.reject(new Error("live host connection is closed"));
      if (!OPERATIONS.has(operation)) return Promise.reject(new Error("live host operation is invalid"));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`live host ${operation} timed out`));
        }, callTimeoutMs);
        pending.set(requestId, { reject, resolve, timer });
        try {
          socket.write(encode({
            operation,
            params,
            requestId,
            schema: "codexctl-live-host-request/1",
            sessionId,
          }));
        } catch (error) {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
    close() { socket.destroy(); },
    onEvent(listener) {
      if (typeof listener !== "function") throw new TypeError("live host event listener is required");
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}
